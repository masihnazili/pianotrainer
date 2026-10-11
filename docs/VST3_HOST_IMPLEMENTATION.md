# Phase 10 — VST3 host foundation

## Implemented in source

- Native C++ host project using JUCE 8.0.10 and CMake, with VST3 hosting enabled.
- A separate native process, rather than loading third-party plugin binaries inside Electron.
- Newline-delimited JSON protocol for readiness/status, scan, load, note-on/off, sustain, all-notes-off, and volume.
- Scanning of standard Windows VST3 folders and loading one selected plugin instance.
- Audio-device callback routes plugin output to the default JUCE audio device and delivers queued MIDI events.
- Electron main-process bridge starts/stops the native process, validates allowed commands, correlates requests, and relays host events via a narrow preload API.
- Sound settings UI can scan installed VST3 plugins, load a selected instrument, and play a short test chord.
- Existing lesson/player API can route notes through the VST3 adapter; synth and sample modes remain available.

## Not yet verified / next tasks

1. Build the C++ host on Windows; this environment did not build JUCE or validate the binary.
2. Test a known instrument VST3 on a real audio output and confirm sound, note release, sustain, polyphony, and timing.
3. Add custom plugin-directory selection and cache scan results.
4. Add plugin editor window support, state persistence, device/sample-rate selection, and crash recovery.
5. Remove locks from the real-time callback by using safe ownership handoff / lock-free MIDI queue.
6. Add Windows packaging so the built host ships with the Electron app.
7. Review JUCE and third-party plugin licensing before redistribution.

## Safety / stability

Third-party VST3 plugins execute native code. They are loaded in a separate child process to reduce the risk to the Electron UI, but this is not a security sandbox. Only install plugins from sources the user trusts. If the host exits, the UI falls back to the built-in sound engine.
