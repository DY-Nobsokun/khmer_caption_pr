"""Development-only, offline KFA adapter. Never launched by the Premiere panel.

Run using Studio's existing timing Python. No downloads, Whisper fallback,
Gemini requests, or modification of the Studio installation are performed.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import wave
import socket
import sys
import re
import unicodedata

os.environ['ORT_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['DO_NOT_TRACK'] = '1'
sys.dont_write_bytecode = True


def prepare(request_path, wav_path):
    if request_path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Request must be under 2 MB')
    request = json.loads(request_path.read_text(encoding='utf-8-sig'))
    if request.get('schemaVersion') != 1 or request.get('kind') != 'sthang-kfa-request':
        raise ValueError('Export a KFA request from the Gemini panel')
    text = request.get('fullText')
    if not isinstance(text, str) or not text.strip() or len(text) > 60000:
        raise ValueError('Request transcript is empty or too large')
    if wav_path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('WAV must be under 10 MB')
    digest = hashlib.sha256(wav_path.read_bytes()).hexdigest()
    if digest != request.get('audioSha256'):
        raise ValueError('WAV does not match the exact audio selected in the panel')
    with wave.open(str(wav_path), 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getframerate() != 16000 or audio.getsampwidth() != 2 or audio.getcomptype() != 'NONE':
            raise ValueError('Use mono 16 kHz 16-bit PCM WAV')
        duration_ms = audio.getnframes() / 16
        if not 100 <= duration_ms <= 300000 or duration_ms != request.get('durationMs'):
            raise ValueError('WAV duration does not match the request')
    return request, digest


def _map_words_individually(full_text, words, normalize):
    """Remap only orthographically equivalent whole words; never split times.

    KFA normalizes compound Khmer vowels before tokenization. Recover the
    owner's original codepoints using exact normalized equality, without fuzzy
    matching, guessing missing words, or changing any acoustic boundary.
    """
    compact = lambda value: re.sub(r'\s', '', value)
    canonical = lambda value: compact(normalize(value))
    if canonical(full_text) != canonical(''.join(word['text'] for word in words)):
        raise ValueError('KFA changed or omitted wording beyond supported Khmer orthographic normalization')
    cursor = 0
    mapped = []
    for word in words:
        target = canonical(word['text'])
        if not target:
            raise ValueError('KFA returned an empty orthographic word')
        found = None
        # Bound work for malformed/ambiguous input. No quadratic full-clip scan.
        maximum = min(len(full_text), cursor + min(4096, len(target) * 4 + 32))
        for end in range(cursor + 1, maximum + 1):
            candidate = full_text[cursor:end]
            if canonical(candidate) == target:
                found = end
                break
        if found is None:
            raise ValueError('Cannot map a KFA word to an exact original orthographic span')
        original = full_text[cursor:found].strip()
        mapped.append({**word, 'text': original, 'acousticText': word['text']})
        cursor = found
    if full_text[cursor:].strip():
        raise ValueError('KFA timing does not cover the remaining original text')
    return mapped


def map_words_to_original(full_text, words, normalize, cancelled=None):
    """Preserve exact original spelling and measured acoustic boundaries.

    Normalization can expand/reorder a Khmer cluster across a tokenizer boundary.
    If individual words cannot map, keep only shared, stable prefix boundaries
    and merge adjacent whole acoustic anchors. Never split or estimate times.
    """
    canonical = lambda text: re.sub(r'\s', '', normalize(text))
    normalized = canonical(full_text)
    if not normalized or normalized != canonical(''.join(w['text'] for w in words)):
        raise ValueError('KFA changed or omitted wording beyond supported Khmer orthographic normalization')
    try:
        return _map_words_individually(full_text, words, normalize)
    except ValueError:
        pass
    if len(full_text) > 12000:
        raise ValueError('Transcript is too large for safe orthographic boundary mapping; use a shorter recording')

    # Record boundaries in the normalized full prefix, rather than normalizing
    # each isolated word (which loses the neighboring combining-character context).
    cuts = {}
    acoustic_prefix = ''
    previous = 0
    for index, word in enumerate(words):
        if cancelled is not None and cancelled():
            raise RuntimeError('KFA alignment cancelled')
        start, end = word.get('startMs'), word.get('endMs')
        if (not isinstance(start, int) or not isinstance(end, int) or
                start < previous or end <= start or word.get('derived')):
            raise ValueError('KFA returned invalid acoustic boundaries')
        previous = end
        acoustic_prefix += word['text']
        prefix = canonical(acoustic_prefix)
        if prefix and normalized.startswith(prefix):
            cuts[prefix] = index + 1

    matches = {}
    for end in range(1, len(full_text) + 1):
        if cancelled is not None and cancelled():
            raise RuntimeError('KFA alignment cancelled')
        # Do not cut inside combining marks, coeng sequences or joiners.
        if end < len(full_text):
            if (unicodedata.category(full_text[end]).startswith('M') or
                    full_text[end] in '\u200c\u200d' or
                    full_text[end-1] in '\u17d2\u200c\u200d'):
                continue
        prefix = canonical(full_text[:end])
        if prefix in cuts:
            matches[cuts[prefix]] = end

    if matches.get(len(words)) != len(full_text):
        raise ValueError('Cannot map complete KFA wording back to the original transcript')
    mapped = []
    cursor = first_word = 0
    for stop_word, stop_text in sorted(matches.items()):
        if stop_text <= cursor:
            continue
        group = words[first_word:stop_word]
        original = full_text[cursor:stop_text].strip()
        if not group or not original:
            continue
        row = {**group[0], 'text': original, 'endMs': group[-1]['endMs'],
               'acousticText': ''.join(w['text'] for w in group)}
        if len(group) > 1:
            row.pop('confidence', None)
            row['mergedAcousticWords'] = len(group)
        mapped.append(row)
        cursor, first_word = stop_text, stop_word
    if cursor != len(full_text) or first_word != len(words):
        raise ValueError('KFA mapping did not cover the complete original transcript')
    return mapped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--wav', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--studio-root', type=Path, default=Path(os.environ.get('LOCALAPPDATA', '.')) / 'Sthang Studio' / 'app')
    parser.add_argument('--check', action='store_true', help='Validate input only; do not load KFA')
    args = parser.parse_args()
    request, digest = prepare(args.request, args.wav)
    if args.check:
        print('Exact WAV and transcript request validated; no inference or network request performed.')
        return
    worker_path = args.studio_root / 'local-timing' / 'worker.py'
    model_path = Path(os.environ.get('LOCALAPPDATA', '.')) / 'kfa' / 'wav2vec2-km-base-1500.onnx'
    if not worker_path.is_file() or not model_path.is_file():
        raise RuntimeError('Existing Studio timing worker and local KFA ONNX model are required. This script does not install them.')
    if args.output.resolve() in {args.request.resolve(), args.wav.resolve(), worker_path.resolve(), model_path.resolve()}:
        raise ValueError('Output must not overwrite an input, worker, or model')
    if args.output.exists():
        raise FileExistsError('Choose a new output filename; existing evidence is not overwritten')
    # Librosa/Numba must not try to write caches into the installed Studio venv.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cache_dir = args.output.parent / '.kfa-numba-cache'
    cache_dir.mkdir(exist_ok=True)
    os.environ['NUMBA_CACHE_DIR'] = str(cache_dir.resolve())
    spec = importlib.util.spec_from_file_location('sthang_existing_timing_worker', worker_path)
    worker = importlib.util.module_from_spec(spec)
    # Block any transitive dependency's network access for this entire process,
    # including libraries which do not honour Hugging Face offline variables.
    def no_network(*_args, **_kwargs):
        raise RuntimeError('Network access is disabled in the local KFA adapter')
    socket.create_connection = no_network
    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network
    socket.socket.sendto = no_network
    spec.loader.exec_module(worker)
    # Use the installed reference's full preprocessing/phonemizer/alignment flow.
    # Calling KFA directly prevents any silent substitution of Whisper timestamps.
    result = worker.run_kfa(args.wav, request['fullText'], None)
    if result.get('engine') != 'kfa-local' or result.get('directAlignment') is not True:
        raise RuntimeError('KFA did not return direct alignment evidence')
    from khmernormalizer.khnormal import khmer_normalize
    mapped = map_words_to_original(request['fullText'], result['words'], khmer_normalize)
    payload = {
        'schemaVersion': 1, 'audioSha256': digest, 'fullText': request['fullText'],
        'engine': 'kfa-local', 'directAlignment': True, 'words': mapped,
        'orthographicMapping': 'exact-khmer-normalize',
        'referenceWorkerSha256': hashlib.sha256(worker_path.read_bytes()).hexdigest(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as out:
        json.dump(payload, out, ensure_ascii=False, indent=2)
    print('Local KFA evidence saved. Import into the panel; spelling/timing checks and manual review still apply.')


if __name__ == '__main__':
    main()
