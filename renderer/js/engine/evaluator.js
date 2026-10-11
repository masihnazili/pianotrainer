import { buildPlaybackTimeline } from '../audio/transport.js';

// Evaluation engine (Phase 2). Pure logic, no DOM, no audio: it only compares a stream of
// "note on" events against the expected events of a built score.
//
//   WaitEvaluator    – "wait for me": the piece advances only when the right note(s) are played.
//   RhythmEvaluator  – "with the beat": each expected note must be played inside a time window.
//
// Input events are { midi, time } where time is in seconds on any monotonic clock
// (the app uses performance.now()/1000, the same clock as Web MIDI timestamps).

/**
 * Group the playable events of the practiced hands by onset.
 * Chords (and both hands at the same beat) form a single group.
 */
export function practiceGroups(score, hands) {
  const playback = buildPlaybackTimeline(score);
  const timeline = playback.timeline;
  const map = new Map();
  const ties = score.ties || [];
  for (let i = 0; i < timeline.length; i++) {
    const ev = timeline[i];
    if (ev.rest || !hands.includes(ev.staff)) continue;
    const originalId = ev.originalId || ev.id;
    const tiedPitches = new Set();
    for (const tie of ties.filter((t) => t.to === originalId)) {
      const source = timeline.slice(0, i).findLast((prior) => (prior.originalId || prior.id) === tie.from && prior.staff === ev.staff);
      if (source) {
        source.pitches.forEach((p) => {
          if (ev.pitches.some((q) => q.midi === p.midi)) tiedPitches.add(p.midi);
        });
      }
    }
    const practiceMidis = ev.pitches.map((p) => p.midi).filter((midi) => !tiedPitches.has(midi));
    // A fully tied note sustains the previous key press and is not a new expected onset.
    if (!practiceMidis.length) continue;
    const key = Math.round(ev.startBeat * 1000);
    if (!map.has(key)) map.set(key, { startBeat: ev.startBeat, events: [], midis: [] });
    const g = map.get(key);
    const displayEvent = { ...ev, id: originalId, originalId, practiceMidis };
    g.events.push(displayEvent);
    for (const midi of practiceMidis) if (!g.midis.includes(midi)) g.midis.push(midi);
  }
  return [...map.values()]
    .sort((a, b) => a.startBeat - b.startBeat)
    .map((g, index) => ({
      index,
      startBeat: g.startBeat,
      events: g.events,
      eventIds: g.events.map((e) => e.id),
      midis: g.midis.sort((a, b) => a - b),
    }));
}

// ---------------------------------------------------------------------------------------------

export class WaitEvaluator {
  constructor(score, hands) {
    this.groups = practiceGroups(score, hands);
    this.index = 0;
    this.pressed = new Set();
    this.results = this.groups.map(() => ({ errors: 0, done: false, wrong: [] }));
  }

  get finished() {
    return this.index >= this.groups.length;
  }

  get current() {
    return this.finished ? null : this.groups[this.index];
  }

  /** Midis of the current group that have not been played yet. */
  get remaining() {
    return this.current ? this.current.midis.filter((m) => !this.pressed.has(m)) : [];
  }

  /**
   * @returns {{type:'correct'|'wrong'|'duplicate'|'ignored', complete?:boolean, finished?:boolean, group?:object, clean?:boolean}}
   */
  noteOn(midi) {
    if (this.finished) return { type: 'ignored' };
    const g = this.groups[this.index];
    const res = this.results[this.index];
    if (g.midis.includes(midi)) {
      if (this.pressed.has(midi)) return { type: 'duplicate', group: g };
      this.pressed.add(midi);
      if (this.pressed.size === g.midis.length) {
        res.done = true;
        this.index++;
        this.pressed = new Set();
        return { type: 'correct', complete: true, clean: res.errors === 0, finished: this.finished, group: g };
      }
      return { type: 'correct', complete: false, group: g };
    }
    res.errors++;
    res.wrong.push(midi);
    return { type: 'wrong', midi, group: g };
  }

  summary() {
    const total = this.groups.length;
    const done = this.results.filter((r) => r.done).length;
    const firstTry = this.results.filter((r) => r.done && r.errors === 0).length;
    const errors = this.results.reduce((a, r) => a + r.errors, 0);
    return {
      mode: 'wait', total, completed: done, firstTry, errors,
      accuracy: total ? firstTry / total : 0,
      finished: this.finished,
    };
  }
}

// ---------------------------------------------------------------------------------------------

