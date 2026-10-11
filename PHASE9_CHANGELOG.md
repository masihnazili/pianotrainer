# Phase 9 changelog — sampled piano foundation

- Version bumped to 0.9.0.
- Added a sound settings panel in the app header.
- Added local WAV sample-bank loading and note-name/MIDI-number filename parsing.
- Added nearest-root sample selection and semitone transposition for notes without an exact sample.
- Added sample voice release handling while preserving the existing piano engine API.
- Kept synthesized sound as a no-setup fallback.
- Added automated tests for sample filename parsing and nearest-root selection.
- Documented the proposed native VST3 host architecture and explicitly recorded that a VST3 host is not part of this build yet.
