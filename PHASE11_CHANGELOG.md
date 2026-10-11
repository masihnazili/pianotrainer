# Phase 11 — Windows installer packaging foundation

- Added electron-builder NSIS configuration for a Windows x64 installer.
- Added a GitHub Actions workflow to run JS tests, build the JUCE-based VST3 host, package the installer, and upload the installer as an artifact.
- Updated native-host discovery so installed builds look for the executable in Electron's resources directory, outside app.asar.

## Important validation and distribution notes

- The workflow must be run in GitHub Actions; this archive does not contain a compiled Windows installer or compiled native host.
- The workflow can fail if the native VST3 host code does not compile or JUCE cannot be fetched.
- No VST3 instrument or piano sample bank is bundled. Users need a compatible installed VST3 instrument for VST3 playback; WAV samples can be loaded through the app's sample-bank interface.
- Review JUCE's license terms before distributing the resulting binary.
