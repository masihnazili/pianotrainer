// On-screen piano keyboard (SVG). Highlights target notes, reflects pressed keys, and lets the
// user click keys. Pure presentation: sound is produced by whoever listens to onPress/onRelease.

import { isBlackKey, midiToName } from '../core/music.js';

const WHITE_W = 26;
const WHITE_H = 120;
const BLACK_W = 16;
const BLACK_H = 74;

export class PianoKeyboard {
  /**
   * @param {HTMLElement} container
   * @param {object} o { low: 48 (C3), high: 83 (B5), onPress(midi), onRelease(midi) }
   */
  constructor(container, { low = 48, high = 83, onPress, onRelease } = {}) {
    this.container = container;
    this.low = low;
    this.high = high;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.states = new Map(); // midi -> Set of state names
    this.render();
    this._bind();
  }

  render() {
    const whites = [];
    for (let m = this.low; m <= this.high; m++) if (!isBlackKey(m)) whites.push(m);
    const whiteIndex = new Map(whites.map((m, i) => [m, i]));
    const width = whites.length * WHITE_W;

    const parts = [];
    for (const m of whites) {
      const x = whiteIndex.get(m) * WHITE_W;
      const label = m % 12 === 0 ? `<text class="klabel" x="${x + WHITE_W / 2}" y="${WHITE_H - 8}" text-anchor="middle">${midiToName(m)}</text>` : '';
      parts.push(`<g class="key white" data-midi="${m}"><rect x="${x}" y="0" width="${WHITE_W}" height="${WHITE_H}" rx="3"/>${label}</g>`);
    }
    for (let m = this.low; m <= this.high; m++) {
      if (!isBlackKey(m)) continue;
      const prevWhite = m - 1;
      if (!whiteIndex.has(prevWhite)) continue;
      const x = (whiteIndex.get(prevWhite) + 1) * WHITE_W - BLACK_W / 2;
      parts.push(`<g class="key black" data-midi="${m}"><rect x="${x}" y="0" width="${BLACK_W}" height="${BLACK_H}" rx="2"/></g>`);
    }
    this.container.innerHTML =
      `<svg class="keyboard" viewBox="0 0 ${width} ${WHITE_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Piano keyboard">${parts.join('')}</svg>`;
    this.svg = this.container.querySelector('svg');
  }

  _el(midi) {
    return this.svg.querySelector(`.key[data-midi="${midi}"]`);
  }

  /** state: 'target' | 'pressed' | 'correct' | 'wrong' (CSS classes is-<state>). */
  setState(midi, state, on = true) {
    let set = this.states.get(midi);
    if (!set) this.states.set(midi, (set = new Set()));
    if (on) set.add(state);
    else set.delete(state);
    const el = this._el(midi);
    if (el) el.classList.toggle(`is-${state}`, on);
  }

  clearState(state) {
    for (const [midi, set] of this.states) {
      if (set.has(state)) this.setState(midi, state, false);
    }
  }

  _bind() {
    const active = new Map(); // pointerId -> midi
    const midiFrom = (e) => {
      const g = e.target.closest?.('.key');
      return g ? Number(g.dataset.midi) : null;
    };
    this.svg.addEventListener('pointerdown', (e) => {
      const m = midiFrom(e);
      if (m === null) return;
      e.preventDefault();
      this.svg.setPointerCapture?.(e.pointerId);
      active.set(e.pointerId, m);
      this.setState(m, 'pressed', true);
      this.onPress?.(m);
    });
    const release = (e) => {
      const m = active.get(e.pointerId);
      if (m === undefined) return;
      active.delete(e.pointerId);
      this.setState(m, 'pressed', false);
      this.onRelease?.(m);
    };
    this.svg.addEventListener('pointerup', release);
    this.svg.addEventListener('pointercancel', release);
  }
}
