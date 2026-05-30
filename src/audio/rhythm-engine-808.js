/**
 * rhythm-engine-808.js
 *
 * The 808 drum-machine voice synthesis for RhythmEngine, split out of the
 * (formerly ~2,000 line) `rhythm-engine.js` to keep each file focused.
 *
 * These are plain methods that run in the context of a `RhythmEngine`
 * instance (`this`), so they are mixed onto `RhythmEngine.prototype` via
 * `Object.assign` in `rhythm-engine.js`. They rely on shared helpers that
 * stay on the core class: `createDriveCurve`, `getNoiseBuffer`,
 * `connectTrackOutput`, `connectTrackBus`, `scheduleVoiceCleanup`, plus the
 * `context` / `config` / `drumBus` / `masterGain` graph nodes.
 */
import { clamp01, finiteNumber } from "./rhythm-config.js";

export const EightOhEightVoices = {
  play808Overlay(hit, time, gain = 0.4) {
    const amount = clamp01(gain) * this.config.eightOhEightLevel;
    if (!this.context || !this.masterGain || amount <= 0.001) return;
    if (hit === "kick") {
      this.play808Kick(time, Math.max(amount, this.config.eightOhEightLevel * 0.18), 0, hit);
    } else if (hit === "snare") {
      this.play808Snare(time, amount * 0.82, hit);
    } else if (hit === "hat") {
      this.play808Hat(time, amount * 0.52, hit);
    } else if (hit === "rim") {
      this.play808Click(time, amount * 0.42, hit);
    }
  },

  play808Kick(time, amount, tuneOffset = 0, track = "eightOhEightKick", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const tune = 2 ** ((this.config.eightOhEightTune + finiteNumber(tuneOffset, 0)) / 12);
    const oscillator = this.context.createOscillator();
    const body = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const drive = this.context.createWaveShaper();
    const kickGain = this.context.createGain();
    oscillator.type = "sine";
    body.type = "sine";
    oscillator.frequency.setValueAtTime(68 * tune, now);
    oscillator.frequency.exponentialRampToValueAtTime(36 * tune, now + 0.34);
    body.frequency.setValueAtTime(49 * tune, now);
    body.frequency.setTargetAtTime(43 * tune, now + 0.12, 0.18);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(132, now);
    filter.Q.setValueAtTime(0.75, now);
    drive.curve = this.createDriveCurve(0.22 + amount * 0.18);
    drive.oversample = "2x";
    kickGain.gain.setValueAtTime(0.0001, now);
    kickGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Math.min(0.48, amount * 0.95)), now + 0.03);
    kickGain.gain.setTargetAtTime(Math.max(0.0002, Math.min(0.26, amount * 0.46)), now + 0.08, 0.12);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.78);
    oscillator.connect(filter);
    body.connect(filter);
    filter.connect(drive);
    drive.connect(kickGain);
    const nodes = [oscillator, body, filter, drive, kickGain];
    this.connectTrackOutput(kickGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(kickGain, track, options, nodes);
    oscillator.start(now);
    body.start(now);
    oscillator.stop(now + 0.82);
    body.stop(now + 0.82);
    this.scheduleVoiceCleanup([oscillator, body], nodes);
  },

  play808Snare(time, amount, track = "snare", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    const tone = this.context.createOscillator();
    const toneGain = this.context.createGain();
    noise.buffer = this.getNoiseBuffer();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1750, now);
    filter.Q.setValueAtTime(0.8, now);
    noiseGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.12, amount * 0.18)), now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    tone.type = "triangle";
    tone.frequency.setValueAtTime(184, now);
    toneGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.08, amount * 0.1)), now);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    noise.connect(filter);
    filter.connect(noiseGain);
    tone.connect(toneGain);
    const snareOut = this.context.createGain();
    noiseGain.connect(snareOut);
    toneGain.connect(snareOut);
    const nodes = [noise, filter, noiseGain, tone, toneGain, snareOut];
    this.connectTrackOutput(snareOut, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(snareOut, track, options, nodes);
    noise.start(now);
    tone.start(now);
    noise.stop(now + 0.18);
    tone.stop(now + 0.14);
    this.scheduleVoiceCleanup([noise, tone], nodes);
  },

  play808Hat(time, amount, track = "eightOhEightHat", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const hatGain = this.context.createGain();
    noise.buffer = this.getNoiseBuffer();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(6500, now);
    filter.Q.setValueAtTime(0.7, now);
    hatGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.045, amount * 0.08)), now);
    hatGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    noise.connect(filter);
    filter.connect(hatGain);
    const nodes = [noise, filter, hatGain];
    this.connectTrackOutput(hatGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(hatGain, track, options, nodes);
    noise.start(now);
    noise.stop(now + 0.07);
    this.scheduleVoiceCleanup([noise], nodes);
  },

  play808Click(time, amount, track = "eightOhEightClick", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const clickGain = this.context.createGain();
    noise.buffer = this.getNoiseBuffer();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(3200, now);
    clickGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.04, amount * 0.11)), now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.026);
    noise.connect(filter);
    filter.connect(clickGain);
    const nodes = [noise, filter, clickGain];
    this.connectTrackOutput(clickGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(clickGain, track, options, nodes);
    noise.start(now);
    noise.stop(now + 0.04);
    this.scheduleVoiceCleanup([noise], nodes);
  },

  play808Clap(time, amount, track = "eightOhEightClap", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const filter = this.context.createBiquadFilter();
    const clapGain = this.context.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1100, now);
    filter.Q.setValueAtTime(1.3, now);
    filter.connect(clapGain);
    const nodes = [filter, clapGain];
    this.connectTrackOutput(clapGain, track, this.drumBus || this.masterGain, nodes);
    // Three quick noise bursts to imitate the 808 clap's stacked transients.
    const bursts = [0, 0.009, 0.018, 0.04];
    const sources = [];
    bursts.forEach((offset, index) => {
      const noise = this.context.createBufferSource();
      const burstGain = this.context.createGain();
      noise.buffer = this.getNoiseBuffer();
      const peak = Math.max(0.0001, Math.min(0.12, amount * (index === bursts.length - 1 ? 0.16 : 0.1)));
      const start = now + offset;
      burstGain.gain.setValueAtTime(peak, start);
      burstGain.gain.exponentialRampToValueAtTime(0.0001, start + (index === bursts.length - 1 ? 0.16 : 0.03));
      noise.connect(burstGain);
      burstGain.connect(filter);
      noise.start(start);
      noise.stop(start + (index === bursts.length - 1 ? 0.18 : 0.04));
      nodes.push(noise, burstGain);
      sources.push(noise);
    });
    this.connectTrackBus(clapGain, track, options, nodes);
    this.scheduleVoiceCleanup(sources, nodes);
  },

  play808Tom(time, amount, tuneOffset = 0, track = "eightOhEightTomMid", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const tune = 2 ** ((this.config.eightOhEightTune + finiteNumber(tuneOffset, 0)) / 12);
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const tomGain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(180 * tune, now);
    oscillator.frequency.exponentialRampToValueAtTime(92 * tune, now + 0.26);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);
    filter.Q.setValueAtTime(1.1, now);
    tomGain.gain.setValueAtTime(0.0001, now);
    tomGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Math.min(0.34, amount * 0.7)), now + 0.012);
    tomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    oscillator.connect(filter);
    filter.connect(tomGain);
    const nodes = [oscillator, filter, tomGain];
    this.connectTrackOutput(tomGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(tomGain, track, options, nodes);
    oscillator.start(now);
    oscillator.stop(now + 0.46);
    this.scheduleVoiceCleanup([oscillator], nodes);
  },

  play808Cowbell(time, amount, track = "eightOhEightCowbell", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const oscA = this.context.createOscillator();
    const oscB = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const bellGain = this.context.createGain();
    oscA.type = "square";
    oscB.type = "square";
    oscA.frequency.setValueAtTime(540, now);
    oscB.frequency.setValueAtTime(800, now);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2640, now);
    filter.Q.setValueAtTime(1.6, now);
    bellGain.gain.setValueAtTime(0.0001, now);
    bellGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Math.min(0.18, amount * 0.32)), now + 0.006);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(bellGain);
    const nodes = [oscA, oscB, filter, bellGain];
    this.connectTrackOutput(bellGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(bellGain, track, options, nodes);
    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.34);
    oscB.stop(now + 0.34);
    this.scheduleVoiceCleanup([oscA, oscB], nodes);
  },

  play808Conga(time, amount, tuneOffset = 0, track = "eightOhEightConga", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const tune = 2 ** ((this.config.eightOhEightTune + finiteNumber(tuneOffset, 0)) / 12);
    const oscillator = this.context.createOscillator();
    const congaGain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(360 * tune, now);
    oscillator.frequency.exponentialRampToValueAtTime(300 * tune, now + 0.12);
    congaGain.gain.setValueAtTime(0.0001, now);
    congaGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Math.min(0.26, amount * 0.5)), now + 0.008);
    congaGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(congaGain);
    const nodes = [oscillator, congaGain];
    this.connectTrackOutput(congaGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(congaGain, track, options, nodes);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
    this.scheduleVoiceCleanup([oscillator], nodes);
  },

  play808Maraca(time, amount, track = "eightOhEightMaraca", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const maracaGain = this.context.createGain();
    noise.buffer = this.getNoiseBuffer();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(9000, now);
    maracaGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.04, amount * 0.09)), now);
    maracaGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    noise.connect(filter);
    filter.connect(maracaGain);
    const nodes = [noise, filter, maracaGain];
    this.connectTrackOutput(maracaGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(maracaGain, track, options, nodes);
    noise.start(now);
    noise.stop(now + 0.05);
    this.scheduleVoiceCleanup([noise], nodes);
  },

  play808Cymbal(time, amount, track = "eightOhEightCymbal", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const cymbalGain = this.context.createGain();
    noise.buffer = this.getNoiseBuffer();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(7800, now);
    filter.Q.setValueAtTime(0.5, now);
    cymbalGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.05, amount * 0.07)), now);
    cymbalGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    noise.connect(filter);
    filter.connect(cymbalGain);
    const nodes = [noise, filter, cymbalGain];
    this.connectTrackOutput(cymbalGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(cymbalGain, track, options, nodes);
    noise.start(now);
    noise.stop(now + 0.95);
    this.scheduleVoiceCleanup([noise], nodes);
  }
};