export const DEFAULT_WINDOWS = { perfect: 0.07, good: 0.14, ok: 0.25 };

export class RhythmEvaluator {
  /**
   * @param {object} score
   * @param {object} o { hands, tempo, t0 (clock time of beat 0), windows, offset (seconds, systematic latency to subtract) }
   */
  constructor(score, { hands, tempo, t0, windows = DEFAULT_WINDOWS, offset = 0 }) {
    this.spb = 60 / tempo;
    const ok = Math.min(windows.ok, 0.45 * this.spb);
    const scale = ok / windows.ok;
    this.windows = { perfect: windows.perfect * scale, good: windows.good * scale, ok };
    this.offset = offset;
    this.t0 = t0;
    this.groups = practiceGroups(score, hands);
    this.slots = [];
    this.byEvent = new Map();
    for (const g of this.groups) {
      for (const midi of g.midis) {
        const eventIds = g.events.filter((e) => (e.practiceMidis || e.pitches.map((p) => p.midi)).includes(midi)).map((e) => e.id);
        const slot = { group: g.index, midi, expected: t0 + g.startBeat * this.spb, state: 'pending', offset: null, grade: null, eventIds };
        this.slots.push(slot);
        for (const id of eventIds) {
          if (!this.byEvent.has(id)) this.byEvent.set(id, []);
          this.byEvent.get(id).push(slot);
        }
      }
    }
    this.extras = [];
  }

  /** @returns {{type:'hit', grade, offset, slot}|{type:'extra', reason:'timing'|'pitch', midi}} */
  noteOn(midi, time) {
    const eff = time - this.offset;
    let best = null;
    for (const s of this.slots) {
      if (s.state !== 'pending' || s.midi !== midi) continue;
      const d = Math.abs(eff - s.expected);
      if (d <= this.windows.ok && (!best || d < best.d)) best = { s, d };
    }
    if (best) {
      const off = eff - best.s.expected;
      best.s.state = 'hit';
      best.s.offset = off;
      best.s.grade = best.d <= this.windows.perfect ? 'perfect' : best.d <= this.windows.good ? 'good' : 'ok';
      return { type: 'hit', grade: best.s.grade, offset: off, slot: best.s };
    }
    const nearSameNote = this.slots.some((s) => s.state === 'pending' && s.midi === midi && Math.abs(eff - s.expected) <= 0.6);
    this.extras.push({ midi, time });
    return { type: 'extra', reason: nearSameNote ? 'timing' : 'pitch', midi };
  }

  /** Mark expected notes whose window has closed as missed. Returns the newly missed slots. */
  tick(now) {
    const missed = [];
    for (const s of this.slots) {
      if (s.state === 'pending' && s.expected + this.windows.ok < now - this.offset) {
        s.state = 'missed';
        missed.push(s);
      }
    }
    return missed;
  }

  /** Resolve everything still pending as missed (end of the piece). */
  finalize() {
    const missed = [];
    for (const s of this.slots) if (s.state === 'pending') { s.state = 'missed'; missed.push(s); }
    return missed;
  }

  get finished() {
    return this.slots.every((s) => s.state !== 'pending');
  }

  /** 'pending' | 'hit' | 'missed' for a whole event (all of a chord's notes). */
  eventStatus(id) {
    const slots = this.byEvent.get(id) || [];
    if (slots.some((s) => s.state === 'pending')) return 'pending';
    if (slots.some((s) => s.state === 'missed')) return 'missed';
    return 'hit';
  }

  summary() {
    const total = this.slots.length;
    const hits = this.slots.filter((s) => s.state === 'hit');
    const count = (g) => hits.filter((s) => s.grade === g).length;
    const offsets = hits.map((s) => s.offset);
    const mean = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;
    const meanAbs = offsets.length ? offsets.reduce((a, b) => a + Math.abs(b), 0) / offsets.length : 0;
    const meanMs = Math.round(mean * 1000);
    return {
      mode: 'rhythm', total,
      hits: hits.length, perfect: count('perfect'), good: count('good'), ok: count('ok'),
      missed: this.slots.filter((s) => s.state === 'missed').length,
      extras: this.extras.length,
      accuracy: total ? hits.length / (total + this.extras.length) : 0,
      meanOffsetMs: meanMs,
      meanAbsOffsetMs: Math.round(meanAbs * 1000),
      tendency: meanMs > 30 ? 'late' : meanMs < -30 ? 'early' : 'steady',
      finished: this.finished,
    };
  }
}
