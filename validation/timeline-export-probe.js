// Paste this entire script into the Khmer Captions UXP Developer Tool console.
// First mark a 0.1–120 second In/Out range in the active Premiere timeline.
// This diagnostic exports locally; it does not transcribe or change the sequence.
(async () => {
  'use strict';
  const ppro = require('premierepro');
  const uxp = require('uxp');
  const fs = uxp.storage.localFileSystem;
  const report = { kind: 'timeline-export-probe', probeVersion: 3, startedAt: new Date().toISOString(), events: [] };
  const listeners = [];
  let encoder, folder;
  globalThis.timelineExportProbeReport = report;

  function inspectWav(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const tag = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF WAV file.');
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('WAV is incomplete or has unexpected trailing bytes.');
    let format, samples;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + size > bytes.length) throw new Error('Incomplete WAV chunk.');
      if (tag(offset) === 'fmt ' && size >= 16) format = {
        encoding: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), blockAlign: view.getUint16(start + 12, true),
        bits: view.getUint16(start + 14, true)
      };
      if (tag(offset) === 'data') samples = { start, size };
      offset = start + size + (size % 2);
    }
    if (!format || !samples || format.encoding !== 1 || format.bits !== 16 ||
        format.channels < 1 || format.sampleRate < 1 || format.blockAlign !== format.channels * 2 ||
        !samples.size || samples.size % format.blockAlign) {
      throw new Error('Expected nonempty 16-bit PCM WAV. Choose the specified Waveform Audio preset.');
    }
    let peak = 0;
    for (let offset = samples.start; offset < samples.start + samples.size; offset += 2) {
      peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
    }
    return { ...format, durationSeconds: samples.size / format.blockAlign / format.sampleRate,
      peak, silent: peak === 0, bytes: bytes.length };
  }

  try {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error('Open a Premiere project first.');
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error('Open the parent sequence containing your nest.');
    const inPoint = await sequence.getInPoint();
    const outPoint = await sequence.getOutPoint();
    const duration = outPoint.seconds - inPoint.seconds;
    if (!Number.isFinite(duration) || duration < 0.1 || duration > 120) {
      throw new Error('Mark an explicit In/Out range between 0.1 and 120 seconds.');
    }
    report.sequenceName = sequence.name;
    report.range = { inTicks: inPoint.ticks, outTicks: outPoint.ticks, durationSeconds: duration };
    report.timebaseTicks = await sequence.getTimebase();
    report.selection = [];
    const selection = await sequence.getSelection();
    for (const item of await selection.getTrackItems()) {
      const start = await item.getStartTime();
      const end = await item.getEndTime();
      const projectItem = ppro.ClipProjectItem.cast(await item.getProjectItem());
      report.selection.push({ name: await item.getName(), startTicks: start.ticks, endTicks: end.ticks,
        isSequence: projectItem ? await projectItem.isSequence() : null });
    }
    encoder = ppro.EncoderManager.getManager();
    if (!encoder || typeof encoder.exportSequence !== 'function') throw new Error('Sequence export API unavailable.');
    report.ameInstalled = encoder.isAMEInstalled;
    const plugin = await fs.getPluginFolder();
    const preset = await plugin.getEntry('presets/timeline-audio.epr');
    const extension = await ppro.EncoderManager.getExportFileExtension(sequence, preset.nativePath);
    if (String(extension).replace(/^\./, '').toLowerCase() !== 'wav') throw new Error('Choose a WAV export preset.');
    console.log('Choose a folder for the diagnostic WAV and report.');
    folder = await fs.getFolder();
    if (!folder) throw new Error('Output folder selection cancelled.');
    const name = 'timeline-export-probe-' + Date.now();
    report.reportName = name + '.json';
    // Premiere's native exporter must receive consistent platform separators.
    // Do not append a forward slash to a Windows nativePath.
    const windowsPath = /^[a-z]:[\\/]|^\\\\/i.test(folder.nativePath);
    const separator = windowsPath ? '\\' : '/';
    const outputFolder = windowsPath ? folder.nativePath.replace(/\//g, '\\') : folder.nativePath;
    report.outputPath = outputFolder.replace(/[\\/]+$/, '') + separator + name + '.wav';
    report.presetPath = preset.nativePath;
    for (const key of ['EVENT_RENDER_COMPLETE', 'EVENT_RENDER_ERROR', 'EVENT_RENDER_CANCEL', 'EVENT_RENDER_PROGRESS']) {
      const eventName = ppro.EncoderManager[key];
      if (!eventName) continue;
      const handler = event => {
        const entry = { type: key, at: new Date().toISOString() };
        for (const field of ['jobID', 'outputFilePath', 'errorMessage', 'progress']) {
          try {
            const value = event && event[field];
            if (['string', 'number', 'boolean'].includes(typeof value)) entry[field] = value;
          } catch (_) {}
        }
        report.events.push(entry);
      };
      ppro.EventManager.addEventListener(encoder, eventName, handler, false);
      listeners.push([eventName, handler]);
    }
    report.exportFull = false;
    const started = Date.now();
    report.apiResult = await encoder.exportSequence(sequence, ppro.Constants.ExportType.IMMEDIATELY,
      report.outputPath, preset.nativePath, false);
    report.apiReturnAfterMs = Date.now() - started;
    if (report.apiResult !== true) throw new Error('Premiere did not report a successful export request.');
    // A boolean alone is insufficient evidence of a complete, valid render.
    const deadline = Date.now() + 45000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const file = await folder.getEntry(name + '.wav');
        if ((await file.getMetadata()).size > 128 * 1024 * 1024) throw new Error('Output exceeds diagnostic size limit.');
        report.wav = inspectWav(await file.read({ format: uxp.storage.formats.binary }));
        break;
      } catch (error) { lastError = String(error); }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!report.wav) throw new Error('No complete readable WAV within 45 seconds: ' + lastError);
    const ticksPerSecond = 254016000000;
    const frameSeconds = Number(report.timebaseTicks) / ticksPerSecond;
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) throw new Error('Invalid sequence timebase.');
    report.durationErrorSeconds = report.wav.durationSeconds - duration;
    report.durationWithinOneFrame = Math.abs(report.durationErrorSeconds) <= frameSeconds + 1 / report.wav.sampleRate;
    report.fileChecksPassed = report.durationWithinOneFrame && !report.wav.silent;
    report.listeningCheck = 'PENDING: compare WAV with parent timeline playback, including trims, nested cuts, fades, speed and track mix.';
  } catch (error) {
    report.error = String(error);
  } finally {
    for (const [name, handler] of listeners) {
      try { ppro.EventManager.removeEventListener(encoder, name, handler, false); } catch (_) {}
    }
    report.finishedAt = new Date().toISOString();
    if (folder && report.reportName) {
      try {
        const file = await folder.createFile(report.reportName, { overwrite: false });
        await file.write(JSON.stringify(report, null, 2));
      } catch (error) { report.reportWriteError = String(error); }
    }
    console.log(JSON.stringify(report, null, 2));
  }
})();
