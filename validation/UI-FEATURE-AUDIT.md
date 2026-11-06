# New UI feature audit — 2026-11-07

Latest automated result: **36/36 passing** with `node --test --test-isolation=none tests/*.test.cjs`.

Playback follow-up: handle null IDs on unnamed UXP controls, isolate optional artwork failures from player initialization, enable audio playback from loaded metadata, and explicitly load with sound enabled. Added integration coverage for recording selection through running caption preview and editing. Looping at the end of media and previous/next navigation after the final caption are covered. Initialization failures now appear inside Listen & verify instead of leaving the initial placeholder unchanged. These checks use simulated media events; audible playback in Premiere remains a live check.

Covered with simulated host responses: source selection and replacement safeguards, timeline export range validation and normalization, cancellation and cleanup, Generate/Review/Export navigation, Gemini-to-KFA orchestration, timing failure recovery, transcript edits, regrouping and approval reset, draft save/load and audio matching, offset validation, reviewed SRT export, and workspace clearing. Playback tests cover caption synchronization, seeking, selected-caption playback, loops, and media-error fallback. Custom controls have keyboard and disabled-state checks.

Fixed during this audit:

- Show Review as soon as Gemini supplies the transcript, so failed or cancelled KFA timing leaves the transcript and recovery tools visible.
- Report a cancelled draft save accurately instead of displaying “Draft saved.”

Local prerequisite checks: configured Python runtime, timing site-packages, ONNX model, worker, and adapter exist. Worker and adapter hashes match configuration. The Windows native addon exists. All assets and scripts referenced by the HTML exist. These are presence checks, not proof of successful native execution.

The Chrome browser smoke check could not connect to its local debugging endpoint on port 9223 during this audit; no new browser rendering result is claimed. The UI appearance was already approved by the user.

## Required live Premiere verification

Reload the plugin in UXP Developer Tool, then verify:

1. Save/use/forget a Gemini key; transcribe a short Khmer recording and confirm real Gemini and local KFA results.
2. Prepare both a supported WAV and an MP4; verify audible playback, seeking, speed, caption looping, and Khmer text editing.
3. Capture a marked parent-sequence range containing nested cuts/fades; compare the captured audio with the audible timeline mix and verify the In-point SRT offset.
4. Edit wording/times, update timing, regroup, approve, save/reopen a draft, and export/import SRT into Premiere.
5. Cancel preparation/transcription/timing and verify the panel unlocks and preserves available work.

Live Google requests, native decoding/alignment, secure storage, Premiere export, and UXP media support were not exercised by the automated tests. Direct caption-track insertion remains unfinished; the supported output is SRT for manual import into Premiere.
