# Timeline text generation

`Export → Generate text layers` generates all approved caption rows, including
rows hidden by the Review filter. It uses the same offset as SRT export.

Run `node --test --test-isolation=none tests/*.test.cjs` for panel gating,
Unicode/native payload decoding, independent template identities, frame
alignment, host insertion, partial cancellation, and error reporting.

The bundled template comes from the locally installed Adobe Basic Title.
`prepare-text-template.py` extracts its native project and text descriptor,
enables Indic shaping, sets Leelawadee UI, and places text near the bottom.
Runtime JavaScript fills the native text value and MOGRT controls, assigns
independent identities, packages ZIP/gzip containers, and imports each graphic
using the public SequenceEditor API. These native serialization details are
not a public Adobe authoring API and may need revision for future hosts.

## Fixed insertion failure in 0.5.1

Live Premiere 26.3 debugging reproduced `Invalid parameter` for
`insertMogrtFromPath` at `getVideoTrackCount()`: this API accepts only existing
track indices. The same generated file imported successfully on an existing
track. The previous mock incorrectly allowed an index outside the track range.

The module now imports a uniquely named temporary PNG, uses
`createInsertProjectItemAction` with limited shifting to create a new video
track, and removes both the placeholder clip and its own project item in an
undoable transaction before inserting text. A video-only source avoids adding
audio. The stricter mock rejects MOGRT insertion onto nonexistent tracks and
checks placeholder cleanup before the first graphic import. Errors now name
the failed stage.

`node validation/uxp-debug.cjs validation/text-live-smoke.js timeline-text.js`
loads the current module into its connected UXP runtime and checks two captions
plus a second run in a disposable sequence matching the original settings.
The developer tool must be running on port 14001 with this plugin loaded.
This script changes the project temporarily and restores the original active
sequence in `finally`. It does not save the project.

The live check passed: two independent generated graphics, exact requested
timing at a nonzero offset, another run on a second new video track, and
unchanged audio track count. The original sequence's clip counts were also
unchanged after test cleanup. Visual shaping and project reopen were not tested.

Required live check in Premiere 26.3 after reloading the plugin:

1. Approve at least two short Khmer captions with a nonzero offset. Generate
   text layers in a sequence that already contains video and audio.
2. Verify a new upper video track, one graphic per caption, frame-aligned
   boundaries, preserved gaps, and the correct offset relative to sequence
   start. The displayed timecode zero point is not added.
3. Check Khmer shaping, multiline text, and editable text/style in Properties.
   Editing one graphic must leave the other graphics independent.
4. Save/reopen the Premiere project and verify the graphics remain available.
5. Generate again to verify a separate new track. Cancel a longer batch and
   verify the reported partial count matches the track before retrying.

Automated tests use simulated Premiere objects. UXP MOGRT insertion and new-track
creation were additionally checked in the live runtime as described above.
Native font rendering and project reopening remain separate live checks.

The optional `node validation/text-layer-browser-smoke.cjs` checks the Export
layout at 460px/340px and keyboard activation using a simulated host. It needs
a Chrome debugging endpoint on port 9223. That endpoint was unavailable during
this change, so no new browser layout result or screenshot is claimed.
