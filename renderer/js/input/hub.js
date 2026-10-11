// InputHub: every source (MIDI, on-screen keyboard, computer keyboard) emits the same event shape
// through one hub, so the rest of the app (sound, highlighting, evaluation) never cares where a note came from.

export class InputHub {
  constructor() {
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  /** Convenience for non-MIDI sources. */
  note(type, midi, source, velocity = 0.8, time = performance.now() / 1000) {
    this.emit({ type, midi, velocity, time, source });
  }
}

// Computer-keyboard piano (fallback for people without a controller, and for quick testing).
// Uses KeyboardEvent.code, so it works with any keyboard layout (including Persian).
// Home row = white keys starting at C4; row above = black keys. Z / X shift one octave down / up.
export const KEY_OFFSETS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

export function keyToMidi(code, base = 60) {
  const off = KEY_OFFSETS[code];
  return off === undefined ? null : base + off;
}

export class ComputerKeyboardInput {
  constructor(hub, target = window) {
    this.hub = hub;
    this.base = 60;
    this.held = new Map(); // code -> midi (so release matches the note that was pressed)
    this.enabled = true;
    target.addEventListener('keydown', (e) => this._down(e));
    target.addEventListener('keyup', (e) => this._up(e));
    target.addEventListener('blur', () => this.releaseAll());
  }

  _ignore(e) {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return true;
    const t = e.target;
    return t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type === 'text'));
  }

  _down(e) {
    if (this._ignore(e)) return;
    if (e.code === 'KeyZ' && !e.repeat) { this.base = Math.max(24, this.base - 12); return; }
    if (e.code === 'KeyX' && !e.repeat) { this.base = Math.min(84, this.base + 12); return; }
    const midi = keyToMidi(e.code, this.base);
    if (midi === null || e.repeat || this.held.has(e.code)) return;
    this.held.set(e.code, midi);
    this.hub.note('noteOn', midi, 'keys');
  }

  _up(e) {
    const midi = this.held.get(e.code);
    if (midi === undefined) return;
    this.held.delete(e.code);
    this.hub.note('noteOff', midi, 'keys', 0);
  }

  releaseAll() {
    for (const midi of this.held.values()) this.hub.note('noteOff', midi, 'keys', 0);
    this.held.clear();
  }
}
