// A small polyphonic piano-like synthesizer built on the Web Audio API.
// Phase 1 uses it for lesson playback, the metronome and the on-screen keyboard.
// The built-in synth is the no-setup fallback; a user-loaded WAV sample bank can use the same interface:
//   init(), noteOn(midi, velocity, when), noteOff(midi, when), allNotesOff(), click(accent, when),
//   now, setVolume(v)

import { midiToFrequency, parsePitch } from '../core/music.js';

/** Accepts sample filenames such as 60.wav, C4.wav or F#3.wav. */
export function sampleRootNote(filename) {
  const stem = String(filename).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').trim();
  if (/^\d{1,3}$/.test(stem)) { const n = Number(stem); return n >= 0 && n <= 127 ? n : null; }
  try { return parsePitch(stem).midi; } catch { return null; }
}

export function nearestSampleRoot(roots, midi) {
  if (!roots?.length) return null;
  return roots.reduce((best, value) => Math.abs(value - midi) < Math.abs(best - midi) ? value : best, roots[0]);
}

export class PianoSynth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voices = new Map(); // midi -> array of active voices
    this.sustainEvents = [];
    this.deferredReleases = [];
    this.wave = null;
    this.noise = null;
    this.volume = 0.8;
    this.soundMode = 'synth';
    this.externalHost = null;
    this.sampleBank = new Map();
    this.sampleLoadReport = { loaded: 0, skipped: 0 };
  }

  /** Must be called from a user gesture the first time (browser autoplay policy). */
  async init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);

      // Harmonic spectrum roughly like a struck string: strong fundamental, decaying partials.
      const real = new Float32Array([0, 1, 0.55, 0.32, 0.2, 0.12, 0.08, 0.05, 0.03]);
      const imag = new Float32Array(real.length);
      this.wave = this.ctx.createPeriodicWave(real, imag);

      // Short noise buffer for the hammer thump.
      const len = Math.floor(this.ctx.sampleRate * 0.05);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Approximate delay between scheduling a sound and hearing it (seconds). */
  get outputLatency() {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  setExternalHost(host) {
    this.externalHost = host || null;
    if (!this.externalHost && this.soundMode === 'vst3') this.soundMode = 'synth';
  }

  setSoundMode(mode) {
    if (mode === 'vst3' && this.externalHost) this.soundMode = 'vst3';
    else this.soundMode = mode === 'samples' && this.sampleBank.size ? 'samples' : 'synth';
    return this.soundMode;
  }

  get availableSoundModes() { return ['synth', ...(this.sampleBank.size ? ['samples'] : []), ...(this.externalHost ? ['vst3'] : [])]; }

  /** Load a user-owned, legally licensed WAV sample set. Filenames must be MIDI numbers or note names. */
  async loadSampleFiles(files) {
    await this.init();
    const loaded = new Map();
    let skipped = 0;
    for (const file of Array.from(files || [])) {
      if (!/\.wav$/i.test(file.name)) { skipped++; continue; }
      const midi = sampleRootNote(file.name);
      if (midi === null) { skipped++; continue; }
      try {
        const bytes = await file.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(bytes.slice(0));
        loaded.set(midi, { midi, buffer, name: file.name });
      } catch { skipped++; }
    }
    if (loaded.size) {
      this.sampleBank = loaded;
      this.sampleLoadReport = { loaded: loaded.size, skipped };
      this.setSoundMode('samples');
    } else {
      this.sampleLoadReport = { loaded: 0, skipped };
    }
    return { ...this.sampleLoadReport, roots: [...this.sampleBank.keys()].sort((a, b) => a - b) };
  }

  clearSampleBank() {
    this.sampleBank.clear();
    this.setSoundMode('synth');
    this.sampleLoadReport = { loaded: 0, skipped: 0 };
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    if (this.soundMode === 'vst3' && this.externalHost) this.externalHost.setVolume(v);
  }

  _externalDelayMs(when) {
    if (when === undefined || !this.ctx) return 0;
    return Math.max(0, Math.min(30000, (when - this.ctx.currentTime) * 1000));
  }

  noteOn(midi, velocity = 0.8, when = undefined) {
    if (this.soundMode === 'vst3' && this.externalHost) {
      this.externalHost.noteOn(midi, velocity, this._externalDelayMs(when));
      return { external: true, midi };
    }
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    if (this.soundMode === 'samples' && this.sampleBank.size) return this._sampleNoteOn(midi, velocity, t);
    const freq = midiToFrequency(midi);
    const vel = Math.max(0.05, Math.min(1, velocity));

    // Higher notes ring for less time.
    const decay = Math.max(0.6, 3.2 - (midi - 36) * 0.035);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.5 * vel, t + 0.004);
    out.gain.setTargetAtTime(0.16 * vel, t + 0.01, decay * 0.18); // fast initial drop
    out.gain.setTargetAtTime(0.0001, t + 0.35, decay);           // long tail

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, freq * (5 + 6 * vel)), t);
    lp.frequency.setTargetAtTime(Math.min(2500, freq * 2.2), t + 0.02, 0.5);
    lp.Q.value = 0.3;

    const oscs = [];
    for (const detune of [-3, 3]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.setValueAtTime(freq, t);
      o.detune.setValueAtTime(detune, t);
      const g = ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g).connect(lp);
      o.start(t);
      oscs.push(o);
    }
    lp.connect(out).connect(this.master);

    // Hammer thump
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = Math.min(3000, freq * 3);
    hp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.12 * vel;
    src.connect(hp).connect(ng).connect(out);
    src.start(t);

    const voice = { oscs, out, started: t, released: false, keyReleased: false };
    if (!this.voices.has(midi)) this.voices.set(midi, []);
    this.voices.get(midi).push(voice);
    return voice;
  }

  _sampleNoteOn(midi, velocity, t) {
    const ctx = this.ctx;
    const roots = [...this.sampleBank.keys()];
    const root = nearestSampleRoot(roots, midi);
    const sample = this.sampleBank.get(root);
    if (!sample) return null;
    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.setValueAtTime(2 ** ((midi - root) / 12), t);
    const gain = ctx.createGain();
    const vel = Math.max(0.03, Math.min(1, Number(velocity) || 0.8));
    gain.gain.setValueAtTime(vel ** 1.35, t);
    source.connect(gain).connect(this.master);
    const voice = { sampleSource: source, sampleGain: gain, sampleRoot: root, started: t, released: false, keyReleased: false };
    if (!this.voices.has(midi)) this.voices.set(midi, []);
    this.voices.get(midi).push(voice);
    source.onended = () => {
      const arr = this.voices.get(midi);
      if (arr) { const i = arr.indexOf(voice); if (i >= 0) arr.splice(i, 1); }
      try { source.disconnect(); gain.disconnect(); } catch {}
    };
    source.start(t);
    return voice;
  }

  _sustainDownAt(time) {
    const events = this.sustainEvents.filter((e) => e.time <= time).sort((a, b) => a.time - b.time);
    return events.length ? events[events.length - 1].down : false;
  }

  setSustain(down, when = undefined) {
    if (this.soundMode === 'vst3' && this.externalHost) {
      this.externalHost.sustain(!!down, this._externalDelayMs(when));
      return;
    }
    if (!this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    this.sustainEvents.push({ down: !!down, time: t });
    this.sustainEvents.sort((a, b) => a.time - b.time);
    if (!down) {
      const ready = this.deferredReleases.filter((item) => item.offAt <= t);
      this.deferredReleases = this.deferredReleases.filter((item) => item.offAt > t);
      ready.forEach((item) => this._releaseVoice(item.midi, item.voice, t));
    }
  }

  _releaseVoice(midi, voice, t) {
    if (!this.ctx || !voice || voice.released) return;
    voice.released = true;
    if (voice.sampleSource) {
      const release = 0.12;
      voice.sampleGain.gain.cancelScheduledValues(t);
      voice.sampleGain.gain.setValueAtTime(Math.max(0.0001, voice.sampleGain.gain.value), t);
      voice.sampleGain.gain.linearRampToValueAtTime(0.0001, t + release);
      try { voice.sampleSource.stop(t + release + 0.02); } catch {}
      return;
    }
    const release = 0.22;
    voice.out.gain.cancelScheduledValues(t);
    voice.out.gain.setTargetAtTime(0.0001, t, release / 3);
    const stopAt = t + release * 2;
    voice.oscs.forEach((o) => { try { o.stop(stopAt); } catch {} });
    setTimeout(() => {
      const arr = this.voices.get(midi);
      if (arr) {
        const i = arr.indexOf(voice);
        if (i >= 0) arr.splice(i, 1);
      }
    }, Math.max(0, (stopAt - this.ctx.currentTime) * 1000) + 50);
  }

  noteOff(midi, when = undefined) {
    if (this.soundMode === 'vst3' && this.externalHost) {
      this.externalHost.noteOff(midi, this._externalDelayMs(when));
      return;
    }
    if (!this.ctx) return;
    const list = this.voices.get(midi);
    if (!list || !list.length) return;
    const t = when ?? this.ctx.currentTime;
    // Release the oldest voice whose key is still held. Pedal defers the release until pedal-up.
    const voice = list.find((v) => !v.released && !v.keyReleased) || list.find((v) => !v.released);
    if (!voice) return;
    voice.keyReleased = true;
    if (this._sustainDownAt(t)) {
      this.deferredReleases.push({ midi, voice, offAt: t });
      return;
    }
    this._releaseVoice(midi, voice, t);
  }

  allNotesOff() {
    if (this.externalHost) this.externalHost.allNotesOff();
    if (!this.ctx) return;
    this.deferredReleases = [];
    this.sustainEvents = [];
    for (const [midi, list] of this.voices) {
      list.filter((v) => !v.released).forEach((voice) => this._releaseVoice(midi, voice, this.ctx.currentTime));
    }
  }

  /** Metronome click. accent = true for the first beat of a measure. */
  click(accent = false, when = undefined) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accent ? 0.28 : 0.18, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }
}
