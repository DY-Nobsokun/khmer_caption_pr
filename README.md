# Khmer Captions — saved first working version

Version 0.3.1. Development paused; this folder contains the files needed to load the current plugin on this PC.

In UXP Developer Tool, unload the original plugin before adding this folder's manifest.json, then load it in Premiere Pro 26.3+ on Windows x64. The plugin ID is the same as the original. Enter your Gemini API key in AI connection if needed.

Keep the existing Sthang Studio Python 3.12 runtime, timing site-packages and KFA ONNX model installed at the paths in local-paths.js. These installed dependencies are reused, not duplicated here. This folder is not a standalone installation for another PC. If you move this folder, update the worker and adapter paths in local-paths.js; retain their hashes.

Includes only the active HTML, CSS, JavaScript, KFA Python adapters, local configuration and native caption-service addon. SDKs, build outputs, diagnostics, older panels, experiments, media, transcripts and API keys are excluded. Original project files remain untouched.

Choose WAV or MP4 up to 120 seconds, transcribe with Gemini, review captions and export SRT. Gemini receives the prepared audio when Transcribe is pressed. KFA timing runs locally. Automatic sequence audio and caption-track insertion remain unfinished.
