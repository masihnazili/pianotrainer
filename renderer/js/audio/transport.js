// Playback of a built score: a pure schedule builder (testable) and a lookahead scheduler
// that drives the synth and fires UI callbacks in sync with the audio clock.

/**
 * Build a flat list of note-on/off times (in seconds from the first played beat).
 * @param {object} score    built score
 * @param {object} o        { tempo (quarter notes / min), hands: ['rh','lh'], fromBeat = 0, articulation = 0.94 }
 */
/** Expand repeat / alternate-ending / D.C. al Fine directions into a played event sequence. */
export function buildPlaybackTimeline(score) {
  const measureCount = score.measures.length;
  const base = Array.from({ length: measureCount }, (_, i) => i);
  let order = base;
  if (score.repeat && Number.isInteger(score.repeat.startMeasure) && Number.isInteger(score.repeat.endMeasure)) {
    const { startMeasure, endMeasure } = score.repeat;
    const count = Math.max(2, Math.min(4, Number(score.repeat.count) || 2));
    const prefix = base.slice(0, startMeasure);
    const repeated = [];
    for (let pass = 1; pass <= count; pass++) {
      for (let m = startMeasure; m <= endMeasure; m++) {
        const ending = (score.endings || []).find((x) => m >= x.startMeasure && m <= x.endMeasure);
        if (!ending || ending.pass === pass) repeated.push(m);
      }
    }
    order = [...prefix, ...repeated, ...base.slice(endMeasure + 1)];
  }
  if (score.navigation?.dcAlFine) {
    const fine = Number.isInteger(score.navigation.fineMeasure) ? score.navigation.fineMeasure : measureCount - 1;
    order = [...order, ...base.slice(0, Math.max(0, Math.min(measureCount - 1, fine)) + 1)];
  }
  const bpm = score.timeSignature.beatsPerMeasure;
  const timeline = [];
  order.forEach((measureIndex, playbackMeasure) => {
    const shift = playbackMeasure * bpm - measureIndex * bpm;
    score.timeline.filter((ev) => ev.measure === measureIndex).forEach((ev) => {
      timeline.push({ ...ev, sourceId: ev.id, id: `${ev.id}@${playbackMeasure}`, originalId: ev.id, startBeat: ev.startBeat + shift, playbackMeasure });
    });
  });
  return { timeline, totalBeats: order.length * bpm, measureOrder: order };
}

