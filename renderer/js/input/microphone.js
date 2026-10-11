// Acoustic-piano input for devices without MIDI. This detects the dominant pitch only;
// it is intended for single-note exercises, not reliable chord/polyphony recognition.

export function detectPitch(buffer, sampleRate, { minHz = 55, maxHz = 1000, threshold = 0.16, minRms = 0.012 } = {}) {
  const n = buffer.length;
  if (n < 512 || !Number.isFinite(sampleRate)) return null;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buffer[i] * buffer[i];
  const rms = Math.sqrt(energy / n);
  if (rms < minRms) return null;

  // YIN difference function, then cumulative-mean normalization.
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2) - 1);
  if (maxTau <= minTau) return null;
  const diff = new Float32Array(maxTau + 1);
  diff[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    const end = n - maxTau;
    for (let i = 0; i < end; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau];
    diff[tau] = running ? diff[tau] * tau / running : 1;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (diff[tau] < threshold) {
      while (tau + 1 <= maxTau && diff[tau + 1] < diff[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) return null;

  // Parabolic interpolation improves tuning accuracy between FFT/sample bins.
  const left = diff[Math.max(1, tauEstimate - 1)];
  const center = diff[tauEstimate];
  const right = diff[Math.min(maxTau, tauEstimate + 1)];
  const denom = 2 * (2 * center - right - left);
  const shift = denom ? (right - left) / denom : 0;
  const period = tauEstimate + Math.max(-1, Math.min(1, shift));
  const hz = sampleRate / period;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;
  return { hz, midi: Math.round(69 + 12 * Math.log2(hz / 440)), rms };
}

export class MicrophoneInput {
  constructor({ onEvent, onStatus } = {}) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.frame = null;
    this.running = false;
    this.currentMidi = null;
    this.candidateMidi = null;
    this.candidateFrames = 0;
    this.lastOn = 0;
    this.lastAnalysis = 0;
  }

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
  }

  async start() {
    if (!MicrophoneInput.supported) throw new Error('دسترسی میکروفون در این محیط پشتیبانی نمی‌شود؛ از localhost یا نسخه دسکتاپ استفاده کنید.');
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
    try {
      this.context = new AudioContext();
      await this.context.resume();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0;
      this.source.connect(this.analyser);
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.running = true;
      this.onStatus?.('listening');
      this._loop();
    } catch (e) {
      this.stop();
      throw e;
    }
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now() / 1000;
    if (now - this.lastAnalysis < 0.05) {
      this.frame = requestAnimationFrame(() => this._loop());
      return;
    }
    this.lastAnalysis = now;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const detected = detectPitch(this.buffer, this.context.sampleRate);
    if (detected) {
      this.lastOn = now;
      if (detected.midi === this.candidateMidi) this.candidateFrames++;
      else { this.candidateMidi = detected.midi; this.candidateFrames = 1; }
      if (this.candidateFrames >= 2 && this.currentMidi !== this.candidateMidi) {
        if (this.currentMidi !== null) this._emit('noteOff', this.currentMidi, 0, now);
        this.currentMidi = this.candidateMidi;
        this.lastOn = now;
        this._emit('noteOn', this.currentMidi, Math.min(1, Math.max(0.15, detected.rms * 8)), now);
      }
    } else {
      this.candidateMidi = null;
      this.candidateFrames = 0;
      // Short release hold prevents piano decay/noisy frames from chattering note-off.
      if (this.currentMidi !== null && now - this.lastOn > 0.18) {
        this._emit('noteOff', this.currentMidi, 0, now);
        this.currentMidi = null;
      }
    }
    this.frame = requestAnimationFrame(() => this._loop());
  }

  _emit(type, midi, velocity, time) {
    this.onEvent?.({ type, midi, velocity, time, source: 'microphone' });
  }

  stop() {
    this.running = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.currentMidi !== null) this._emit('noteOff', this.currentMidi, 0, performance.now() / 1000);
    this.currentMidi = this.candidateMidi = null;
    this.candidateFrames = 0;
    this.lastAnalysis = 0;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.stream = this.context = this.source = this.analyser = this.buffer = null;
    this.onStatus?.('stopped');
  }
}
