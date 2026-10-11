# WAV piano sample bank format

The Phase 9 sample player accepts user-selected, uncompressed WAV files. Each selected file should contain one clean piano note with a short, low-noise onset and natural decay.

## Naming

Use one of these filename forms:

- `60.wav` — MIDI note 60 (middle C / C4)
- `C4.wav`
- `F#3.wav`
- `Bb3.wav`

Files that do not end in `.wav` or do not contain a supported pitch name are skipped. If two files resolve to the same MIDI note, the last selected file wins.

## Quality guidance

- For a convincing piano, prefer samples across the full played range instead of only a few widely spaced notes.
- A single sample per pitch is supported. Velocity-layer naming and automatic velocity-layer switching are not supported yet.
- Keep samples at a consistent recording level and avoid clipping.
- Only load sample banks you have permission to use. The app does not bundle, redistribute, or fetch sample libraries.
- Sample data is held in memory and must be selected again after restarting the app.
