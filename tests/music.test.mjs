import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePitch, parseToken, parseTimeSignature, buildScore, keySignatureInfo, keyAlteration, midiToName, midiToFrequency } from '../renderer/js/core/music.js';

test('parsePitch computes MIDI numbers and diatonic index', () => {
  assert.equal(parsePitch('C4').midi, 60);
  assert.equal(parsePitch('A4').midi, 69);
  assert.equal(parsePitch('F#4').midi, 66);
  assert.equal(parsePitch('Bb3').midi, 58);
  assert.equal(parsePitch('E4').diatonic, 4 * 7 + 2);
  assert.throws(() => parsePitch('H4'));
});

test('midi helpers', () => {
  assert.equal(midiToName(60), 'C4');
  assert.equal(midiToName(61), 'C#4');
  assert.ok(Math.abs(midiToFrequency(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFrequency(60) - 261.6256) < 1e-3);
});

test('parseToken handles notes, dots, fingers, chords, rests, lyrics', () => {
  const n = parseToken('C4/q:1');
  assert.equal(n.beats, 1); assert.deepEqual(n.fingers, [1]);
  const d = parseToken('D4/h.');
  assert.equal(d.beats, 3); assert.equal(d.dotted, true);
  const c = parseToken('G3+C3+E3/w:1-5-3');
  assert.deepEqual(c.pitches.map((p) => p.midi), [48, 52, 55]); // sorted ascending
  const r = parseToken('r/e');
  assert.equal(r.rest, true); assert.equal(r.beats, 0.5);
  const l = parseToken('E4/q:3@fa-');
  assert.equal(l.lyric, 'fa-');
  assert.throws(() => parseToken('C4/x'));
  assert.throws(() => parseToken('C3+E3/w:1')); // finger count mismatch
});

test('parseTimeSignature', () => {
  assert.equal(parseTimeSignature('4/4').beatsPerMeasure, 4);
  assert.equal(parseTimeSignature('3/4').beatsPerMeasure, 3);
  assert.equal(parseTimeSignature('6/8').beatsPerMeasure, 3);
  assert.equal(parseTimeSignature('2/2').beatsPerMeasure, 4);
});

test('buildScore validates measure lengths and builds a timeline', () => {
  const s = buildScore({ timeSignature: '4/4', staves: { rh: ['C4/q D4/q E4/h', 'C4/w'], lh: ['r/w', 'C3/h E3/h'] } });
  assert.equal(s.measures.length, 2);
  assert.equal(s.totalBeats, 8);
  const rhNotes = s.timeline.filter((e) => e.staff === 'rh' && !e.rest);
  assert.deepEqual(rhNotes.map((e) => e.startBeat), [0, 1, 2, 4]);
  assert.throws(() => buildScore({ timeSignature: '4/4', staves: { rh: ['C4/q D4/q E4/q'] } }), /3 beats/);
  assert.throws(() => buildScore({ timeSignature: '4/4', staves: {} }));
});

test('missing staff is filled with whole-measure rests', () => {
  const s = buildScore({ timeSignature: '3/4', staves: { rh: ['C4/h.'] } });
  const lh = s.timeline.filter((e) => e.staff === 'lh');
  assert.equal(lh.length, 1);
  assert.equal(lh[0].rest, true);
  assert.equal(lh[0].wholeMeasureRest, true);
  assert.equal(lh[0].beats, 3);
});

test('key signatures', () => {
  assert.deepEqual(keySignatureInfo('G'), { count: 1, type: 'sharp', letters: ['F'] });
  assert.deepEqual(keySignatureInfo('F'), { count: 1, type: 'flat', letters: ['B'] });
  assert.deepEqual(keySignatureInfo('Am'), { count: 0, type: null, letters: [] });
  assert.equal(keyAlteration('G', 'F'), 1);
  assert.equal(keyAlteration('F', 'B'), -1);
  assert.equal(keyAlteration('C', 'F'), 0);
  assert.throws(() => keySignatureInfo('H'));
});
