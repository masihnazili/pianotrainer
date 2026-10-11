# Phase 9 — Audio engine foundation

## Implemented in this phase

- Preserves the existing Web Audio synthesizer as the reliable fallback.
- Adds a sample-bank playback path using user-selected WAV files.
- WAV files are decoded locally in the app; no sample audio is uploaded or downloaded.
- A filename identifies its root pitch: `60.wav`, `C4.wav`, `F#3.wav`, `Bb3.wav`.
- For pitches without an exact sample, playback selects the nearest available root and transposes it. A dense sample bank will sound more natural than a sparse one.
- The same `init`, `noteOn`, `noteOff`, `allNotesOff`, `click`, `now`, `outputLatency` and `setVolume` surface is retained, so lesson transport and assessment logic do not depend on which of the two built-in engines is active.
- Sample files are held in memory for the current app session. The user must reselect them after restarting; the app does not bundle or redistribute third-party sample banks.

## VST3 architecture decision

VST3 cannot be loaded directly as a Web Audio sample. It needs a native plugin host. The intended Windows architecture is:

1. Electron renderer owns lessons, notation, transport UI and assessment.
2. A native audio-host process owns the audio device and loads VST3 plugins.
3. Electron main process mediates a narrow IPC interface; the renderer never gets Node access.
4. The audio API is kept engine-agnostic so a native host can become a third backend without changing lesson data or the evaluator.

The VST3 backend is **not implemented or bundled in Phase 9**. It requires a native host build, plugin scanning/loading, lifecycle and crash isolation, and Windows audio-device testing. JUCE is a candidate host framework; its hosting features are documented at https://docs.juce.com/master/juce__audio__processors__headless_8h.html. Before shipping a JUCE-based host, review JUCE's current licensing options and the license of each third-party plugin.

## Known limitations

- This is a practical sample-bank player, not yet a full SoundFont (SF2/SFZ) renderer.
- One sample per pitch has no velocity-layer switching; velocity currently controls gain. Natural piano timbre benefits from velocity layers and multiple round robins.
- Sample release is a short gain fade; pedal resonance and sympathetic string resonance are not modeled by the sample engine.
- A VST3 plugin host is not included in this build.
- Automated tests cover filename parsing and root-note selection. Real audio playback and latency still need manual testing on Windows.
