import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScore } from '../renderer/js/core/music.js';
import { practiceGroups, WaitEvaluator, RhythmEvaluator } from '../renderer/js/engine/evaluator.js';

const melody = buildScore({
  timeSignature: '4/4',
  staves: { rh: ['C4/q D4/q E4/q C4/q', 'E4/h G4/h'], lh: ['C3+E3/w', 'r/w'] },
});

test('practiceGroups groups by onset and respects hands', () => {
  const rh = practiceGroups(melody, ['rh']);
  assert.deepEqual(rh.map((g) => g.midis), [[60], [62], [64], [60], [64], [67]]);
  const both = practiceGroups(melody, ['rh', 'lh']);
  assert.deepEqual(both[0].midis, [48, 52, 60]); // chord + RH note at beat 0
  assert.equal(both[0].eventIds.length, 2);
  assert.equal(both.length, 6);
});

test('WaitEvaluator: correct sequence with a repeated note', () => {
  const ev = new WaitEvaluator(melody, ['rh']);
  const play = [60, 62, 64, 60, 64, 67];
  play.forEach((m, i) => {
    const r = ev.noteOn(m);
    assert.equal(r.type, 'correct');
    assert.equal(r.complete, true);
    assert.equal(r.finished, i === play.length - 1);
  });
  const s = ev.summary();
  assert.equal(s.accuracy, 1);
  assert.equal(s.errors, 0);
  assert.equal(ev.noteOn(60).type, 'ignored');
});

test('WaitEvaluator: wrong notes are counted and break the first-try score for that group only', () => {
  const ev = new WaitEvaluator(melody, ['rh']);
  assert.equal(ev.noteOn(61).type, 'wrong');
  assert.equal(ev.noteOn(60).clean, false);
  ev.noteOn(62); ev.noteOn(64); ev.noteOn(60); ev.noteOn(64); ev.noteOn(67);
  const s = ev.summary();
  assert.equal(s.errors, 1);
  assert.equal(s.firstTry, 5);
  assert.ok(Math.abs(s.accuracy - 5 / 6) < 1e-9);
  assert.equal(s.completed, 6);
});

test('WaitEvaluator: chords in any order, duplicates ignored', () => {
  const ev = new WaitEvaluator(melody, ['rh', 'lh']);
  assert.deepEqual(ev.current.midis, [48, 52, 60]);
  assert.equal(ev.noteOn(60).complete, false);
  assert.equal(ev.noteOn(60).type, 'duplicate');
  assert.deepEqual(ev.remaining, [48, 52]);
  assert.equal(ev.noteOn(52).complete, false);
  const last = ev.noteOn(48);
  assert.equal(last.complete, true);
  assert.deepEqual(ev.current.midis, [62]);
});

test('RhythmEvaluator: hits are graded by timing and offsets are averaged', () => {
  const t0 = 100;
  const ev = new RhythmEvaluator(melody, { hands: ['rh'], tempo: 60, t0 }); // 1 s per beat
  // beats 0,1,2,3 -> C D E C ; beats 4 -> E (half) ; beat 6 -> G
  assert.equal(ev.noteOn(60, t0 + 0.02).grade, 'perfect');
  assert.equal(ev.noteOn(62, t0 + 1 + 0.12).grade, 'good');
  assert.equal(ev.noteOn(64, t0 + 2 - 0.2).grade, 'ok');
  const r = ev.noteOn(60, t0 + 3);
  assert.equal(r.type, 'hit');
  const s = ev.summary();
  assert.equal(s.hits, 4);
  assert.equal(s.perfect + s.good + s.ok, 4);
  assert.equal(s.meanOffsetMs, Math.round(((0.02 + 0.12 - 0.2 + 0) / 4) * 1000));
});

