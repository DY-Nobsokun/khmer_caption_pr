"""In-process KFA adapter. Called by the native worker's isolated CPython runtime.

No subprocess, server, downloads, alternative timing model, or estimated timing.
"""
import gc
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sys


def align_recording(wav_path, transcript, config_json, cancelled):
    config = json.loads(config_json)
    for name in ('ORT_DISABLE_TELEMETRY', 'HF_HUB_DISABLE_TELEMETRY',
                 'HF_HUB_OFFLINE', 'DO_NOT_TRACK'):
        os.environ[name] = '1'
    os.environ['NUMBA_CACHE_DIR'] = config['cacheDir']
    sys.dont_write_bytecode = True
    worker = None
    original_normalizer = None
    job_normalizer = None
    previous_streams = (sys.stdout, sys.stderr)
    previous_trace = sys.gettrace()
    original_network = (socket.create_connection, socket.socket.connect,
                        socket.socket.connect_ex, socket.socket.sendto)

    def check():
        if cancelled():
            raise RuntimeError('KFA alignment cancelled')

    traced_lines = 0

    def trace(frame, event, _arg):
        nonlocal traced_lines
        # Trace only the CTC loops which need cooperative cancellation, rather
        # than every line in NumPy, normalization, cache lookup and logging.
        if frame.f_code.co_name not in ('get_trellis', 'backtrack', 'align_kfa_emission'):
            return None
        if event == 'line':
            traced_lines += 1
            if traced_lines % 64 == 0:
                check()
        return trace

    def no_network(*_args, **_kwargs):
        raise RuntimeError('Network access is disabled during local KFA alignment')

    def load(name, filename, expected):
        path = Path(filename)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('The installed KFA reference changed; refresh the verified local configuration')
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    try:
        sys.stdout = sys.stderr = io.StringIO()
        Path(config['cacheDir']).mkdir(parents=True, exist_ok=True)
        check()
        socket.create_connection = no_network
        socket.socket.connect = no_network
        socket.socket.connect_ex = no_network
        socket.socket.sendto = no_network
        worker = load('_caption_kfa_worker', config['worker'], config['workerSha256'])
        adapter = load('_caption_kfa_mapping', config['adapter'], config['adapterSha256'])
        if not Path(config['model']).is_file():
            raise RuntimeError('The installed KFA ONNX model is missing')
        import onnxruntime as ort
        ort.disable_telemetry_events()
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(config['model'], options, providers=['CPUExecutionProvider'])

        class CheckedSession:
            def run(self, *args, **kwargs):
                check()
                result = session.run(*args, **kwargs)
                check()
                return result

        # Preserve the installed worker's preprocessing, chunk trimming, phonemizer,
        # trellis/backtracking and actual acoustic boundaries. Only supply a local
        # session explicitly to avoid KFA's model download path.
        worker._kfa_session = CheckedSession()
        from khmernormalizer.khnormal import khmer_normalize
        # sosap.PyModel is thread-affine. The installed module caches one globally,
        # while each addon job runs on a new native thread. Execute the unchanged
        # normalizer source in a job-local module, so its FST model is constructed
        # and destroyed on this job's thread. Leave the original cached model alone.
        original_normalizer = importlib.import_module('kfa.text_normalize')
        spec = importlib.util.spec_from_file_location(
            '_sthang_job_kfa_text_normalize', original_normalizer.__file__)
        job_normalizer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(job_normalizer)
        sys.modules['kfa.text_normalize'] = job_normalizer
        # Imports/JIT initialization run before tracing. Trace only the alignment
        # algorithms; native ONNX calls check cancellation before and after each run.
        emission, samples, rate = worker.compute_kfa_emission(Path(wav_path), None)
        check()
        sequences = [item for line in transcript.splitlines() if line.strip()
                     for item in __import__('kfa.text_normalize', fromlist=['tokenize_phonemize']).tokenize_phonemize(line.strip())]
        phonemes = sum(len(item[2]) for item in sequences if len(item) == 3) + len(sequences) + 1
        if (emission.shape[0] + 1) * (phonemes + 1) * 8 > 256 * 1024 * 1024:
            raise RuntimeError('This transcript requires too much KFA alignment memory; use a shorter recording')
        # Cache hit reuses these exact emissions when run_kfa calls the same stage.
        sys.settrace(trace)
        result = worker.run_kfa(Path(wav_path), transcript, None)
        sys.settrace(previous_trace)
        check()
        if result.get('engine') != 'kfa-local' or result.get('directAlignment') is not True:
            raise RuntimeError('KFA did not return direct acoustic alignment')
        words = adapter.map_words_to_original(transcript, result['words'], khmer_normalize, cancelled)
        payload = {
            'schemaVersion': 1, 'audioSha256': hashlib.sha256(Path(wav_path).read_bytes()).hexdigest(),
            'fullText': transcript, 'engine': 'kfa-local', 'directAlignment': True,
            'words': words, 'referenceWorkerSha256': config['workerSha256'],
            'orthographicMapping': 'exact-khmer-normalize',
        }
        check()
        return json.dumps(payload, ensure_ascii=False)
    finally:
        sys.settrace(previous_trace)
        socket.create_connection, socket.socket.connect, socket.socket.connect_ex, socket.socket.sendto = original_network
        if original_normalizer is not None:
            sys.modules['kfa.text_normalize'] = original_normalizer
        if job_normalizer is not None:
            # Release the Rust object here, before this native worker exits.
            job_normalizer._G2P_MODEL = None
        if worker is not None:
            worker._kfa_session = None
            worker._emission_memory.clear()
        gc.collect()
        sys.stdout, sys.stderr = previous_streams
