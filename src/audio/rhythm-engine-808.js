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
  /**
   * Read the 808 shaping parameters for a given track, normalised into the
   * small set of multipliers the voices below use. The global
   * `eightOhEight*` config knobs provide the defaults ("machine character"),
   * and any per-track override in `config.trackShapes[track]` is layered on
   * top so each 808 track instance can have its own shape. Passing no track
   * (or a track with no override) yields the global shape unchanged.
   */
  get808Shape(track = null) {
    const c = this.config || {};
    const base = {
      drive: clamp01(c.eightOhEightDrive ?? 0.18),
      punch: clamp01(c.eightOhEightPunch ?? 0.35),
      decay: Math.max(0.3, Math.min(2.5, finiteNumber(c.eightOhEightDecay, 1))),
      tone: clamp01(c.eightOhEightTone ?? 0.5),
      sub: clamp01(c.eightOhEightSub ?? 0.45),
      choke: finiteNumber(c.eightOhEightChoke, 0) >= 0.5
    };
    const override = track && c.trackShapes ? c.trackShapes[track] : null;
    if (!override || typeof override !== "object") return base;
    return {
      drive: override.drive === undefined ? base.drive : clamp01(override.drive),
      punch: override.punch === undefined ? base.punch : clamp01(override.punch),
      decay: override.decay === undefined
        ? base.decay
        : Math.max(0.3, Math.min(2.5, finiteNumber(override.decay, base.decay))),
      tone: override.tone === undefined ? base.tone : clamp01(override.tone),
      sub: override.sub === undefined ? base.sub : clamp01(override.sub),
      choke: override.choke === undefined ? base.choke : finiteNumber(override.choke, 0) >= 0.5
    };
  },

  /**
   * Choke-group support. When choke mode is on, retriggering a voice (or a
   * voice in the same exclusive group, e.g. open/closed hat & cymbal "metal"
   * group) fades the previous voice out fast so they don't pile up — exactly
   * how a real 808's open/closed hat share one circuit. Each registered voice
   * gain is faded to silence at `time` over a couple milliseconds.
   */
  choke808Group(group, gainNode, time) {
    if (!this._eight08Chokes) this._eight08Chokes = new Map();
    const previous = this._eight08Chokes.get(group);
    if (previous && previous !== gainNode) {
      try {
        const g = previous.gain;
        g.cancelScheduledValues(time);
        g.setValueAtTime(Math.max(0.0001, g.value || 0.0001), time);
        g.exponentialRampToValueAtTime(0.0001, time + 0.006);
      } catch (_) {
        /* previous voice already torn down */
      }
    }
    this._eight08Chokes.set(group, gainNode);
  },

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
    const shape = this.get808Shape(track);
    const tune = 2 ** ((this.config.eightOhEightTune + finiteNumber(tuneOffset, 0)) / 12);
    const oscillator = this.context.createOscillator();
    const body = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const drive = this.context.createWaveShaper();
    const kickGain = this.context.createGain();
    oscillator.type = "sine";
    body.type = "sine";
    // A deeper start frequency + slower pitch sweep with more "sub" gives the
    // long Miami-bass boom; the sub knob also opens the low-pass for weight.
    const subWeight = 0.55 + shape.sub * 0.9;
    const startHz = 68 - shape.sub * 14;
    const endHz = 36 - shape.sub * 8;
    // Longer decay also lowers the landing pitch a touch so the tail sings.
    const pitchTime = 0.34 * shape.decay;
    oscillator.frequency.setValueAtTime(startHz * tune, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(18, endHz) * tune, now + pitchTime);
    body.frequency.setValueAtTime(49 * tune, now);
    body.frequency.setTargetAtTime(43 * tune, now + 0.12, 0.18);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(132 + shape.sub * 70, now);
    filter.Q.setValueAtTime(0.75 + shape.sub * 0.6, now);
    drive.curve = this.createDriveCurve(0.22 + amount * 0.18 + shape.drive * 0.7);
    drive.oversample = "2x";
    // Punch adds a brief click transient before the body via a faster attack
    // and a short overshoot — the snappy "tick" of a tuned 808 kick.
    const attack = Math.max(0.001, 0.03 - shape.punch * 0.026);
    const peak = Math.max(0.0002, Math.min(0.52, amount * (0.95 + shape.punch * 0.4)));
    const tail = Math.max(0.2, 0.78 * shape.decay);
    kickGain.gain.setValueAtTime(0.0001, now);
    kickGain.gain.exponentialRampToValueAtTime(peak, now + attack);
    kickGain.gain.setTargetAtTime(Math.max(0.0002, Math.min(0.3, amount * subWeight * 0.46)), now + attack + 0.04, 0.12);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    oscillator.connect(filter);
    body.connect(filter);
    filter.connect(drive);
    drive.connect(kickGain);
    const nodes = [oscillator, body, filter, drive, kickGain];
    if (shape.choke) this.choke808Group(track, kickGain, now);
    this.connectTrackOutput(kickGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(kickGain, track, options, nodes);
    oscillator.start(now);
    body.start(now);
    const stopAt = now + tail + 0.04;
    oscillator.stop(stopAt);
    body.stop(stopAt);
    this.scheduleVoiceCleanup([oscillator, body], nodes);
  },

  play808Snare(time, amount, track = "snare", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const shape = this.get808Shape(track);
    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    const tone = this.context.createOscillator();
    const toneGain = this.context.createGain();
    noise.buffer = this.getNoiseBuffer();
    filter.type = "bandpass";
    // Tone knob tilts the noise band brighter/darker; decay lengthens the snap.
    filter.frequency.setValueAtTime(1750 + (shape.tone - 0.5) * 2400, now);
    filter.Q.setValueAtTime(0.8, now);
    const snareTail = Math.max(0.08, 0.16 * shape.decay);
    const snarePeak = Math.max(0.0001, Math.min(0.18, amount * (0.18 + shape.punch * 0.12)));
    noiseGain.gain.setValueAtTime(snarePeak, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + snareTail);
    tone.type = "triangle";
    tone.frequency.setValueAtTime(184, now);
    toneGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.08, amount * 0.1)), now);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 * shape.decay);
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
    noise.stop(now + snareTail + 0.02);
    tone.stop(now + 0.14 * shape.decay);
    this.scheduleVoiceCleanup([noise, tone], nodes);
  },

  play808Hat(time, amount, track = "eightOhEightHat", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const shape = this.get808Shape(track);
    const noiseBuffer = this.getNoiseBuffer();
    const noise = this.context.createBufferSource();
    const bandpass = this.context.createBiquadFilter();
    const highpass = this.context.createBiquadFilter();
    const hatGain = this.context.createGain();
    noise.buffer = noiseBuffer;
    // Band-pass gives the hat its metallic body; the high-pass after it keeps
    // only the bright sizzle so it cuts through the mix instead of vanishing.
    // The tone knob shifts the whole band brighter/darker.
    const toneShift = (shape.tone - 0.5) * 3000;
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(9000 + toneShift, now);
    bandpass.Q.setValueAtTime(0.8, now);
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(6000 + toneShift * 0.5, now);
    // Tiny attack (avoids a DC click) then a fast closed-hat decay scaled by the
    // global decay knob. The level here is matched to the other 808 voices.
    const hatTail = Math.max(0.02, 0.06 * shape.decay);
    const peak = Math.max(0.0002, Math.min(0.16, amount * 0.34));
    hatGain.gain.setValueAtTime(0.0001, now);
    hatGain.gain.exponentialRampToValueAtTime(peak, now + 0.001);
    hatGain.gain.exponentialRampToValueAtTime(0.0001, now + hatTail);
    noise.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(hatGain);
    const nodes = [noise, bandpass, highpass, hatGain];
    // Hat & cymbal share the "metal" choke group like a real 808's open/closed
    // hat circuit — a new hat cuts a ringing open hat or cymbal short.
    if (shape.choke) this.choke808Group("metal", hatGain, now);
    this.connectTrackOutput(hatGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(hatGain, track, options, nodes);
    // Decorrelate from the other noise voices by reading at a random offset.
    const offset = Math.random() * Math.max(0.05, (noiseBuffer.duration || 1) - 0.1);
    noise.start(now, offset);
    noise.stop(now + hatTail + 0.02);
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
    const shape = this.get808Shape(track);
    const noiseBuffer = this.getNoiseBuffer();
    const bufferDuration = noiseBuffer.duration || 1;

    // Tone-shaping chain: a band-pass for the body plus a high-pass to keep the
    // transients crisp, matching the stacked-clap timbre of an analog/TR-808 clap.
    const toneShift = (shape.tone - 0.5) * 900;
    const bandpass = this.context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1180 + toneShift, now);
    bandpass.Q.setValueAtTime(0.72, now);
    const highpass = this.context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(680, now);
    const clapGain = this.context.createGain();
    clapGain.gain.setValueAtTime(1, now);
    bandpass.connect(highpass);
    highpass.connect(clapGain);
    const nodes = [bandpass, highpass, clapGain];
    this.connectTrackOutput(clapGain, track, this.drumBus || this.masterGain, nodes);

    const sources = [];
    // Each burst reads from a *different* random offset into the noise buffer so
    // the layers are decorrelated — this is what kills the phasey/comb artifact
    // the old single-position version produced.
    const makeBurst = (start, peak, decay) => {
      const noise = this.context.createBufferSource();
      const burstGain = this.context.createGain();
      noise.buffer = noiseBuffer;
      burstGain.gain.setValueAtTime(0.0001, start);
      burstGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.0006);
      burstGain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      noise.connect(burstGain);
      burstGain.connect(bandpass);
      const offset = Math.random() * Math.max(0.05, bufferDuration - decay - 0.05);
      noise.start(start, offset);
      noise.stop(start + decay + 0.02);
      nodes.push(noise, burstGain);
      sources.push(noise);
    };

    // Three tight "hand" transients spaced ~10 ms apart with slight jitter.
    const spreadPeak = Math.max(0.0001, Math.min(0.17, amount * 0.17));
    [0, 0.010, 0.020].forEach((base) => {
      const jitter = Math.max(0, (Math.random() * 2 - 1) * 0.0015);
      makeBurst(now + base + jitter, spreadPeak, 0.0125);
    });
    // Longer diffuse "room" tail (scaled by global decay) gives the clap its body.
    makeBurst(now + 0.026, Math.max(0.0001, Math.min(0.14, amount * 0.13)), 0.13 * shape.decay);

    this.connectTrackBus(clapGain, track, options, nodes);
    this.scheduleVoiceCleanup(sources, nodes);
  },

  play808Tom(time, amount, tuneOffset = 0, track = "eightOhEightTomMid", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const shape = this.get808Shape(track);
    const tune = 2 ** ((this.config.eightOhEightTune + finiteNumber(tuneOffset, 0)) / 12);
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const tomGain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(180 * tune, now);
    oscillator.frequency.exponentialRampToValueAtTime(92 * tune, now + 0.26 * shape.decay);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);
    filter.Q.setValueAtTime(1.1, now);
    const tomAttack = Math.max(0.001, 0.012 - shape.punch * 0.01);
    const tomTail = Math.max(0.18, 0.42 * shape.decay);
    tomGain.gain.setValueAtTime(0.0001, now);
    tomGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Math.min(0.34, amount * (0.7 + shape.punch * 0.25))), now + tomAttack);
    tomGain.gain.exponentialRampToValueAtTime(0.0001, now + tomTail);
    oscillator.connect(filter);
    filter.connect(tomGain);
    const nodes = [oscillator, filter, tomGain];
    this.connectTrackOutput(tomGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(tomGain, track, options, nodes);
    oscillator.start(now);
    oscillator.stop(now + tomTail + 0.04);
    this.scheduleVoiceCleanup([oscillator], nodes);
  },

  play808Cowbell(time, amount, track = "eightOhEightCowbell", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    // Authentic TR-808 cowbell: two square waves at ~587 Hz and ~845 Hz (the
    // classic detuned pair), summed and band-passed. A fast click attack plus a
    // short ring gives the metallic "clonk".
    const oscA = this.context.createOscillator();
    const oscB = this.context.createOscillator();
    const oscSum = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const bellGain = this.context.createGain();
    oscA.type = "square";
    oscB.type = "square";
    oscA.frequency.setValueAtTime(587, now);
    oscB.frequency.setValueAtTime(845, now);
    oscSum.gain.setValueAtTime(0.5, now);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2640, now);
    filter.Q.setValueAtTime(1.1, now);
    // Two-stage decay: a brief click transient over a longer body ring.
    const peak = Math.max(0.0002, Math.min(0.18, amount * 0.32));
    bellGain.gain.setValueAtTime(0.0001, now);
    bellGain.gain.exponentialRampToValueAtTime(peak, now + 0.003);
    bellGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.4), now + 0.05);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    oscA.connect(oscSum);
    oscB.connect(oscSum);
    oscSum.connect(filter);
    filter.connect(bellGain);
    const nodes = [oscA, oscB, oscSum, filter, bellGain];
    this.connectTrackOutput(bellGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(bellGain, track, options, nodes);
    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.46);
    oscB.stop(now + 0.46);
    this.scheduleVoiceCleanup([oscA, oscB], nodes);
  },

  play808Conga(time, amount, tuneOffset = 0, track = "eightOhEightConga", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const shape = this.get808Shape(track);
    const tune = 2 ** ((this.config.eightOhEightTune + finiteNumber(tuneOffset, 0)) / 12);
    const oscillator = this.context.createOscillator();
    const congaGain = this.context.createGain();
    // Slight downward pitch glide gives the drum-skin "boing"; a tiny noise
    // click adds the finger transient so it isn't a bare sine beep.
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(360 * tune, now);
    oscillator.frequency.exponentialRampToValueAtTime(290 * tune, now + 0.14 * shape.decay);
    const congaAttack = Math.max(0.001, 0.006 - shape.punch * 0.004);
    const congaTail = Math.max(0.12, 0.24 * shape.decay);
    congaGain.gain.setValueAtTime(0.0001, now);
    congaGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, Math.min(0.26, amount * 0.5)), now + congaAttack);
    congaGain.gain.exponentialRampToValueAtTime(0.0001, now + congaTail);
    oscillator.connect(congaGain);
    const nodes = [oscillator, congaGain];

    // Short attack click (decorrelated noise) for the skin/finger transient.
    const click = this.context.createBufferSource();
    const clickFilter = this.context.createBiquadFilter();
    const clickGain = this.context.createGain();
    click.buffer = this.getNoiseBuffer();
    clickFilter.type = "bandpass";
    clickFilter.frequency.setValueAtTime(420 * tune, now);
    clickFilter.Q.setValueAtTime(0.8, now);
    clickGain.gain.setValueAtTime(Math.max(0.0001, Math.min(0.12, amount * (0.14 + shape.punch * 0.16))), now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    const clickOffset = Math.random() * 0.8;
    nodes.push(click, clickFilter, clickGain);

    const congaOut = this.context.createGain();
    congaGain.connect(congaOut);
    clickGain.connect(congaOut);
    nodes.push(congaOut);
    this.connectTrackOutput(congaOut, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(congaOut, track, options, nodes);
    oscillator.start(now);
    oscillator.stop(now + congaTail + 0.04);
    click.start(now, clickOffset);
    click.stop(now + 0.03);
    this.scheduleVoiceCleanup([oscillator, click], nodes);
  },

  play808Maraca(time, amount, track = "eightOhEightMaraca", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const noiseBuffer = this.getNoiseBuffer();
    const noise = this.context.createBufferSource();
    const highpass = this.context.createBiquadFilter();
    const peakFilter = this.context.createBiquadFilter();
    const maracaGain = this.context.createGain();
    noise.buffer = noiseBuffer;
    // High-pass to remove low rumble, then a resonant peak around 6 kHz to give
    // the "shhk" shaker character rather than thin white hiss.
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(5500, now);
    peakFilter.type = "peaking";
    peakFilter.frequency.setValueAtTime(6200, now);
    peakFilter.Q.setValueAtTime(1.1, now);
    peakFilter.gain.setValueAtTime(8, now);
    // Very fast attack + fast decay = a tight percussive shake.
    const peak = Math.max(0.0002, Math.min(0.045, amount * 0.1));
    maracaGain.gain.setValueAtTime(0.0001, now);
    maracaGain.gain.exponentialRampToValueAtTime(peak, now + 0.002);
    maracaGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    noise.connect(highpass);
    highpass.connect(peakFilter);
    peakFilter.connect(maracaGain);
    const nodes = [noise, highpass, peakFilter, maracaGain];
    this.connectTrackOutput(maracaGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(maracaGain, track, options, nodes);
    // Decorrelate from other noise voices by reading at a random offset.
    const offset = Math.random() * Math.max(0.05, (noiseBuffer.duration || 1) - 0.1);
    noise.start(now, offset);
    noise.stop(now + 0.06);
    this.scheduleVoiceCleanup([noise], nodes);
  },

  play808Cymbal(time, amount, track = "eightOhEightCymbal", options = {}) {
    const now = Math.max(this.context.currentTime, time);
    const shape = this.get808Shape(track);
    // Classic TR-808 metal tone: six square oscillators at fixed inharmonic
    // ratios summed together, then aggressively band/high-pass filtered. This
    // is the same trick the 808 hat/cymbal hardware uses to get its metallic
    // shimmer — far more convincing than plain filtered white noise.
    const RATIOS = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523];
    const baseHz = 540;
    const metalSum = this.context.createGain();
    metalSum.gain.setValueAtTime(0.18, now);
    const oscillators = RATIOS.map((ratio) => {
      const osc = this.context.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(baseHz * ratio, now);
      osc.connect(metalSum);
      return osc;
    });

    // Band-pass to carve the body, then high-pass to keep only the bright
    // sizzle. Tone knob tilts the whole metallic band.
    const toneShift = (shape.tone - 0.5) * 3000;
    const bandpass = this.context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(9000 + toneShift, now);
    bandpass.Q.setValueAtTime(0.6, now);
    const highpass = this.context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(7000 + toneShift * 0.5, now);

    // Two-stage envelope: a short bright "ping" stacked over a long ring-out,
    // the hallmark of the 808 open cymbal. Decay knob stretches the ring.
    const cymbalGain = this.context.createGain();
    const ring = Math.max(0.3, 1.2 * shape.decay);
    const peak = Math.max(0.0002, Math.min(0.05, amount * 0.07));
    cymbalGain.gain.setValueAtTime(0.0001, now);
    cymbalGain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    cymbalGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.32), now + 0.12);
    cymbalGain.gain.exponentialRampToValueAtTime(0.0001, now + ring);

    metalSum.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(cymbalGain);
    const nodes = [metalSum, bandpass, highpass, cymbalGain, ...oscillators];
    // Cymbal shares the "metal" choke group with the hat (808 open/closed circuit).
    if (shape.choke) this.choke808Group("metal", cymbalGain, now);
    this.connectTrackOutput(cymbalGain, track, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(cymbalGain, track, options, nodes);
    oscillators.forEach((osc) => {
      osc.start(now);
      osc.stop(now + ring + 0.05);
    });
    this.scheduleVoiceCleanup(oscillators, nodes);
  }
};
