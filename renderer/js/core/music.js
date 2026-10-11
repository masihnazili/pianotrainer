// Core music model: parsing the compact lesson notation into a normalized score
// and a flat, time-ordered timeline. Pure functions, no DOM, testable in Node.

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Duration codes -> length in quarter-note beats. */
const DURATION_BEATS = { w: 4, h: 2, q: 1, e: 0.5, t: 1 / 3 }; // t = eighth-note triplet

/**
 * Parse a pitch like "C4", "F#4", "Bb3".
 * Returns { step, alter, octave, midi, diatonic } where diatonic = octave*7 + stepIndex
 * (used for vertical staff position).
 */
export function parsePitch(text) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(text);
  if (!m) throw new Error(`Invalid pitch: "${text}"`);
  const step = m[1];
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  const midi = 12 * (octave + 1) + STEP_SEMITONE[step] + alter;
  return { step, alter, octave, midi, diatonic: octave * 7 + STEP_INDEX[step] };
}

export function midiToName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function midiToFrequency(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

export function stepName(index) {
  return STEP_NAMES[((index % 7) + 7) % 7];
}

/** "4/4" -> { num: 4, den: 4, beatsPerMeasure: 4 } (beats measured in quarter notes). */
export function parseTimeSignature(text) {
  const m = /^(\d+)\/(\d+)$/.exec(text);
  if (!m) throw new Error(`Invalid time signature: "${text}"`);
  const num = Number(m[1]);
  const den = Number(m[2]);
  return { num, den, beatsPerMeasure: (num * 4) / den };
}

/**
 * Parse one token.
 *   C4/q           quarter note
 *   C4/h.:3        dotted half, finger 3
 *   C3+E3+G3/w:5-3-1@word   chord (low->high fingers), lyric "word"
 *   r/q            quarter rest
 */
export function parseToken(token) {
  const m = /^([^/@:]+)\/([whqet])(\.)?(?::([0-9-]+))?(?:@(.+))?$/.exec(token);
  if (!m) throw new Error(`Invalid token: "${token}"`);
  const [, head, dur, dot, fingerText, lyric] = m;
  const beats = DURATION_BEATS[dur] * (dot ? 1.5 : 1);
  const base = { duration: dur, dotted: Boolean(dot), beats, lyric: lyric ? lyric.replace(/_/g, ' ') : null };
  if (head === 'r') {
    return { ...base, rest: true, pitches: [], fingers: [] };
  }
  const pitches = head.split('+').map(parsePitch).sort((a, b) => a.midi - b.midi);
  const fingers = fingerText ? fingerText.split('-').map(Number) : [];
  if (fingers.length && fingers.length !== pitches.length) {
    throw new Error(`Finger count does not match note count in "${token}"`);
  }
  return { ...base, rest: false, pitches, fingers };
}

/**
 * Convert a lesson's "score" block into a normalized structure + timeline.
 *
 * score = {
 *   timeSignature: "4/4", keySignature: "C",
 *   staves: { rh: ["E4/q:3 ...", ...], lh: [...] },      // one string per measure
 *   chordSymbols: { "0": "C" }, dynamics: { "0": "mf" }, // keyed by measure index (optional)
 *   ending: "final" | "repeat" | "none"
 * }
 */
export function buildScore(score) {
  const ts = parseTimeSignature(score.timeSignature || '4/4');
  const staves = score.staves || {};
  const measureCount = Math.max(staves.rh?.length || 0, staves.lh?.length || 0);
  if (measureCount === 0) throw new Error('Score has no measures');

  const measures = [];
  const timeline = [];

  for (let mi = 0; mi < measureCount; mi++) {
    const measure = { index: mi, staves: { rh: [], lh: [] } };
    for (const staff of ['rh', 'lh']) {
      const text = staves[staff]?.[mi];
      let tokens;
      if (text === undefined || text === null) {
        tokens = [`r/${wholeRestCode(ts.beatsPerMeasure)}`];
      } else {
        tokens = text.trim().split(/\s+/).filter(Boolean);
      }
      let beat = 0;
      tokens.forEach((tok, k) => {
        const ev = parseToken(tok);
        const event = {
          ...ev,
          id: `m${mi}-${staff}-${k}`,
          articulations: Array.isArray(score.articulations?.[`m${mi}-${staff}-${k}`]) ? score.articulations[`m${mi}-${staff}-${k}`] : score.articulations?.[`m${mi}-${staff}-${k}`] ? [score.articulations[`m${mi}-${staff}-${k}`]] : [],
          staff,
          measure: mi,
          beatInMeasure: beat,
          startBeat: mi * ts.beatsPerMeasure + beat,
        };
        // A whole-measure rest is always drawn as a whole rest regardless of meter.
        event.wholeMeasureRest = ev.rest && Math.abs(ev.beats - ts.beatsPerMeasure) < 1e-9;
        measure.staves[staff].push(event);
        timeline.push(event);
        beat += ev.beats;
      });
      if (Math.abs(beat - ts.beatsPerMeasure) > 1e-9) {
        throw new Error(
          `Measure ${mi + 1} (${staff}) has ${beat} beats, expected ${ts.beatsPerMeasure} for ${score.timeSignature || '4/4'}`
        );
      }
    }
    measure.chordSymbol = score.chordSymbols?.[mi] ?? null;
    measure.dynamic = score.dynamics?.[mi] ?? null;
    measures.push(measure);
  }

  timeline.sort((a, b) => a.startBeat - b.startBeat || (a.staff === 'rh' ? -1 : 1));

  const ties = Array.isArray(score.ties) ? score.ties.map((pair) => ({ from: pair[0], to: pair[1] })) : [];
  const slurs = Array.isArray(score.slurs) ? score.slurs.map((pair) => ({ from: pair[0], to: pair[1] })) : [];
  const articulations = score.articulations && typeof score.articulations === 'object' ? { ...score.articulations } : {};
  const pedal = Array.isArray(score.pedal) ? score.pedal.map((span) => ({ startBeat: Number(span.startBeat), endBeat: Number(span.endBeat) })).filter((span) => Number.isFinite(span.startBeat) && Number.isFinite(span.endBeat) && span.endBeat > span.startBeat) : [];
  return {
    timeSignature: ts,
    timeSignatureText: score.timeSignature || '4/4',
    keySignature: score.keySignature || 'C',
    ending: score.ending || 'final',
    ties, slurs, articulations, pedal,
    navigation: score.navigation || null,
    repeat: score.repeat || null,
    endings: Array.isArray(score.endings) ? score.endings : [],
    measures,
    timeline,
    totalBeats: measureCount * ts.beatsPerMeasure,
  };
}

function wholeRestCode(beats) {
  // r/w only parses a 4-beat rest; for other meters we store a rest with explicit beats.
  // (Handled in buildScore via wholeMeasureRest; the token grammar only needs a duration code.)
  return beats === 4 ? 'w' : beats === 3 ? 'h.' : beats === 2 ? 'h' : 'q';
}

/** Playable events only (no rests), optionally filtered by hands. */
export function playableEvents(builtScore, hands = ['rh', 'lh']) {
  return builtScore.timeline.filter((e) => !e.rest && hands.includes(e.staff));
}

// ---- Key signatures -------------------------------------------------------

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const KEYS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5,
  F: -1, Bb: -2, Eb: -3, Ab: -4,
  Am: 0, Em: 1, Bm: 2, Dm: -1, Gm: -2, Cm: -3,
};

/** Returns { count, type: 'sharp'|'flat'|null, letters: ['F', ...] }. */
export function keySignatureInfo(key) {
  if (!(key in KEYS)) throw new Error(`Unsupported key: "${key}"`);
  const n = KEYS[key];
  if (n === 0) return { count: 0, type: null, letters: [] };
  if (n > 0) return { count: n, type: 'sharp', letters: SHARP_ORDER.slice(0, n) };
  return { count: -n, type: 'flat', letters: FLAT_ORDER.slice(0, -n) };
}

/** Default alteration for a step letter under a key signature (+1, -1 or 0). */
export function keyAlteration(key, stepLetter) {
  const info = keySignatureInfo(key);
  if (!info.letters.includes(stepLetter)) return 0;
  return info.type === 'sharp' ? 1 : -1;
}
