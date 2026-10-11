import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, MicrophoneInput } from '../renderer/js/input/microphone.js';

function tone(hz, sampleRate = 44100, size = 4096, amplitude = 0.3) {
  return Float32Array.from({ length: size }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / sampleRate));
}

test('detectPitch estimates common piano pitches within one semitone', () => {
  for (const [hz, midi] of [[261.63, 60], [329.63, 64], [440, 69], [146.83, 50], [659.25, 76]]) {
    const detected = detectPitch(tone(hz), 44100);
    assert.ok(detected, `expected pitch for ${hz} Hz`);
    assert.equal(detected.midi, midi, `${hz} Hz should map to MIDI ${midi}`);
  }
});

test('detectPitch ignores silence and frequencies outside the supported range', () => {
  assert.equal(detectPitch(new Float32Array(4096), 44100), null);
  assert.equal(detectPitch(tone(30), 44100), null);
});

test('MicrophoneInput reports support based on browser media APIs', () => {
  assert.equal(typeof MicrophoneInput.supported, 'boolean');
});
