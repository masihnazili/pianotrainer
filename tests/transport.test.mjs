import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScore } from '../renderer/js/core/music.js';
import { buildSchedule, buildClicks } from '../renderer/js/audio/transport.js';

const score = buildScore({
  timeSignature: '4/4',
  staves: { rh: ['C4/q D4/q E4/h', 'G4/w'], lh: ['C3+E3/w', 'r/w'] },
});

test('schedule times follow tempo', () => {
  const s = buildSchedule(score, { tempo: 60 }); // 1 beat = 1 s
  const rh = s.notes.filter((n) => n.staff === 'rh');
  assert.deepEqual(rh.map((n) => n.on), [0, 1, 2, 4]);
  assert.ok(Math.abs(rh[0].end - 1) < 1e-9);
  assert.ok(rh[0].off < rh[0].end);
  assert.equal(s.total, 8);
  const fast = buildSchedule(score, { tempo: 120 });
  assert.equal(fast.notes.filter((n) => n.staff === 'rh')[1].on, 0.5);
});

test('hands filter and chords', () => {
  const lhOnly = buildSchedule(score, { hands: ['lh'] });
  assert.equal(lhOnly.notes.length, 1);
  assert.deepEqual(lhOnly.notes[0].midis, [48, 52]);
});

test('fromBeat skips earlier notes and shifts time', () => {
  const s = buildSchedule(score, { tempo: 60, fromBeat: 4, hands: ['rh'] });
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].on, 0);
  assert.equal(s.total, 4);
});

test('clicks accent downbeats', () => {
  const clicks = buildClicks(score, { tempo: 60 });
  assert.equal(clicks.length, 8);
  assert.deepEqual(clicks.filter((c) => c.accent).map((c) => c.time), [0, 4]);
});

test('triplet durations, articulations, ties, fermata and pedal are reflected in playback schedule', async () => {
  const expressive = buildScore({
    timeSignature: '4/4',
    staves: {
      rh: ['C4/q D4/t E4/t F4/t G4/q G4/q'],
      lh: ['C3/h G2/h'],
    },
    ties: [['m0-rh-4', 'm0-rh-5']],
    articulations: { 'm0-rh-0': 'accent', 'm0-rh-1': 'staccato', 'm0-rh-5': 'fermata' },
    pedal: [{ startBeat: 0, endBeat: 4 }],
  });
  assert.ok(Math.abs(expressive.timeline.find(e => e.id === 'm0-rh-1').beats - 1/3) < 1e-9);
  const sched = buildSchedule(expressive, { tempo: 60, hands: ['rh'] });
  const accent = sched.notes.find(n => n.id === 'm0-rh-0');
  const staccato = sched.notes.find(n => n.id === 'm0-rh-1');
  assert.equal(accent.velocity, 1);
  assert.ok(staccato.off - staccato.on < 0.2);
  assert.ok(sched.total > 4);
  assert.equal(sched.pedals.length, 2);
});

test('playback expands repeats, first/second endings and D.C. al Fine', async () => {
  const { buildPlaybackTimeline } = await import('../renderer/js/audio/transport.js');
  const repeated = buildScore({
    timeSignature: '4/4',
    staves: { rh: ['C4/w', 'D4/w', 'E4/w'], lh: ['r/w', 'r/w', 'r/w'] },
    repeat: { startMeasure: 0, endMeasure: 2, count: 2 },
    endings: [{ startMeasure: 1, endMeasure: 1, pass: 1 }, { startMeasure: 2, endMeasure: 2, pass: 2 }],
  });
  const p = buildPlaybackTimeline(repeated);
  assert.deepEqual(p.measureOrder, [0, 1, 0, 2]);
  const dc = buildScore({
    timeSignature: '4/4', staves: { rh: ['C4/w', 'D4/w'], lh: ['r/w', 'r/w'] },
    navigation: { dcAlFine: true, fineMeasure: 0 },
  });
  assert.deepEqual(buildPlaybackTimeline(dc).measureOrder, [0, 1, 0]);
});
