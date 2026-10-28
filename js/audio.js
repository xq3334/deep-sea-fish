"use strict";

const SOUND_MUTED_STORAGE_KEY = "deep-sea-fish-muted";
const SOUND_MASTER_VOLUME = 0.5;

/** Synthesizes every effect with Web Audio, so the game ships without audio files. */
class SoundEngine {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.isMuted = SoundEngine.loadMutedPreference();
  }

  static loadMutedPreference() {
    try {
      return window.localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "1";
    } catch (storageError) {
      return false;
    }
  }

  /** Browsers only allow audio to start inside a user gesture, so call this from a click or key press. */
  unlock() {
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : SOUND_MASTER_VOLUME;
      this.masterGain.connect(this.audioContext.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }
    this.resume();
  }

  suspend() {
    if (this.audioContext && this.audioContext.state === "running") this.audioContext.suspend();
  }

  resume() {
    if (this.audioContext && this.audioContext.state === "suspended") this.audioContext.resume();
  }

  toggleMuted() {
    this.isMuted = !this.isMuted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : SOUND_MASTER_VOLUME, this.audioContext.currentTime, 0.02);
    }
    try {
      window.localStorage.setItem(SOUND_MUTED_STORAGE_KEY, this.isMuted ? "1" : "0");
    } catch (storageError) {
      // Without storage the preference simply lasts for this session.
    }
    return this.isMuted;
  }

  canPlay() {
    return Boolean(this.audioContext) && !this.isMuted && this.audioContext.state === "running";
  }

  createNoiseBuffer() {
    const sampleCount = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, sampleCount, this.audioContext.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) samples[sampleIndex] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Short attack, exponential decay; exponential ramps need strictly positive values, hence 0.0001. */
  createEnvelope(startTime, durationSeconds, peakVolume) {
    const envelope = this.audioContext.createGain();
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.exponentialRampToValueAtTime(peakVolume, startTime + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);
    envelope.connect(this.masterGain);
    return envelope;
  }

  playTone(waveType, startFrequency, endFrequency, durationSeconds, peakVolume, delaySeconds = 0) {
    if (!this.canPlay()) return;
    const startTime = this.audioContext.currentTime + delaySeconds;
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = waveType;
    oscillator.frequency.setValueAtTime(startFrequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + durationSeconds);
    oscillator.connect(this.createEnvelope(startTime, durationSeconds, peakVolume));
    oscillator.start(startTime);
    oscillator.stop(startTime + durationSeconds + 0.05);
  }

  playNoise(filterType, startFrequency, endFrequency, durationSeconds, peakVolume, delaySeconds = 0) {
    if (!this.canPlay()) return;
    const startTime = this.audioContext.currentTime + delaySeconds;
    const source = this.audioContext.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(startFrequency, startTime);
    filter.frequency.exponentialRampToValueAtTime(endFrequency, startTime + durationSeconds);
    source.connect(filter).connect(this.createEnvelope(startTime, durationSeconds, peakVolume));
    source.start(startTime);
    source.stop(startTime + durationSeconds + 0.05);
  }

  /** Smaller prey pops higher; each combo step raises the pitch a semitone so streaks sound like they build. */
  playEat(preyToPlayerSizeRatio, comboCount) {
    const sizePitch = MathUtils.clamp(1.3 - preyToPlayerSizeRatio * 0.5, 0.75, 1.25);
    const comboPitch = Math.pow(2, Math.min(Math.max(comboCount - 1, 0), 8) / 12);
    const baseFrequency = 520 * sizePitch * comboPitch;
    this.playTone("sine", baseFrequency, baseFrequency * 0.45, 0.13, 0.35);
    this.playNoise("lowpass", 900, 200, 0.1, 0.18);
  }

  playPlankton() {
    this.playTone("sine", 1400, 2100, 0.09, 0.1);
    this.playTone("triangle", 2100, 2800, 0.08, 0.06, 0.04);
  }

  playDash() {
    this.playNoise("bandpass", 400, 1600, 0.35, 0.22);
  }

  playShock() {
    this.playTone("sawtooth", 180, 90, 0.35, 0.16);
    this.playTone("sawtooth", 187, 94, 0.35, 0.12);
    this.playNoise("highpass", 2000, 4000, 0.2, 0.12);
  }

  playEvolve() {
    const chordFrequencies = [523.25, 659.25, 783.99, 1046.5];
    chordFrequencies.forEach((frequency, noteIndex) => {
      this.playTone("triangle", frequency, frequency * 1.01, 0.4, 0.18, noteIndex * 0.09);
      this.playTone("sine", frequency * 2, frequency * 2.02, 0.3, 0.05, noteIndex * 0.09);
    });
  }

  /** Low double pulse, like a heartbeat, when a predator starts chasing the player. */
  playThreat() {
    this.playTone("sine", 110, 80, 0.18, 0.3);
    this.playTone("sine", 105, 75, 0.2, 0.24, 0.22);
  }

  playDeath() {
    this.playTone("sine", 220, 40, 0.9, 0.4);
    this.playNoise("lowpass", 1200, 100, 0.7, 0.28);
  }
}
