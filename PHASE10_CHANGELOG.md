# Phase 10 changelog — native VST3 host foundation

- Added a JUCE 8.0.10 + CMake native VST3 host source project.
- Added a JSON-lines IPC protocol for host readiness/status, VST3 scanning/loading, MIDI note-on/off, sustain, all-notes-off and volume.
- Added Electron main-process lifecycle/request bridge and a narrow sandboxed preload API.
- Added sound settings controls for scanning installed VST3 plugins, loading one instrument and testing a chord.
- Routed the existing PianoSynth note API to a loaded native host while preserving synth/sample fallback modes.
- Added adapter tests for note routing and fallback after host loss.
- Native compilation and real Windows plugin playback remain unverified; see `docs/VST3_HOST_IMPLEMENTATION.md` and `native/vst-host/README.md`.