test('RhythmEvaluator: wrong pitch / too far off time are extras; windows close into misses', () => {
  const t0 = 0;
  const ev = new RhythmEvaluator(melody, { hands: ['rh'], tempo: 60, t0 });
  const wrongPitch = ev.noteOn(61, 0);
  assert.equal(wrongPitch.type, 'extra');
  assert.equal(wrongPitch.reason, 'pitch');
  const tooEarly = ev.noteOn(62, 0.4); // D expected at 1.0 s; 0.6 s early is outside the window
  assert.equal(tooEarly.type, 'extra');
  assert.equal(tooEarly.reason, 'timing');
  assert.deepEqual(ev.tick(0.1), []);
  const missed = ev.tick(1.3); // C at 0 (window closed), D at 1 (window 0.75..1.25 closed)
  assert.equal(missed.length, 2);
  assert.equal(ev.eventStatus('m0-rh-0'), 'missed');
  assert.equal(ev.eventStatus('m0-rh-2'), 'pending');
  ev.finalize();
  assert.equal(ev.finished, true);
  const s = ev.summary();
  assert.equal(s.hits, 0);
  assert.equal(s.missed, 6);
  assert.equal(s.extras, 2);
  assert.equal(s.accuracy, 0);
});

test('RhythmEvaluator: latency offset shifts judged time; tendency is reported', () => {
  const ev = new RhythmEvaluator(melody, { hands: ['rh'], tempo: 60, t0: 0, offset: 0.1 });
  // The player always presses 100 ms after the beat; with the offset it is judged perfect.
  assert.equal(ev.noteOn(60, 0.1).grade, 'perfect');
  const late = new RhythmEvaluator(melody, { hands: ['rh'], tempo: 60, t0: 0 });
  late.noteOn(60, 0.1); late.noteOn(62, 1.1); late.noteOn(64, 2.1);
  assert.equal(late.summary().tendency, 'late');
  const early = new RhythmEvaluator(melody, { hands: ['rh'], tempo: 60, t0: 0 });
  early.noteOn(60, -0.1); early.noteOn(62, 0.9);
  assert.equal(early.summary().tendency, 'early');
});

test('RhythmEvaluator: chord notes are separate slots of one event; window shrinks at fast tempos', () => {
  const ev = new RhythmEvaluator(melody, { hands: ['lh'], tempo: 60, t0: 0 });
  assert.equal(ev.slots.length, 2);
  ev.noteOn(48, 0.01);
  assert.equal(ev.eventStatus('m0-lh-0'), 'pending');
  ev.noteOn(52, 0.03);
  assert.equal(ev.eventStatus('m0-lh-0'), 'hit');
  const fast = new RhythmEvaluator(melody, { hands: ['rh'], tempo: 200, t0: 0 }); // 0.3 s per beat
  assert.ok(fast.windows.ok <= 0.45 * 0.3 + 1e-9);
  assert.ok(fast.windows.perfect < 0.07);
});

test('tied destination notes are sustained, not requested as a second key press', () => {
  const tied = buildScore({
    timeSignature: '4/4',
    staves: { rh: ['C4/q D4/q D4/q E4/q'], lh: ['r/w'] },
    ties: [['m0-rh-1', 'm0-rh-2']],
  });
  const groups = practiceGroups(tied, ['rh']);
  assert.deepEqual(groups.map(g => g.midis), [[60], [62], [64]]);
  const ev = new WaitEvaluator(tied, ['rh']);
  [60, 62, 64].forEach(m => ev.noteOn(m));
  assert.equal(ev.finished, true);
});


test('practice evaluation follows repeat playback order and alternate endings', () => {
  const score = buildScore({
    timeSignature: '4/4',
    staves: { rh: ['C4/w', 'D4/w', 'E4/w'], lh: ['r/w', 'r/w', 'r/w'] },
    repeat: { startMeasure: 0, endMeasure: 2, count: 2 },
    endings: [{ startMeasure: 1, endMeasure: 1, pass: 1 }, { startMeasure: 2, endMeasure: 2, pass: 2 }],
  });
  const groups = practiceGroups(score, ['rh']);
  assert.deepEqual(groups.map(g => g.midis), [[60], [62], [60], [64]]);
});
