import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidiMessage, MidiInput } from '../renderer/js/input/midi.js';
import { InputHub, keyToMidi, ComputerKeyboardInput } from '../renderer/js/input/hub.js';

test('parseMidiMessage: note on/off, velocity-0 note on, cc, ignored realtime', () => {
  assert.deepEqual(parseMidiMessage([0x90, 60, 127]), { type: 'noteOn', channel: 0, midi: 60, velocity: 1 });
  assert.equal(parseMidiMessage([0x93, 64, 64]).channel, 3);
  assert.equal(parseMidiMessage([0x90, 60, 0]).type, 'noteOff');
  assert.equal(parseMidiMessage([0x80, 60, 40]).type, 'noteOff');
  assert.deepEqual(parseMidiMessage([0xb0, 64, 127]), { type: 'cc', channel: 0, controller: 64, value: 127 });
  assert.equal(parseMidiMessage([0xfe]), null);
  assert.equal(parseMidiMessage([0xf8]), null);
  assert.equal(parseMidiMessage([0xe0, 0, 64]), null); // pitch bend not used
  assert.equal(parseMidiMessage([]), null);
});

test('MidiInput lists devices, filters by selection and normalizes events', async () => {
  const events = [];
  let changes = 0;
  const mk = (id, name) => ({ id, name, state: 'connected', onmidimessage: null });
  const a = mk('a', 'Piano A');
  const b = mk('b', 'Keys B');
  const access = { inputs: new Map([['a', a], ['b', b]]), onstatechange: null };
  Object.defineProperty(globalThis, 'navigator', { value: { requestMIDIAccess: async () => access }, configurable: true, writable: true });
  const m = new MidiInput({ onEvent: (e) => events.push(e), onChange: () => changes++ });
  const devices = await m.connect();
  assert.deepEqual(devices.map((d) => d.name), ['Piano A', 'Keys B']);
  a.onmidimessage({ data: [0x90, 60, 100], timeStamp: 2000 });
  b.onmidimessage({ data: [0x90, 62, 100], timeStamp: 2500 });
  assert.equal(events.length, 2);
  assert.equal(events[0].time, 2);
  assert.equal(events[0].source, 'midi');
  m.select('b');
  a.onmidimessage({ data: [0x90, 61, 100], timeStamp: 3000 });
  b.onmidimessage({ data: [0x80, 62, 0], timeStamp: 3100 });
  assert.equal(events.length, 3);
  assert.equal(events[2].type, 'noteOff');
  // hot-unplug device b -> selection falls back to "all"
  b.state = 'disconnected';
  access.onstatechange();
  assert.equal(m.selected, 'all');
  assert.equal(m.devices.length, 1);
  assert.ok(changes >= 2);
  delete globalThis.navigator;
});

test('MidiInput.supported is false without Web MIDI', () => {
  assert.equal(MidiInput.supported, false);
});

test('InputHub fans events out and unsubscribes', () => {
  const hub = new InputHub();
  const got = [];
  const off = hub.on((e) => got.push(e));
  hub.note('noteOn', 60, 'screen');
  off();
  hub.note('noteOn', 61, 'screen');
  assert.equal(got.length, 1);
  assert.equal(got[0].source, 'screen');
  assert.equal(got[0].midi, 60);
});

test('computer keyboard mapping and octave shifting', () => {
  assert.equal(keyToMidi('KeyA'), 60);
  assert.equal(keyToMidi('KeyW'), 61);
  assert.equal(keyToMidi('KeyK'), 72);
  assert.equal(keyToMidi('KeyA', 48), 48);
  assert.equal(keyToMidi('Digit1'), null);

  const handlers = {};
  const target = { addEventListener: (n, fn) => { handlers[n] = fn; } };
  const hub = new InputHub();
  const got = [];
  hub.on((e) => got.push(`${e.type}:${e.midi}`));
  new ComputerKeyboardInput(hub, target);
  handlers.keydown({ code: 'KeyA', target: { tagName: 'BODY' } });
  handlers.keydown({ code: 'KeyA', repeat: true, target: { tagName: 'BODY' } }); // auto-repeat ignored
  handlers.keydown({ code: 'KeyX', target: { tagName: 'BODY' } });               // octave up
  handlers.keyup({ code: 'KeyA' });                                              // releases the note that was pressed
  handlers.keydown({ code: 'KeyS', target: { tagName: 'BODY' } });
  handlers.keydown({ code: 'KeyD', ctrlKey: true, target: { tagName: 'BODY' } }); // shortcuts ignored
  assert.deepEqual(got, ['noteOn:60', 'noteOff:60', 'noteOn:74']);
});