/** Build a flat list of note-on/off times from the actual played order. */
export function buildSchedule(score, { tempo = 80, hands = ['rh', 'lh'], fromBeat = 0, articulation = 0.94 } = {}) {
  const spb = 60 / tempo;
  const playback = buildPlaybackTimeline(score);
  const events = playback.timeline.filter((ev) => !ev.rest && hands.includes(ev.staff));
  const artFor = (ev) => {
    const raw = score.articulations?.[ev.originalId || ev.id];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  };
  const fermatas = events.filter((ev) => artFor(ev).includes('fermata'));
  const extraFor = (beat) => fermatas.reduce((sum, ev) => sum + (ev.startBeat + ev.beats <= beat + 1e-9 ? Math.max(0.5, ev.beats * 0.75) : 0), 0);
  const adjustedBeat = (beat) => beat + extraFor(beat);
  const tieMap = new Map((score.ties || []).map((t) => [t.from, t.to]));
  const notes = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const arts = artFor(ev);
    if (adjustedBeat(ev.startBeat) < fromBeat) continue;
    const startBeat = adjustedBeat(ev.startBeat);
    const start = (startBeat - fromBeat) * spb;
    for (const pitch of ev.pitches) {
      const incomingPitch = (score.ties || []).some((t) => t.to === ev.originalId && events.slice(0, i).some((prior) => prior.originalId === t.from && prior.staff === ev.staff && prior.pitches.some((p) => p.midi === pitch.midi)));
      if (incomingPitch) continue;
      let finalBeat = ev.startBeat + ev.beats;
      let nextOriginalId = ev.originalId;
      let cursor = i;
      let tied = false;
      const seen = new Set();
      while (tieMap.has(nextOriginalId) && !seen.has(nextOriginalId)) {
        seen.add(nextOriginalId);
        const targetId = tieMap.get(nextOriginalId);
        const targetIndex = events.findIndex((candidate, idx) => idx > cursor && candidate.originalId === targetId && candidate.staff === ev.staff && candidate.pitches.some((p) => p.midi === pitch.midi));
        if (targetIndex < 0) break;
        const target = events[targetIndex];
        finalBeat = target.startBeat + target.beats;
        cursor = targetIndex;
        nextOriginalId = target.originalId;
        tied = true;
      }
      const isStaccato = arts.includes('staccato');
      const isAccent = arts.includes('accent');
      const isFermata = arts.includes('fermata');
      const offBeat = tied ? adjustedBeat(finalBeat) : startBeat + ev.beats * (isFermata ? 1.75 : isStaccato ? 0.45 : articulation);
      notes.push({ id: ev.originalId, playbackId: ev.id, staff: ev.staff, startBeat: ev.startBeat, playbackBeat: startBeat,
        midis: [pitch.midi], on: start, off: Math.max(start + 0.03, (offBeat - fromBeat) * spb),
        end: (adjustedBeat(tied ? finalBeat : ev.startBeat + ev.beats) - fromBeat) * spb,
        velocity: isAccent ? 1 : 0.75, articulation: arts, tied });
    }
  }
  notes.sort((a, b) => a.on - b.on || a.midis[0] - b.midis[0]);
  const grouped = [];
  for (const note of notes) {
    const prior = grouped.find((x) => x.playbackId === note.playbackId && x.on === note.on && x.off === note.off && x.end === note.end && x.velocity === note.velocity && x.tied === note.tied);
    if (prior) prior.midis.push(...note.midis); else grouped.push({ ...note, midis: [...note.midis] });
  }
  grouped.forEach((n) => n.midis.sort((a,b)=>a-b));
  const totalBeat = playback.totalBeats + fermatas.reduce((sum, ev) => sum + Math.max(0.5, ev.beats * 0.75), 0);
  const total = Math.max(0, totalBeat - fromBeat) * spb;
  const bpm = score.timeSignature.beatsPerMeasure;
  const pedals = (score.pedal || []).flatMap((span) => {
    const startMeasure = Math.floor(span.startBeat / bpm), endMeasure = Math.floor(Math.max(0, span.endBeat - 1e-9) / bpm);
    const startLocal = span.startBeat - startMeasure * bpm, endLocal = span.endBeat - endMeasure * bpm;
    const out = [];
    playback.measureOrder.forEach((measureIndex, playbackIndex) => {
      if (measureIndex !== startMeasure) return;
      const endPlaybackIndex = playback.measureOrder.findIndex((m, idx) => idx >= playbackIndex && m === endMeasure);
      if (endPlaybackIndex < 0) return;
      const start = playbackIndex * bpm + startLocal;
      const end = endPlaybackIndex * bpm + endLocal;
      out.push({ kind: 'pedal', down: true, time: (adjustedBeat(start) - fromBeat) * spb });
      out.push({ kind: 'pedal', down: false, time: (adjustedBeat(end) - fromBeat) * spb });
    });
    return out;
  }).filter((p) => p.time >= 0 && p.time <= total).sort((a,b)=>a.time-b.time);
  return { notes: grouped, pedals, total, spb, measureOrder: playback.measureOrder };
}

/** Metronome click times in the expanded playback order. */
export function buildClicks(score, { tempo = 80, fromBeat = 0 } = {}) {
  const spb = 60 / tempo;
  const playback = buildPlaybackTimeline(score);
  const clicks = [];
  const bpm = score.timeSignature.beatsPerMeasure;
  const fermatas = playback.timeline.filter((ev) => !ev.rest && (Array.isArray(score.articulations?.[ev.originalId]) ? score.articulations[ev.originalId] : [score.articulations?.[ev.originalId]]).includes('fermata'));
  const adjusted = (beat) => beat + fermatas.reduce((sum, ev) => sum + (ev.startBeat + ev.beats <= beat + 1e-9 ? Math.max(0.5, ev.beats * 0.75) : 0), 0);
  for (let b = Math.ceil(fromBeat); b < playback.totalBeats; b++) {
    clicks.push({ time: (adjusted(b) - fromBeat) * spb, accent: b % bpm === 0, beat: b });
  }
  return clicks;
}

