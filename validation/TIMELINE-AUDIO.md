# Version 2: timeline audio export validation

Status: user-reported export success after the Windows path correction; successful WAV/report inspected. Broader nested-content listening checks and the combined panel smoke test remain pending.
Investigation date: 2026-11-06. Installed Premiere executable: 26.3.0.93.
The current panel is version 0.4.1, with a 26.3 minimum host version. Upload remains available alongside the new timeline In/Out feature. WAV export settings are bundled and applied automatically.

## Findings

- `EncoderManager.exportSequence(sequence, exportType, outputFile, presetFile, exportFull)` is documented since 25.6. Adobe's sample uses `Constants.ExportType.IMMEDIATELY` to export inside Premiere. AME queueing is a separate option.
- `Sequence.getSelection()` and selected track items' `getStartTime()` / `getEndTime()` expose parent timeline boundaries. These differ from source `getInPoint()` / `getOutPoint()`; use parent boundaries for a selected nest.
- `ClipProjectItem.isSequence()` identifies sequence project items; do not depend on the project item's `type` property, which requires 27.0.
- Sequence In/Out getters and setter actions are documented since 25.6. The export signature has no explicit start/end parameters. `exportFull=false` is the candidate for marked-range export; its exact behavior needs the live duration check because Adobe's reference does not describe the flag in detail.
- Rendering the parent sequence's mix is the proposed way to retain nested edits and parent processing. Correctness for nested cuts, effects, speed and audio routing is an expectation to test, not an established result.
- Selection defines a time range, not automatic audio isolation. Other audible tracks in that range may be included. A nest containing only video with detached audio elsewhere must not be treated as proof that the selected nest contains that audio.
- The existing transcription/timing pipeline accepts mono 16 kHz, 16-bit PCM WAV, 0.1–120 seconds. Premiere has an installed Waveform Audio 48kHz 16-bit preset. Production needs a verified mono 16 kHz preset or a local conversion step after export.
- Timeline integration is now implemented separately in `timeline-audio.js`, which uses the Premiere API and reuses the existing native preparation engine. The original upload host remains intact.

## Run the diagnostic

The running Premiere and UXP Developer Tool processes were found, but no accessible Premiere scripting/debugging connection was available from this session. The user ran the first probe manually. The probe is separate from the working panel.

### First live result and retry

The user's report `timeline-export-probe-1793967622550.json` records a 30.3636667-second range in `YIGF Reel_1`. Premiere threw error code 10: "You do not have permission to create or delete the output file" / "Export Unable To Delete Existing File." No WAV was present. UXP successfully wrote the JSON into the chosen folder, so this demonstrates a native export failure, not that all writes to that folder are denied.

The first probe constructed a mixed-separator Windows path (`C:\...\test/filename.wav`). Probe version 2 uses consistent native Windows separators and records the preset path. This corrects the path construction; whether it resolves the export failure requires a retry. Do not treat it as a confirmed root cause or broaden plugin permissions on this evidence alone.

Paste the entire updated probe into the console again and choose the same preset and output folder. Confirm the new JSON contains `probeVersion: 2`. If error 10 persists, compare a manual Premiere WAV export to that folder with the same preset/range, then try the probe in another user-selected folder to distinguish native exporter/path issues from folder access restrictions.

### Successful retry

Report `timeline-export-probe-1793967789523.json` records `apiResult=true`, a stereo 48 kHz 16-bit WAV, a nonzero peak, and duration 30.3636666667 seconds with zero duration error. No encoder events were observed. The user confirmed the export worked. A local decoder harness then converted that actual WAV to mono 16 kHz PCM accepted by the caption core: 30,363.625 ms, less than one sample of duration difference. These observations validate this export and local conversion; they do not certify every nest/effect combination.

1. In Premiere, open a test project and the **parent** sequence containing a nest with multiple trimmed clips. Mark an explicit In/Out range of 0.1–120 seconds. Select the nest to include its boundaries in the report. Use distinguishable speech/cuts so listening can reveal incorrect source ranges.
2. Open the Khmer Captions plugin's **Debug** console in UXP Developer Tool. Paste the entire contents of `timeline-export-probe.js`.
3. Probe version 3 automatically uses `presets/timeline-audio.epr` from the loaded plugin. No preset picker is shown. Reload the current plugin before running the probe.
4. Choose an output folder. The probe requests immediate local export of the current In/Out range and writes a uniquely named WAV and JSON report. It makes no sequence edits, invokes no transcription, and sends no audio online.
5. Confirm `apiResult=true`, a complete PCM WAV, non-silent output, and `durationWithinOneFrame=true`. The report also records observed encoder events; these are documented in terms of AME and cannot yet be assumed to fire for immediate exports. Lack of an event alone does not invalidate an otherwise valid WAV.
6. Listen to the WAV and compare it with playback over the marked parent timeline range. Passing file checks does not prove the correct audio content.

If an export takes longer than the diagnostic's post-return 45-second observation window, the report can fail while Premiere continues rendering. The probe does not attempt to cancel Premiere exports or delete output. A rejected request, popup, missing output, or incorrect range must be recorded as a failure, not worked around silently.

## Required cases before replacing the file picker

| Case | Evidence required |
| --- | --- |
| One trimmed audio clip | Only the audible trimmed section, correct duration |
| Nest containing several trimmed clips | Same cuts/order as parent playback |
| Trimmed nest with a nonzero source In | Correct portion of the nest |
| Nested sequence inside another nest | Correct parent range and audio |
| Linked video/audio selected together | One range, no duplicate render |
| Parent track mute/solo, overlapping music | Matches the intended audible parent mix |
| Fades, gain, speed changes | Match Premiere playback; note any unsupported effects |
| Nonzero timeline placement/timecode | Capture range start and sequence zero point; validate caption placement separately |
| Cancelled export, offline media, invalid preset | No transcription of missing, stale or partial output |
| Missing/cleared In/Out or range over 120 seconds | Reject ambiguous or unsupported range |

## Implementation

Version 0.4.0 implements marked In/Out range export alongside upload, avoiding changes to the project's range markers. Selected-nest range export remains a later step once temporary range changes and exact restoration have been verified, including initially unset markers. A clone is another candidate but needs testing for routing/effect equivalence and cleanup; do not assume it is transparent.

Capture sequence identity, range start/end ticks, zero point, and the exported audio hash. Export and normalize locally, then reuse Gemini and KFA. Preserve leading silence so offsets remain meaningful. Keep the 120-second limit until chunking and caption merging are separately designed. Direct caption insertion remains separate.

## Primary references

- [Adobe EncoderManager reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager)
- [Adobe direct export sample](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/main/sample-panels/premiere-api/src/export.ts)
- [Adobe Sequence reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence)
- [Adobe AudioClipTrackItem reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/audiocliptrackitem)
- [Adobe ClipProjectItem reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem)
- [Adobe encoder event sample](https://github.com/AdobeDocs/uxp-premiere-pro-samples/blob/main/sample-panels/premiere-api/src/eventManager.ts)
