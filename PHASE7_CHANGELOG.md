# Phase 7 changelog

## Implemented
- Eighth-note triplet token `t`: each token lasts 1/3 quarter-note beat; three consecutive triplet notes display a `3` bracket and use the same timing in playback and rhythm evaluation.
- Tie handling in playback: same-pitch tied notes are held without retriggering; tied destination notes are omitted from practice note-on expectations.
- Slur and tie curves in notation.
- Staccato, accent, fermata marks and playback behavior.
- Sustain pedal spans in playback and notation for same-system spans.
- Repeat ranges, first/second endings, and D.C. al Fine/Fine playback order and notation labels.
- Three new practical exercises added to the final review lesson.
- Progress/refined design code from previous phases retained.

## Verification
- `npm test`: 52 tests passed, 0 failed.

## Remaining
- Current instrument tone is synthesized; a real sampled piano library is not included.
- Cross-system pedal notation and advanced multi-voice/cross-staff engraving are not yet complete.
