// Web MIDI input. Produces normalized events:
//   { type:'noteOn'|'noteOff'|'cc', midi, velocity(0..1), controller?, value?, time (seconds, performance clock),
//     source:'midi', deviceId }
// MIDI timestamps from Chromium share the performance.now() timebase, so they can be compared directly
// with the beat clock used by the rhythm evaluator.

/** Parse a raw MIDI message (Uint8Array / array). Returns null for messages we do not use. */
export function parseMidiMessage(data) {
  if (!data || data.length < 1) return null;
  const status = data[0];
  if (status >= 0xf0) return null; // system / realtime (clock, active sensing …)
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0x90 && data[2] > 0) return { type: 'noteOn', channel, midi: data[1], velocity: data[2] / 127 };
  if (type === 0x80 || type === 0x90) return { type: 'noteOff', channel, midi: data[1], velocity: (data[2] || 0) / 127 };
  if (type === 0xb0) return { type: 'cc', channel, controller: data[1], value: data[2] };
  return null;
}

export class MidiInput {
  /** @param {{onEvent?:Function, onChange?:Function}} handlers */
  constructor({ onEvent, onChange } = {}) {
    this.onEvent = onEvent;
    this.onChange = onChange;
    this.access = null;
    this.devices = [];
    this.selected = 'all';
  }

  static get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async connect() {
    if (!MidiInput.supported) throw new Error('Web MIDI is not supported in this environment');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this._refresh();
    this._refresh();
    return this.devices;
  }

  /** 'all' or a device id. */
  select(id) {
    this.selected = id;
  }

  _refresh() {
    const inputs = [...this.access.inputs.values()];
    this.devices = inputs
      .filter((i) => i.state !== 'disconnected')
      .map((i) => ({ id: i.id, name: i.name || 'MIDI device', manufacturer: i.manufacturer || '' }));
    for (const input of inputs) input.onmidimessage = (msg) => this._onMessage(input, msg);
    if (this.selected !== 'all' && !this.devices.some((d) => d.id === this.selected)) this.selected = 'all';
    this.onChange?.(this.devices);
  }

  _onMessage(input, msg) {
    if (this.selected !== 'all' && input.id !== this.selected) return;
    const parsed = parseMidiMessage(msg.data);
    if (!parsed) return;
    const stamp = typeof msg.timeStamp === 'number' && msg.timeStamp > 0 ? msg.timeStamp : performance.now();
    this.onEvent?.({ ...parsed, time: stamp / 1000, source: 'midi', deviceId: input.id });
  }
}
