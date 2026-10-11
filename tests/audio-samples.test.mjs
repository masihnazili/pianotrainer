import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleRootNote, nearestSampleRoot } from '../renderer/js/audio/synth.js';

test('sample bank filenames accept MIDI numbers and scientific note names', () => {
  assert.equal(sampleRootNote('60.wav'), 60);
  assert.equal(sampleRootNote('C4.wav'), 60);
  assert.equal(sampleRootNote('F#3.WAV'), 54);
  assert.equal(sampleRootNote('Bb3.wav'), 58);
  assert.equal(sampleRootNote('notes.wav'), null);
  assert.equal(sampleRootNote('128.wav'), null);
});

test('sample root selection chooses the closest available pitch and stable lower tie', () => {
  assert.equal(nearestSampleRoot([48, 60, 72], 65), 60);
  assert.equal(nearestSampleRoot([48, 60], 54), 48);
  assert.equal(nearestSampleRoot([], 60), null);
});
