# Piano Trainer — Native VST3 Host (Phase 10)

This is the first implementation slice of a native VST3 instrument host. The Electron UI talks to this process over newline-delimited JSON on stdin/stdout. The host owns the audio device, scans standard Windows VST3 locations, instantiates one selected plugin, and forwards MIDI note-on/off, sustain, all-notes-off, and master volume commands.

## Requirements (Windows)

- Visual Studio 2022 Build Tools with **Desktop development with C++**
- CMake 3.22+
- Git and network access for the first configure (JUCE is fetched and pinned to 8.0.10)
- A 64-bit VST3 instrument plugin installed on the machine
- Review JUCE's current licensing before distributing this host: https://juce.com/get-juce/ and https://juce.com/juce-licensing-faq/

## Build

Run PowerShell from the project root:

```powershell
cmake -S native/vst-host -B native/vst-host/build -A x64
cmake --build native/vst-host/build --config Release
```

The expected executable is `native/vst-host/build/Release/PianoVstHost.exe`. Electron looks for it there. If it is missing, the UI reports that the host must be built instead of pretending VST support is active.

## Protocol

One JSON object per line. Each request has a `requestId`; each response echoes it.

- `{"cmd":"scan","requestId":"1"}` → `scanResult` with `name`, `manufacturer`, `file`, `identifier`, `instrument`
- `{"cmd":"load","file":"...vst3","requestId":"2"}` → `pluginLoaded`
- `{"cmd":"noteOn","midi":60,"velocity":0.8,"delayMs":0,"requestId":"3"}`
- `{"cmd":"noteOff","midi":60,"delayMs":0,"requestId":"4"}`
- `{"cmd":"sustain","down":true,"delayMs":0,"requestId":"5"}`
- `{"cmd":"allNotesOff","requestId":"6"}`
- `{"cmd":"volume","value":0.8,"requestId":"7"}`
- `{"cmd":"status","requestId":"8"}`

The `ready` event reports the audio device selected by JUCE. The host currently scans standard VST3 folders only; custom-folder selection and plugin editor windows are later milestones.

## Current limitations

- Initial prototype: one plugin instance at a time; no plugin GUI/editor embedding yet.
- Native build and actual audio playback must be tested on Windows with installed plugins.
- Audio callback currently protects plugin lifetime with a lock. Before a production release, replace this with a real-time-safe handoff and test for glitches.
- MIDI events are scheduled by a relative delay; precise latency calibration across the Web Audio and native audio clocks remains to be tested.
- The host does not bundle third-party VST3 instruments.