export class ScorePlayer {
  /**
   * @param {PianoSynth} synth
   * @param {object} cb  { onNoteOn(note), onNoteOff(note), onBeat({beat, countIn}), onEnd() }
   */
  constructor(synth, cb = {}) {
    this.synth = synth;
    this.cb = cb;
    this.timer = null;
    this.running = false;
    this.pending = []; // scheduled UI events: {time, fn}
    this.lookahead = 0.2; // seconds
    this.startTime = 0;
    this.spb = 0.75;
    this.fromBeat = 0;
  }

  /** Current position in quarter-note beats (negative during count-in). */
  currentBeat() {
    if (!this.running) return this.fromBeat;
    return this.fromBeat + (this.synth.now - this.startTime) / this.spb;
  }

  async start(score, { tempo = 80, hands = ['rh', 'lh'], metronome = true, countIn = true, fromBeat = 0 } = {}) {
    this.stop();
    await this.synth.init();
    const sched = buildSchedule(score, { tempo, hands, fromBeat });
    const clicks = buildClicks(score, { tempo, fromBeat });
    const spb = sched.spb;
    const bpm = score.timeSignature.beatsPerMeasure;
    const countBeats = countIn ? bpm : 0;

    this.running = true;
    this.spb = spb;
    this.fromBeat = fromBeat;
    // Audio time at which beat `fromBeat` sounds:
    this.startTime = this.synth.now + 0.12 + countBeats * spb;
    const t0 = this.startTime;

    // Build one ordered queue of everything to trigger.
    const queue = [];
    for (let i = 0; i < countBeats; i++) {
      const time = t0 - (countBeats - i) * spb;
      queue.push({ time, kind: 'click', accent: i === 0, countIn: true, beat: -(countBeats - i) });
    }
    if (metronome) {
      clicks.forEach((c) => queue.push({ time: t0 + c.time, kind: 'click', accent: c.accent, countIn: false, beat: c.beat }));
    }
    sched.notes.forEach((n) => {
      queue.push({ time: t0 + n.on, kind: 'on', note: n });
      queue.push({ time: t0 + n.off, kind: 'off', note: n });
    });
    (sched.pedals || []).forEach((p) => queue.push({ time: t0 + p.time, kind: 'pedal', down: p.down }));
    queue.push({ time: t0 + sched.total + 0.05, kind: 'end' });
    queue.sort((a, b) => a.time - b.time);
    this.queue = queue;
    this.cursor = 0;
    this.pending = [];

    this.timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  _tick() {
    if (!this.running) return;
    const now = this.synth.now;
    // 1) schedule audio slightly ahead
    while (this.cursor < this.queue.length && this.queue[this.cursor].time < now + this.lookahead) {
      const item = this.queue[this.cursor++];
      if (item.kind === 'click') {
        this.synth.click(item.accent, item.time);
      } else if (item.kind === 'on') {
        item.note.midis.forEach((m) => this.synth.noteOn(m, item.note.velocity ?? 0.75, item.time));
      } else if (item.kind === 'off') {
        item.note.midis.forEach((m) => this.synth.noteOff(m, item.time));
      } else if (item.kind === 'pedal') {
        this.synth.setSustain?.(item.down, item.time);
      }
      this.pending.push(item);
    }
    // 2) fire UI callbacks when their audio time has arrived
    while (this.pending.length && this.pending[0].time <= now) {
      const item = this.pending.shift();
      if (item.kind === 'on') this.cb.onNoteOn?.(item.note);
      else if (item.kind === 'off') this.cb.onNoteOff?.(item.note);
      else if (item.kind === 'click') this.cb.onBeat?.({ beat: item.beat, countIn: item.countIn, accent: item.accent });
      else if (item.kind === 'end') {
        this.stop();
        this.cb.onEnd?.();
        return;
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasRunning = this.running;
    this.running = false;
    this.queue = [];
    this.pending = [];
    if (wasRunning) this.synth.allNotesOff();
  }
}
