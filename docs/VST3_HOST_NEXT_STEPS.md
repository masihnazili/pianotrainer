# VST3 host — next steps after Phase 10

- [x] Add a JUCE/CMake native host project with VST3 hosting enabled.
- [x] Add a newline-delimited JSON protocol for scan/load/MIDI/status/volume.
- [x] Add an Electron main/preload bridge with a narrow allow-listed command API.
- [x] Add VST3 scan/load/test controls to sound settings.
- [ ] Build the native host on Windows and test against at least one real VST3 instrument.
- [ ] Route all scheduled notes through the host and measure latency/jitter under real load.
- [ ] Add custom VST3 folder selection, scan cache, and plugin editor windows.
- [ ] Replace the audio callback's plugin mutex with a real-time-safe ownership handoff.
- [ ] Add crash recovery and native host packaging for Windows releases.
- [ ] Review JUCE and third-party plugin licenses before distribution.

A selector alone is not VST support. Phase 10 includes the native host source and UI bridge, but the actual runtime remains unavailable until the native executable is built and tested on Windows.
