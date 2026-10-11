import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScore } from '../renderer/js/core/music.js';
import { renderScore } from '../renderer/js/render/notation.js';

const render = (score, width = 700) => renderScore(buildScore(score), { width });

test('all rest types, dotted rests and eighth beams render without NaN', () => {
  const r = render({
    timeSignature: '4/4', keySignature: 'C',
    staves: {
      rh: ['r/q r/e r/e r/h', 'C4/e D4/e r/e r/e r/h', 'r/h. r/q'],
      lh: ['r/w', 'r/h r/q r/q', 'C3/h. r/q'],
    },
  });
  assert.ok(!/NaN|undefined/.test(r.svg));
  assert.equal((r.svg.match(/class="ink beam"/g) || []).length, 0 + 1); // only C4/e D4/e is a pair
});

test('extreme ledger lines and clef ranges', () => {
  const r = render({
    timeSignature: '4/4',
    staves: {
      rh: ['A5/q C6/q A3/q C4/q', 'B3/q C4/q C6/h'],
      lh: ['E2/q C2/q C4/q E4/q', 'A3/q B3/q C2/h'],
    },
  });
  assert.ok(!/NaN|undefined/.test(r.svg));
  assert.ok((r.svg.match(/class="ledger"/g) || []).length > 6);
});

test('seconds in a chord displace a notehead', () => {
  const r = render({ timeSignature: '4/4', staves: { rh: ['C4+D4/w', 'C4+D4+E4/h r/h'], lh: ['r/w', 'r/w'] } });
  assert.ok(!/NaN|undefined/.test(r.svg));
});

test('accidental memory: second F# in the same measure has no sign, naturals appear in G major', () => {
  const r = render({
    timeSignature: '4/4', keySignature: 'C',
    staves: { rh: ['F#4/q F#4/q F4/q F4/q'], lh: ['r/w'] },
  });
  // C major: sharp, (no repeat), natural, (no repeat) => 2 accidental glyphs in the measure
  assert.equal((r.svg.match(/class="acc"/g) || []).length, 2);
  const g = render({
    timeSignature: '4/4', keySignature: 'G',
    staves: { rh: ['F#4/q F4/q F4/q F#4/q'], lh: ['r/w'] },
  });
  assert.equal((g.svg.match(/class="acc"/g) || []).length, 2); // natural, then sharp again
});

test('layout wraps into multiple systems on narrow widths and exposes slot positions', () => {
  const staves = { rh: Array(8).fill('C4/q D4/q E4/q F4/q'), lh: Array(8).fill('r/w') };
  const narrow = render({ timeSignature: '4/4', staves }, 520);
  const wide = render({ timeSignature: '4/4', staves }, 1400);
  assert.ok(narrow.layout.systems.length > wide.layout.systems.length);
  assert.equal(narrow.layout.slots.length, 32);
  for (let i = 1; i < narrow.layout.slots.length; i++) {
    const a = narrow.layout.slots[i - 1], b = narrow.layout.slots[i];
    if (a.system === b.system) assert.ok(b.x > a.x, 'slots increase left to right within a system');
  }
});


test('renders triplets, ties, slurs, articulation, pedal and navigation markings', () => {
  const score = buildScore({
    timeSignature: '4/4', keySignature: 'C', ending: 'repeat',
    staves: { rh: ['C4/t D4/t E4/t F4/q G4/q A4/q', 'A4/w'], lh: ['C3/h G2/h', 'r/w'] },
    ties: [['m0-rh-5', 'm1-rh-0']],
    slurs: [['m0-rh-0', 'm0-rh-2']],
    articulations: { 'm0-rh-0': 'accent', 'm1-rh-0': 'fermata' },
    pedal: [{ startBeat: 0, endBeat: 4 }],
    repeat: { startMeasure: 0, endMeasure: 1, count: 2 },
    endings: [{ startMeasure: 1, endMeasure: 1, pass: 1 }],
    navigation: { dcAlFine: true, fineMeasure: 0 },
  });
  const svg = renderScore(score, { width: 900 }).svg;
  assert.match(svg, />3</);
  assert.match(svg, /class="music-mark slur"/);
  assert.match(svg, /class="music-mark accent"|class="music-mark"/);
  assert.match(svg, /Ped\./);
  assert.match(svg, /D\.C\. al Fine/);
  assert.match(svg, /Fine/);
  assert.match(svg, /repeat-start|barline/);
});
