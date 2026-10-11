// Practice sessions (Phase 2): connects the evaluators to the score view, keyboard hints and the audio clock.
//   mode 'wait'   – the piece waits for the right note(s)
//   mode 'rhythm' – count-in + metronome, notes are judged against the beat

import { WaitEvaluator, RhythmEvaluator, practiceGroups } from '../engine/evaluator.js';
import { setNoteState, clearNoteStates, moveCursor, hideCursor, slotAtBeat } from './score-view.js';

export class Practice {
  /**
   * deps: {
   *   synth, player, keyboard, scoreRoot (element containing the svg),
   *   getBuilt(), getStep(), getRendered(), getSettings(),
   *   onState(running), onFinish(summary, passed), onCountIn(n|null)
   * }
   */
  constructor(deps) {
    this.d = deps;
    this.mode = null;
    this.evaluator = null;
    this.running = false;
    this.raf = null;
    this.hintMidis = [];
    this.lastGroupIndex = -1;
  }

  get active() {
    return this.running;
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  async start(mode, { tempo, metronome, countIn } = {}) {
    this.stop({ silent: true });
    const built = this.d.getBuilt();
    const step = this.d.getStep();
    const hands = step.hands;
    this.mode = mode;
    this.step = step;
    clearNoteStates(this.d.scoreRoot);
    hideCursor(this.d.scoreRoot);
    this._setHint([]);

    if (mode === 'wait') {
      this.evaluator = new WaitEvaluator(built, hands);
      this.running = true;
      this.d.onState(true);
      this._showCurrentGroup();
      return;
    }

    // rhythm
    const backing = ['rh', 'lh'].filter((h) => !hands.includes(h));
    this.running = true;
    this.d.onState(true);
    this.lastGroupIndex = -1;
    const settings = this.d.getSettings();
    await this.d.player.start(built, { tempo, hands: backing, metronome, countIn, fromBeat: 0 });
    if (!this.running) return; // stopped while the audio engine was starting
    const synth = this.d.synth;
    const t0 = performance.now() / 1000 + (this.d.player.startTime - synth.now) + synth.outputLatency;
    this.evaluator = new RhythmEvaluator(built, {
      hands, tempo, t0, offset: (settings.latencyMs || 0) / 1000,
    });
    this.groups = practiceGroups(built, hands);
    this._loop();
  }

  /** Called by the app when the audio player reaches the end of the piece. */
  playerEnded() {
    if (this.mode !== 'rhythm' || !this.running) return;
    // give the last window time to close
    const wait = Math.max(0, this.evaluator.windows.ok * 1000 + 60);
    setTimeout(() => {
      if (!this.running) return;
      this._applyMissed(this.evaluator.finalize());
      this._finish();
    }, wait);
  }

  stop({ silent = false } = {}) {
    const wasRunning = this.running;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this._setHint([]);
    if (this.mode === 'rhythm') this.d.player.stop();
    this.d.onCountIn(null);
    if (wasRunning && !silent) this.d.onState(false);
  }

  // ---- input -------------------------------------------------------------------------------------------

  handle(ev) {
    if (!this.running || !this.evaluator || ev.type !== 'noteOn') return;
    if (this.mode === 'wait') this._handleWait(ev);
    else this._handleRhythm(ev);
  }

  _handleWait(ev) {
    const r = this.evaluator.noteOn(ev.midi);
    const kb = this.d.keyboard;
    if (r.type === 'wrong') {
      this._flashWrong(ev.midi);
      r.group.eventIds.forEach((id) => setNoteState(this.d.scoreRoot, id, 'wrong'));
      setTimeout(() => {
        if (this.running && this.evaluator.current === r.group) this._showCurrentGroup();
      }, 280);
      return;
    }
    if (r.type !== 'correct') return;
    kb.setState(ev.midi, 'target', false);
    if (!r.complete) return;
    r.group.eventIds.forEach((id) => setNoteState(this.d.scoreRoot, id, r.clean ? 'correct' : 'warn'));
    if (r.finished) {
      this._finish();
    } else {
      this._showCurrentGroup();
    }
  }

  _handleRhythm(ev) {
    const r = this.evaluator.noteOn(ev.midi, ev.time);
    if (r.type === 'hit') {
      for (const id of r.slot.eventIds) {
        const st = this.evaluator.eventStatus(id);
        if (st === 'hit') setNoteState(this.d.scoreRoot, id, r.grade === 'ok' ? 'warn' : 'correct');
      }
    } else if (r.type === 'extra') {
      this._flashWrong(ev.midi);
    }
  }

  // ---- rendering helpers ---------------------------------------------------------------------------------

  _showCurrentGroup() {
    const ev = this.evaluator;
    const g = ev.current;
    if (!g) return;
    g.eventIds.forEach((id) => setNoteState(this.d.scoreRoot, id, 'active'));
    moveCursor(this.d.scoreRoot, this.d.getRendered(), g.startBeat);
    const hint = this.d.getSettings().hint;
    this._setHint(hint ? ev.remaining : []);
  }

  _setHint(midis) {
    const kb = this.d.keyboard;
    this.hintMidis.forEach((m) => kb.setState(m, 'target', false));
    this.hintMidis = midis;
    midis.forEach((m) => kb.setState(m, 'target', true));
  }

  _flashWrong(midi) {
    const kb = this.d.keyboard;
    kb.setState(midi, 'wrong', true);
    setTimeout(() => kb.setState(midi, 'wrong', false), 320);
  }

  _applyMissed(slots) {
    const done = new Set();
    for (const s of slots) {
      for (const id of s.eventIds) {
        if (done.has(id)) continue;
        if (this.evaluator.eventStatus(id) === 'missed') {
          setNoteState(this.d.scoreRoot, id, 'warn');
          done.add(id);
        }
      }
    }
  }

  _loop() {
    if (!this.running) return;
    const player = this.d.player;
    const beat = player.currentBeat();
    if (beat >= -0.05) {
      const slot = slotAtBeat(this.d.getRendered(), beat);
      if (slot) {
        moveCursor(this.d.scoreRoot, this.d.getRendered(), slot.startBeat);
      }
      if (this.d.getSettings().hint) {
        const g = this.groups.find((gr) => gr.startBeat >= beat - 0.3);
        if (g && g.index !== this.lastGroupIndex) {
          this.lastGroupIndex = g.index;
          this._setHint(g.midis);
        }
      }
    }
    const missed = this.evaluator.tick(performance.now() / 1000);
    if (missed.length) this._applyMissed(missed);
    this.raf = requestAnimationFrame(() => this._loop());
  }

  _finish() {
    const summary = this.evaluator.summary();
    const min = this.step.pass?.minAccuracy ?? 0.8;
    const passed = summary.accuracy >= min;
    const mode = this.mode;
    this.stop({ silent: true });
    hideCursor(this.d.scoreRoot);
    this.d.onState(false);
    this.d.onFinish({ ...summary, mode }, passed);
  }
}
