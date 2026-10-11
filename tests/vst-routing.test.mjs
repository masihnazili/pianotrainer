import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoSynth } from '../renderer/js/audio/synth.js';

test('VST3 adapter routes notes, sustain, volume, and panic without requiring a browser audio context', () => {
  const calls = [];
  const host = {
    noteOn: (...args) => calls.push(['noteOn', ...args]),
    noteOff: (...args) => calls.push(['noteOff', ...args]),
    sustain: (...args) => calls.push(['sustain', ...args]),
    allNotesOff: (...args) => calls.push(['allNotesOff', ...args]),
    setVolume: (...args) => calls.push(['setVolume', ...args]),
  };
  const synth = new PianoSynth();
  synth.setExternalHost(host);
  assert.equal(synth.setSoundMode('vst3'), 'vst3');
  assert.deepEqual(synth.availableSoundModes, ['synth', 'vst3']);
  synth.noteOn(60, 0.75);
  synth.noteOff(60);
  synth.setSustain(true);
  synth.setVolume(0.6);
  synth.allNotesOff();
  assert.deepEqual(calls, [
    ['noteOn', 60, 0.75, 0],
    ['noteOff', 60, 0],
    ['sustain', true, 0],
    ['setVolume', 0.6],
    ['allNotesOff'],
  ]);
});

test('removing a crashed VST host safely returns the engine to built-in synth', () => {
  const synth = new PianoSynth();
  synth.setExternalHost({ noteOn() {} });
  assert.equal(synth.setSoundMode('vst3'), 'vst3');
  synth.setExternalHost(null);
  assert.equal(synth.soundMode, 'synth');
  assert.deepEqual(synth.availableSoundModes, ['synth']);
});
