# Khmer Captions

Version 0.4.1 adds timeline audio alongside the existing WAV/MP4 upload workflow, with automatic WAV export settings. This folder contains the files needed to load the current plugin on this PC.

In UXP Developer Tool, unload the original plugin before adding this folder's manifest.json, then load it in Premiere Pro 26.3+ on Windows x64. The plugin ID is the same as the original. Enter your Gemini API key in AI connection if needed.

Keep the existing Sthang Studio Python 3.12 runtime, timing site-packages and KFA ONNX model installed at the paths in local-paths.js. These installed dependencies are reused, not duplicated here. This folder is not a standalone installation for another PC. If you move this folder, update the worker and adapter paths in local-paths.js; retain their hashes.

Includes the active panel, KFA Python adapters, local configuration and native caption-service addon, plus timeline validation tools and tests. The original sibling project files remain untouched.

Choose WAV or MP4 up to 120 seconds, transcribe with Gemini, review captions and export SRT. Gemini receives the prepared audio when Transcribe is pressed. KFA timing runs locally. Direct caption-track insertion remains unfinished.

To use timeline audio, reload this plugin in UXP Developer Tool, open the parent sequence in Premiere, and mark an In/Out range between 0.1 and 120 seconds. Click **Use timeline audio**. It exports the audible sequence mix, including nested audio, so mute music or other unwanted tracks first. It does not isolate a selected clip. WAV export settings are bundled with the plugin and applied automatically; users do not need to locate or select a preset.

The bundled `presets/timeline-audio.epr` is a copy of the tested Premiere Waveform Audio 48kHz 16-bit preset. Previously saved preset choices are ignored. The audio is exported into temporary plugin storage and converted locally to mono 16 kHz PCM. No output folder selection is needed. The panel sets the SRT offset to the In point in seconds relative to sequence start; the sequence's displayed timecode zero point is stored as metadata and is not added to the offset. Review this field before exporting SRT. To refresh audio after editing the timeline, save the draft and clear the transcript before using timeline audio again.

Cancellation during Premiere's immediate export waits for the host export to return and the output to settle. Cancelled or failed preparation never replaces the previously loaded audio. Temporary files are removed when safely possible; output that might still be written is retained in UXP temporary storage. The combined panel flow needs a live smoke test in Premiere after reload; the export diagnostic, JavaScript integration tests and local WAV conversion have been checked separately.

Run integration checks with `node --test --test-isolation=none tests/timeline-audio.test.cjs`.

The redesigned panel has Generate, Review, and Export navigation, mint cards, a compact mascot header, and one selected-caption editor. Review offers a local audio player, a waveform calculated from the WAV samples, source-relative seek controls, caption preview, previous/next navigation, playback speed, selected-caption playback/looping, and optional caption following. Playing a caption does not change which caption you are editing. Edits are saved in workspace memory immediately; wording edits invalidate timing and approval. Update timing reruns KFA for the full transcript. Use Save draft for a persistent copy.

Playback reads the prepared WAV snapshot, not the live Premiere timeline. It uses UXP's video media element with a filesystem URL; unsupported media runtimes display a playback-unavailable message and leave editing/export available. Browser playback and layout checks do not establish Windows Premiere codec support: after reloading in UXP Developer Tool, verify audible playback, seeking, loop boundaries, Khmer rendering, and native fields with both uploaded and timeline audio. Source changes, operations, and panel disposal stop playback. No additional network permission is required.

Run all automated checks with `node --test --test-isolation=none tests/*.test.cjs`. `validation/panel-browser-smoke.cjs` optionally connects to a local Chrome debugging endpoint on port 9223 to check 460px/340px layouts, playback/caption synchronization with synthetic audio, and SRT export without calling Google. Screenshots are written under `validation/`.

Custom action controls use ordinary elements with explicit button roles, keyboard activation, and synchronized disabled states in panel-controls.js. This avoids the native UXP button surface covering the mint/orange/blue fills. Reload the plugin to load the new control module as well as the stylesheet. Actual rendering still requires a Premiere check.

The compact card layout replaces the accumulated dark-theme CSS and UXP overrides. Workflow badges use explicit horizontal flex layout; button fills are solid to avoid UXP gradient corners. Native details/summary are replaced with controlled disclosures, and dropdowns use custom selection menus while retaining their underlying values. Light field shells surround quiet native text inputs. The browser smoke check verifies disclosure and selection behavior as well as playback/export; native field paint and final visual matching still require a Premiere reload check.
