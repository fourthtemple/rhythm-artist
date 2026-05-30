/**
 * rhythm-engine-synth.js
 *
 * The pitched / melodic synth voices for RhythmEngine (bass, pluck, funk,
 * echo ping, pad, whale, and the oscillator fallback), split out of the
 * (formerly ~2,000 line) `rhythm-engine.js` to keep each file focused.
 *
 * These are plain methods that run in the context of a `RhythmEngine`
 * instance (`this`), so they are mixed onto `RhythmEngine.prototype` via
 * `Object.assign` in `rhythm-engine.js`. They rely on shared helpers that
 * stay on the core class: `synthGain`, `synthFrequency`, `trackIsAudible`,
 * `connectTrackOutput`, `connectTrackBus`, `pushDubFx`, `scheduleVoiceCleanup`,
 * plus the `context` / `config` / `masterGain` / `drumBus` graph nodes.
 */
import { STEP_OPTION_DEFAULTS, clamp01, finiteNumber } from "./rhythm-config.js";

export const SynthVoices = {
  playBassSynth(time, frequency, {
    gain = 0.09,
    duration = 0.28,
    style = this.activePatternStyle,
    attackMs = STEP_OPTION_DEFAULTS.attackMs,
    delayMs = STEP_OPTION_DEFAULTS.delayMs,
    delaySend = STEP_OPTION_DEFAULTS.delaySend,
    reverbSend = STEP_OPTION_DEFAULTS.reverbSend,
    dubEcho = STEP_OPTION_DEFAULTS.dubEcho
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = Math.max(this.context.currentTime, time);
    const safeDuration = Math.max(0.08, duration);
    const oscillator = this.context.createOscillator();
    const sub = this.context.createOscillator();
    const accent = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const bassGain = this.context.createGain();
    const accentGain = this.context.createGain();
    oscillator.type = style === "jazz" ? "triangle" : "sawtooth";
    sub.type = "sine";
    accent.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    sub.frequency.setValueAtTime(frequency * 0.5, now);
    accent.frequency.setValueAtTime(frequency * 2, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(220 + this.config.bassTone * 820 + this.activeBarIntensity * 280, now);
    filter.frequency.exponentialRampToValueAtTime(86 + this.config.bassTone * 120, now + safeDuration);
    filter.Q.setValueAtTime(3.8 + this.config.bassTone * 4.5, now);
    const attackSeconds = Math.max(0.006, Math.min(0.28, finiteNumber(attackMs, STEP_OPTION_DEFAULTS.attackMs) / 1000));
    const peakGain = Math.max(0.0002, this.synthGain(gain) * this.config.bassLevel);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.exponentialRampToValueAtTime(peakGain, now + attackSeconds);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    accentGain.gain.setValueAtTime(0.0001, now);
    accentGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peakGain * 0.18), now + 0.008);
    accentGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    oscillator.connect(filter);
    sub.connect(filter);
    filter.connect(bassGain);
    const bassOut = this.context.createGain();
    bassGain.connect(bassOut);
    accent.connect(accentGain);
    accentGain.connect(bassOut);
    const nodes = [oscillator, sub, accent, filter, bassGain, accentGain, bassOut];
    this.connectTrackOutput(bassOut, "bass", this.masterGain, nodes);
    this.connectTrackBus(bassGain, "bass", { delaySend, reverbSend, dubEcho }, nodes);
    const echoAmount = Math.max(clamp01(delaySend), clamp01(dubEcho));
    if (echoAmount > 0.001) {
      this.pushDubFx(now + Math.max(0, finiteNumber(delayMs, 0) / 1000), echoAmount * 0.7, {
        sustainSeconds: 0.35 + clamp01(dubEcho) * 1.9
      });
    }
    oscillator.start(now);
    sub.start(now);
    accent.start(now);
    oscillator.stop(now + safeDuration + 0.02);
    sub.stop(now + safeDuration + 0.02);
    accent.stop(now + 0.07);
    this.scheduleVoiceCleanup([oscillator, sub, accent], nodes);
  },

  playPluckSynth(time, frequency, {
    gain = 0.05,
    duration = 0.24,
    pan = 0,
    wobble = STEP_OPTION_DEFAULTS.wobble,
    delaySend = STEP_OPTION_DEFAULTS.delaySend,
    reverbSend = STEP_OPTION_DEFAULTS.reverbSend,
    dubEcho = STEP_OPTION_DEFAULTS.dubEcho
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = Math.max(this.context.currentTime, time);
    const safeDuration = Math.max(0.06, duration);
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const pluckGain = this.context.createGain();
    const wobbleAmount = Math.max(0, Math.min(4, finiteNumber(wobble, 0)));
    let lfo = null;
    let lfoGain = null;
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.setTargetAtTime(frequency * 0.995, now + 0.02, 0.08);
    if (wobbleAmount > 0.001) {
      const centsDepth = wobbleAmount * 32;
      const frequencyDepth = frequency * (2 ** (centsDepth / 1200) - 1);
      lfo = this.context.createOscillator();
      lfoGain = this.context.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(4.8 + wobbleAmount * 1.4, now);
      lfoGain.gain.setValueAtTime(frequencyDepth, now);
      lfo.connect(lfoGain);
      lfoGain.connect(oscillator.frequency);
    }
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency * 2.1, now);
    filter.Q.setValueAtTime(7, now);
    pluckGain.gain.setValueAtTime(0.0001, now);
    pluckGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.synthGain(gain)), now + 0.012);
    pluckGain.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    oscillator.connect(filter);
    if (panner) {
      filter.connect(panner);
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
      panner.connect(pluckGain);
    } else {
      filter.connect(pluckGain);
    }
    const nodes = [oscillator, filter, pluckGain];
    if (panner) nodes.push(panner);
    if (lfo) nodes.push(lfo);
    if (lfoGain) nodes.push(lfoGain);
    this.connectTrackOutput(pluckGain, "pluck", this.masterGain, nodes);
    this.connectTrackBus(pluckGain, "pluck", { delaySend, reverbSend, dubEcho }, nodes);
    oscillator.start(now);
    if (lfo) lfo.start(now);
    oscillator.stop(now + safeDuration + 0.02);
    if (lfo) lfo.stop(now + safeDuration + 0.02);
    this.scheduleVoiceCleanup([oscillator], nodes);
  },

  playFunkSynth(time, frequency, {
    gain = 0.045,
    duration = 0.18,
    pan = 0,
    bite = 0.6,
    wobble = STEP_OPTION_DEFAULTS.wobble,
    delaySend = STEP_OPTION_DEFAULTS.delaySend,
    reverbSend = STEP_OPTION_DEFAULTS.reverbSend,
    dubEcho = STEP_OPTION_DEFAULTS.dubEcho
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = Math.max(this.context.currentTime, time);
    const safeDuration = Math.max(0.05, duration);
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const funkGain = this.context.createGain();
    const wobbleAmount = Math.max(0, Math.min(4, finiteNumber(wobble, 0)));
    let lfo = null;
    let lfoGain = null;
    let filterLfoGain = null;
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.setTargetAtTime(frequency * 1.006, now + 0.012, 0.06);
    if (wobbleAmount > 0.001) {
      const centsDepth = wobbleAmount * 42;
      const frequencyDepth = frequency * (2 ** (centsDepth / 1200) - 1);
      lfo = this.context.createOscillator();
      lfoGain = this.context.createGain();
      filterLfoGain = this.context.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(5.2 + wobbleAmount * 1.8, now);
      lfoGain.gain.setValueAtTime(frequencyDepth, now);
      filterLfoGain.gain.setValueAtTime(40 + wobbleAmount * 70, now);
      lfo.connect(lfoGain);
      lfo.connect(filterLfoGain);
      lfoGain.connect(oscillator.frequency);
      filterLfoGain.connect(filter.frequency);
    }
    filter.type = "lowpass";
    filter.Q.setValueAtTime(5 + bite * 4, now);
    filter.frequency.setValueAtTime(480 + bite * 420, now);
    filter.frequency.exponentialRampToValueAtTime(1250 + bite * 1050, now + safeDuration * 0.32);
    filter.frequency.exponentialRampToValueAtTime(520, now + safeDuration);
    funkGain.gain.setValueAtTime(0.0001, now);
    const funkLevel = this.synthGain(gain);
    funkGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, funkLevel), now + 0.01);
    funkGain.gain.setTargetAtTime(funkLevel * 0.34, now + safeDuration * 0.32, safeDuration * 0.12);
    funkGain.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    oscillator.connect(filter);
    if (panner) {
      filter.connect(panner);
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
      panner.connect(funkGain);
    } else {
      filter.connect(funkGain);
    }
    const nodes = [oscillator, filter, funkGain];
    if (panner) nodes.push(panner);
    if (lfo) nodes.push(lfo);
    if (lfoGain) nodes.push(lfoGain);
    if (filterLfoGain) nodes.push(filterLfoGain);
    this.connectTrackOutput(funkGain, "funk", this.masterGain, nodes);
    this.connectTrackBus(funkGain, "funk", { delaySend, reverbSend, dubEcho }, nodes);
    oscillator.start(now);
    if (lfo) lfo.start(now);
    oscillator.stop(now + safeDuration + 0.03);
    if (lfo) lfo.stop(now + safeDuration + 0.03);
    this.scheduleVoiceCleanup([oscillator], nodes);
  },

  playEchoPingSynth(time, {
    gain = 0.04,
    duration = 0.6,
    frequency = this.synthFrequency(12, 1),
    pan = 0,
    delaySend = STEP_OPTION_DEFAULTS.delaySend,
    reverbSend = STEP_OPTION_DEFAULTS.reverbSend,
    dubEcho = STEP_OPTION_DEFAULTS.dubEcho
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = Math.max(this.context.currentTime, time);
    const safeDuration = Math.max(0.12, duration);
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const pingGain = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.setTargetAtTime(frequency * 0.74, now + safeDuration * 0.2, safeDuration * 0.32);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency * 1.45, now);
    filter.Q.setValueAtTime(5.5, now);
    pingGain.gain.setValueAtTime(0.0001, now);
    pingGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.synthGain(gain)), now + 0.015);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    oscillator.connect(filter);
    if (panner) {
      filter.connect(panner);
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
      panner.connect(pingGain);
    } else {
      filter.connect(pingGain);
    }
    const nodes = [oscillator, filter, pingGain];
    if (panner) nodes.push(panner);
    if (this.fxSend) {
      this.connectTrackBus(pingGain, "echo", { delaySend, reverbSend, dubEcho }, nodes);
    } else {
      pingGain.connect(this.masterGain);
    }
    oscillator.start(now);
    oscillator.stop(now + safeDuration + 0.03);
    this.scheduleVoiceCleanup([oscillator], nodes);
  },

  playPadSynth(time, frequencies, {
    gain = 0.045,
    duration = 1.5,
    style = this.activePatternStyle,
    wobble = STEP_OPTION_DEFAULTS.wobble,
    delaySend = STEP_OPTION_DEFAULTS.delaySend,
    reverbSend = STEP_OPTION_DEFAULTS.reverbSend,
    dubEcho = STEP_OPTION_DEFAULTS.dubEcho
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = Math.max(this.context.currentTime, time);
    const safeDuration = Math.max(0.2, duration);
    const filter = this.context.createBiquadFilter();
    const padGain = this.context.createGain();
    const oscillators = [];
    const wobbleAmount = Math.max(0, Math.min(4, finiteNumber(wobble, 0)));
    let lfo = null;
    let detuneGain = null;
    let filterLfoGain = null;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(style === "jazz" ? 980 : 760, now);
    filter.frequency.setTargetAtTime(420 + this.activeBarIntensity * 520, now + safeDuration * 0.35, safeDuration * 0.4);
    filter.Q.setValueAtTime(1.8, now);
    if (wobbleAmount > 0.001) {
      lfo = this.context.createOscillator();
      detuneGain = this.context.createGain();
      filterLfoGain = this.context.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(2.6 + wobbleAmount * 0.75, now);
      detuneGain.gain.setValueAtTime(10 + wobbleAmount * 14, now);
      filterLfoGain.gain.setValueAtTime(18 + wobbleAmount * 38, now);
      lfo.connect(detuneGain);
      lfo.connect(filterLfoGain);
      filterLfoGain.connect(filter.frequency);
    }
    padGain.gain.setValueAtTime(0.0001, now);
    const rawPadLevel = this.synthGain(gain);
    const padLevel = Math.min(0.26, rawPadLevel * 0.68);
    padGain.gain.linearRampToValueAtTime(padLevel, now + Math.min(0.42, safeDuration * 0.25));
    padGain.gain.setTargetAtTime(padLevel * 0.55, now + safeDuration * 0.55, safeDuration * 0.2);
    padGain.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    frequencies.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      oscillator.type = index === 0 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency * (1 + (index - 1) * 0.003), now);
      if (detuneGain) detuneGain.connect(oscillator.detune);
      oscillator.connect(filter);
      oscillator.start(now);
      oscillator.stop(now + safeDuration + 0.04);
      oscillators.push(oscillator);
    });
    filter.connect(padGain);
    const nodes = [filter, padGain, ...oscillators];
    if (lfo) nodes.push(lfo);
    if (detuneGain) nodes.push(detuneGain);
    if (filterLfoGain) nodes.push(filterLfoGain);
    this.connectTrackOutput(padGain, "pad", this.masterGain, nodes);
    this.connectTrackBus(padGain, "pad", { delaySend, reverbSend, dubEcho }, nodes);
    if (lfo) {
      lfo.start(now);
      lfo.stop(now + safeDuration + 0.04);
    }
    this.scheduleVoiceCleanup(lfo ? [...oscillators, lfo] : oscillators, nodes);
  },

  scheduleWhaleLayer(time, style) {
    if (!this.trackIsAudible("whale")) return;
    const pressure = clamp01(this.activeBarIntensity);
    const amount = clamp01(this.config.whaleAutoAmount);
    if (amount <= 0.01) return;
    const barsBetween = pressure > 0.72 ? 4 : pressure > 0.45 ? 8 : 16;
    const lowIntensityChance = pressure > 0.45 && amount > 0.08;
    if (!lowIntensityChance) return;
    if (this.barIndex - this.lastWhaleBar < barsBetween) return;
    this.lastWhaleBar = this.barIndex;
    const upbend = 0.35;
    const gain = (0.05 + pressure * 0.1) * amount;
    const duration = 1.1 + amount * 0.4;
    const whaleOffset = this.config.generatedWhaleOffsetMs / 1000;
    this.playWhaleSynth(time + 0.015 + whaleOffset, {
      gain,
      duration,
      style,
      bend: upbend,
      pan: Math.sin(this.barIndex * 1.7) * 0.42
    });
    if (pressure > 0.82 && amount > 0.45) {
      this.playWhaleSynth(time + this.activeStepDurationSeconds * 6 + whaleOffset, {
        gain: gain * 0.62,
        duration: duration * 0.72,
        style,
        bend: -0.45,
        pan: Math.cos(this.barIndex * 1.3) * 0.38
      });
    }
  },

  playWhaleSynth(time, {
    gain = 0.2,
    duration = 1.2,
    style = this.activePatternStyle,
    bend = 0.7,
    pan = 0,
    delaySend = STEP_OPTION_DEFAULTS.delaySend,
    reverbSend = STEP_OPTION_DEFAULTS.reverbSend,
    dubEcho = STEP_OPTION_DEFAULTS.dubEcho
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const now = Math.max(this.context.currentTime, time);
    const safeDuration = Math.max(0.18, duration);
    const pressure = clamp01(this.activeBarIntensity || this.intensity);
    const baseFrequency = 132;
    const endFrequency = Math.max(32, baseFrequency * (bend >= 0 ? 1.85 + pressure * 1.35 : 0.48));
    const oscillator = this.context.createOscillator();
    const second = this.context.createOscillator();
    const lfo = this.context.createOscillator();
    const lfoDepth = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const voiceGain = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    oscillator.type = "triangle";
    second.type = "sine";
    oscillator.frequency.setValueAtTime(baseFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + safeDuration * 0.78);
    second.frequency.setValueAtTime(baseFrequency * 0.503, now);
    second.frequency.exponentialRampToValueAtTime(Math.max(24, endFrequency * 0.51), now + safeDuration * 0.76);
    lfo.frequency.setValueAtTime(2.1, now);
    lfo.frequency.linearRampToValueAtTime(3.2 + pressure * 8.5, now + safeDuration);
    lfoDepth.gain.setValueAtTime(8 + pressure * 36, now);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(4.5, now);
    filter.frequency.setValueAtTime(820, now);
    filter.frequency.exponentialRampToValueAtTime(1200 + pressure * 1600, now + safeDuration * 0.62);
    filter.frequency.exponentialRampToValueAtTime(260, now + safeDuration);
    const attack = Math.min(0.16, safeDuration * 0.22);
    const releaseStart = now + safeDuration * 0.72;
    voiceGain.gain.setValueAtTime(0.0001, now);
    const whaleLevel = this.synthGain(gain);
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, whaleLevel * 0.32), now + attack);
    voiceGain.gain.setTargetAtTime(Math.max(0.0001, whaleLevel * 0.18), releaseStart, safeDuration * 0.1);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    if (panner) {
      panner.pan.setValueAtTime(clamp01((pan + 1) / 2) * 2 - 1, now);
      filter.connect(panner);
      panner.connect(voiceGain);
    } else {
      filter.connect(voiceGain);
    }
    lfo.connect(lfoDepth);
    lfoDepth.connect(oscillator.frequency);
    lfoDepth.connect(second.frequency);
    oscillator.connect(filter);
    second.connect(filter);
    const nodes = [oscillator, second, lfo, lfoDepth, filter, voiceGain];
    if (panner) nodes.push(panner);
    this.connectTrackOutput(voiceGain, "whale", this.masterGain, nodes);
    this.connectTrackBus(voiceGain, "whale", { delaySend, reverbSend, dubEcho }, nodes);
    oscillator.start(now);
    second.start(now);
    lfo.start(now);
    oscillator.stop(now + safeDuration + 0.05);
    second.stop(now + safeDuration + 0.05);
    lfo.stop(now + safeDuration + 0.05);
    this.scheduleVoiceCleanup([oscillator, second, lfo], nodes);
  },

  playSynthFallback(hit, time, gain) {
    const oscillator = this.context.createOscillator();
    const hitGain = this.context.createGain();
    const now = Math.max(this.context.currentTime, time);
    oscillator.frequency.setValueAtTime(hit === "kick" ? 92 : hit === "snare" ? 210 : 520, now);
    oscillator.frequency.exponentialRampToValueAtTime(hit === "kick" ? 42 : 140, now + 0.12);
    hitGain.gain.setValueAtTime(Math.max(0, gain) * 0.18, now);
    hitGain.gain.exponentialRampToValueAtTime(0.001, now + (hit === "kick" ? 0.22 : 0.08));
    oscillator.connect(hitGain);
    hitGain.connect(this.drumBus || this.masterGain);
    const nodes = [oscillator, hitGain];
    this.connectTrackBus(hitGain, hit, {}, nodes);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
    this.scheduleVoiceCleanup([oscillator], nodes);
  }
};
