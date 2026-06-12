import {
  DEFAULT_RHYTHM_CONFIG,
  DEFAULT_TRACK_BUS_SENDS,
  DEFAULT_TRACK_REVERB_SENDS,
  DEFAULT_TRACK_LEVELS,
  DEFAULT_TRACK_PANS,
  DEFAULT_TRACK_STEPS_PER_BAR,
  DUCK_SOUND_REARM_SECONDS,
  EDITABLE_GENERATED_ROWS,
  PHRASE_BARS,
  SECTION_BARS,
  STYLE_ORDER,
  SYNTH_ROOT_HZ,
  SYNTH_SCALE,
  clamp01,
  finiteNumber,
  effectiveStepOptionsForTrack,
  metronomeBeatEventsForStep,
  normalizeRhythmConfig,
  normalizeSectionBars,
  phraseBeatModeForBar,
  sequencedBassPitchForStep,
  shiftedAccentStepsForBar,
  baseTrackId,
  isInstanceId,
  voiceForTrack
} from "./rhythm-config.js";
import {
  arrangementHitScale,
  phraseVelocityScale,
  rhythmicShiftScale
} from "./rhythm-arrangement.js";
import { RhythmEventEmitter } from "./rhythm-events.js";
import { EightOhEightVoices } from "./rhythm-engine-808.js";
import { SynthVoices } from "./rhythm-engine-synth.js";
import { MasteringChain } from "./rhythm-mastering.js";

export {
  DEFAULT_RHYTHM_CONFIG,
  RHYTHM_STYLE_OPTIONS,
  generatedSynthEventsForStep,
  normalizeRhythmConfig,
  normalizeSequencedRhythmConfig,
  sequencedBassPitchForStep
} from "./rhythm-config.js";

const DRUM_KIT = {
  kick: new URL("../../assets/audio/drums/kick.wav", import.meta.url).href,
  snare: new URL("../../assets/audio/drums/snare.wav", import.meta.url).href,
  hat: new URL("../../assets/audio/drums/hat.wav", import.meta.url).href,
  rim: new URL("../../assets/audio/drums/rim.wav", import.meta.url).href,
  scratch: new URL("../../assets/audio/drums/scratch.wav", import.meta.url).href
};

export class RhythmEngine {
  constructor({
    kit = DRUM_KIT,
    style = "jazz",
    volume = 0.48,
    config = DEFAULT_RHYTHM_CONFIG,
    lookaheadMs = 25,
    scheduleAheadSeconds = 0.16
  } = {}) {
    this.kit = kit;
    this.style = style;
    this.volume = volume;
    this.config = normalizeRhythmConfig(config);
    this.patterns = this.config.patterns;
    this.lookaheadMs = lookaheadMs;
    this.scheduleAheadSeconds = scheduleAheadSeconds;
    this.context = null;
    this.masterGain = null;
    this.drumBus = null;
    this.drumFilter = null;
    this.drumDrive = null;
    this.drumCompressor = null;
    this.fxSend = null;
    this.reverbSend = null;
    this.delayNode = null;
    this.delayFeedback = null;
    this.echoWetGain = null;
    this.reverbNode = null;
    this.reverbWetGain = null;
    // Master mastering chain (multi-band EQ + spectrum analyser). Lazily built
    // in ensureContext() and exposed via getMasteringChain() for the UI.
    this.mastering = null;
    this.buffers = new Map();
    this.noiseBuffer = null;
    // User-assigned custom samples, keyed by track id. When present, they
    // override the built-in voice for that track in `playHit`.
    this.customSampleBuffers = new Map();
    this.customSampleUrls = new Map();
    this.loadingPromise = null;
    this.timer = null;
    this.playing = false;
    this.nextStep = 0;
    this.nextStepTime = 0;
    this.barIndex = 0;
    this.segmentStartBar = 0;
    this.forceSegmentChange = false;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.activePatternStyle = this.resolvePatternStyle(style, 0);
    this.queuedPatternStyle = this.activePatternStyle;
    this.activeBarIntensity = 0;
    this.activeStepDurationSeconds = this.stepDurationSeconds(this.activePatternStyle, 0);
    this.spaceBreak = null;
    this.lastSpaceBreakBar = -999;
    this.lastWhaleBar = -999;
    this.lastPadSection = -999;
    this.lastDownbeatEchoBar = -999;
    this.duckEchoNextTime = 0;
    this.duckAccentArmed = true;
    this.duckReleasedAt = 0;
    this.lastDucking = false;
    this.lastBossLanded = false;
    // ── Event emitter (game API hooks) ──────────────────────────
    this.events = new RhythmEventEmitter();
  }

  /** Subscribe to a sequencer event. Returns an unsubscribe function.
   * @param {"beat"|"bar"|"phrase"|"section"|"play"|"stop"|"config"} event
   * @param {Function} handler
   * @returns {() => void}
   */
  on(event, handler) { return this.events.on(event, handler); }
  /** Subscribe once. */
  once(event, handler) { return this.events.once(event, handler); }
  /** Unsubscribe. */
  off(event, handler) { this.events.off(event, handler); }

  async resumeContext(timeoutMs = 180) {
    if (!this.context || this.context.state === "running") return;
    const resume = this.context.resume().catch((error) => {
      console.warn("Audio context resume failed", error);
    });
    await Promise.race([
      resume,
      new Promise((resolve) => globalThis.setTimeout(resolve, timeoutMs))
    ]);
  }

  async start({
    style = this.style,
    volume = this.volume,
    phraseBar = 0,
    step = 0
  } = {}) {
    this.setStyle(style);
    this.volume = volume;
    await this.ensureContext();
    await this.resumeContext();
    await this.loadKit();
    if (this.playing) {
      this.setVolume(volume);
      return;
    }
    this.playing = true;
    this.nextStep = this.resolveStepIndex(step);
    this.barIndex = this.resolveBarIndexForPhrase(phraseBar);
    ({ bar: this.barIndex, step: this.nextStep } = this.wrapStepIntoLoopRange(this.barIndex, this.nextStep));
    this.segmentStartBar = 0;
    this.forceSegmentChange = false;
    this.activePatternStyle = this.resolvePatternStyle(this.style, this.intensity);
    this.queuedPatternStyle = this.activePatternStyle;
    this.activeBarIntensity = this.intensity;
    this.activeStepDurationSeconds = this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    this.spaceBreak = null;
    this.lastSpaceBreakBar = -999;
    this.lastWhaleBar = -999;
    this.lastPadSection = -999;
    this.lastDownbeatEchoBar = -999;
    this.duckEchoNextTime = 0;
    this.duckAccentArmed = true;
    this.duckReleasedAt = 0;
    this.lastDucking = false;
    this.lastBossLanded = false;
    this.nextStepTime = this.context.currentTime + 0.08;
    this.setVolume(volume, { immediate: true });
    this.timer = window.setInterval(() => this.scheduler(), this.lookaheadMs);
    this.events.emit("play", this.getPlaybackState());
    this.scheduler();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.duckEchoNextTime = 0;
    this.duckAccentArmed = true;
    this.duckReleasedAt = 0;
    this.lastDucking = false;
    this.lastBossLanded = false;
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0, now, 0.08);
    }
    this.events.emit("stop", this.getPlaybackState());
  }

  setStyle(style) {
    const nextStyle = this.patterns[style] ? style : "jazz";
    const changed = nextStyle !== this.style;
    this.style = nextStyle;
    if (changed && this.playing) this.forceSegmentChange = true;
    this.queuePatternStyle(this.resolvePatternStyle(this.style, this.targetIntensity || this.intensity));
  }

  setVolume(volume, { immediate = false } = {}) {
    this.volume = Math.max(0, Math.min(1, finiteNumber(volume, 0)));
    if (!this.masterGain || !this.context) return;
    const now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    if (immediate) this.masterGain.gain.setValueAtTime(this.volume, now);
    else this.masterGain.gain.setTargetAtTime(this.volume, now, 0.08);
  }

  update({
    enabled = true,
    style = this.style,
    moving = false,
    ducking = false,
    duckResetReady = !ducking,
    airborne = false,
    danger = 0,
    progress = 0,
    bossLanded = false
  } = {}) {
    if (!enabled) {
      this.stop();
      return;
    }
    this.setStyle(style);
    const movement = moving ? 0.25 : 0;
    const jumpEnergy = airborne ? 0.12 : 0;
    const dangerEnergy = clamp01(danger) * 0.34;
    const progressEnergy = clamp01(progress) * 0.28;
    const landedEnergy = bossLanded ? 0.18 : 0;
    this.targetIntensity = Math.max(0.08, Math.min(1, movement + jumpEnergy + dangerEnergy + progressEnergy + landedEnergy));
    this.queuePatternStyle(this.resolvePatternStyle(this.style, this.targetIntensity));
    this.updateDuckAccentLatch(ducking, duckResetReady);
    this.updateDuckHoldEcho(ducking);
    if (bossLanded && !this.lastBossLanded) {
      this.accentBossLanded();
    }
    this.lastDucking = ducking;
    this.lastBossLanded = bossLanded;
  }

  updateDuckAccentLatch(ducking, duckResetReady = !ducking) {
    if (!this.playing || !this.context) return;
    const now = this.context.currentTime;
    if (ducking) {
      this.duckReleasedAt = 0;
      if (this.duckAccentArmed) {
        this.accentDuck();
        this.duckAccentArmed = false;
      }
      return;
    }
    if (!duckResetReady) {
      this.duckReleasedAt = 0;
      return;
    }
    if (!this.duckAccentArmed && !this.duckReleasedAt) {
      this.duckReleasedAt = now;
    }
    if (!this.duckAccentArmed && this.duckReleasedAt && now - this.duckReleasedAt >= DUCK_SOUND_REARM_SECONDS) {
      this.duckAccentArmed = true;
      this.duckReleasedAt = 0;
    }
  }

  accent(hit, gain = 0.5, delaySeconds = 0) {
    if (!this.playing || !this.context) return;
    this.playHit(hit, this.context.currentTime + delaySeconds, gain, 1);
  }

  accentDuck(gain = this.config.duckWhaleAmount) {
    if (!this.playing || !this.context) return;
    this.accentWhale(gain, 0.025, {
      duration: 1.1,
      bend: 0.72,
      pan: 0.28
    });
  }

  updateDuckHoldEcho(ducking) {
    if (!this.playing || !this.context) return;
    if (!ducking) {
      this.duckEchoNextTime = 0;
      return;
    }
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    const now = this.context.currentTime;
    if (!this.lastDucking || !this.duckEchoNextTime) {
      this.duckEchoNextTime = now + stepDuration * 2.35;
      return;
    }
    let safety = 0;
    while (this.duckEchoNextTime <= now + 0.04 && safety < 3) {
      this.playDuckHoldEcho(this.duckEchoNextTime, this.config.duckWhaleAmount);
      this.duckEchoNextTime += stepDuration * 4;
      safety += 1;
    }
  }

  playDuckHoldEcho(time, gain = this.config.duckWhaleAmount) {
    if (!this.playing || !this.context) return;
    const amount = Math.max(0, Math.min(1.5, finiteNumber(gain, this.config.duckWhaleAmount))) / 1.5;
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    this.pushFx(time, 0.2 + amount * 0.32);
    this.playWhaleSynth(time + 0.018, {
      gain: 0.04 + amount * 0.075,
      duration: stepDuration * 4.8,
      style: this.activePatternStyle,
      bend: 0.72,
      pan: 0.28
    });
  }

  previewDuckHold(durationSeconds = 2.15) {
    if (!this.playing || !this.context) return;
    this.accentDuck();
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    const startTime = this.context.currentTime + stepDuration * 2.35;
    const endTime = this.context.currentTime + Math.max(0.6, durationSeconds);
    for (let time = startTime; time < endTime; time += stepDuration * 4) {
      this.playDuckHoldEcho(time, this.config.duckWhaleAmount);
    }
  }

  accentBossLanded() {
    if (!this.playing || !this.context) return;
    this.accent("snare", 0.78);
    this.accent("rim", 0.52, 0.055);
    this.accent("scratch", 0.18, 0.11);
    this.accentWhale(0.72, 0.04);
  }

  accentImpact(gain = this.config.hitImpactAmount) {
    if (!this.playing || !this.context) return;
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    const hitTime = this.nextQuantizedStepTime([0, 4, 8, 12], 0.035);
    this.pushDubFx(hitTime, 0.52 + clamp01(gain) * 0.48);
    this.playHit("rim", hitTime, gain, 0.92);
    this.playHit("snare", hitTime + stepDuration * 0.04, gain * 0.36, 0.9);
    this.playFxHit("rim", hitTime + stepDuration * 0.08, gain * 0.54, 0.86, {
      taps: 5,
      spacing: stepDuration * 3
    });
    this.playEchoPingSynth(hitTime + stepDuration * 0.16, {
      gain: 0.035 + clamp01(gain) * 0.045,
      duration: stepDuration * 6,
      frequency: this.synthFrequency(15, 1),
      pan: 0.34
    });
  }

  previewWobble() {
    if (!this.playing || !this.context) return;
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    this.playFunkSynth(this.context.currentTime + 0.035, this.synthFrequency(10, 1), {
      gain: 0.085,
      duration: stepDuration * 3.2,
      pan: 0.22,
      bite: 0.95
    });
  }

  previewEchoPing() {
    if (!this.playing || !this.context) return;
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    this.pushFx(this.context.currentTime + 0.02, 0.46);
    this.playEchoPingSynth(this.context.currentTime + 0.035, {
      gain: 0.065,
      duration: stepDuration * 6,
      frequency: this.synthFrequency(15, 1),
      pan: 0.28
    });
  }

  previewWhaleBend(bend = -0.65) {
    if (!this.playing || !this.context) return;
    this.accentWhale(0.86, 0.02, {
      duration: 1.1,
      bend,
      pan: bend < 0 ? -0.28 : 0.28
    });
  }

  previewSpaceDrop() {
    if (!this.playing || !this.context) return;
    this.playSpaceDrop(this.context.currentTime + 0.025, this.activePatternStyle);
  }

  previewSpacePickup() {
    if (!this.playing || !this.context) return;
    this.playSpacePickup(this.context.currentTime + 0.025, this.activePatternStyle);
  }

  nextQuantizedStepTime(preferredSteps = [0, 4, 8, 12], minDelaySeconds = 0.035) {
    if (!this.context) return 0;
    const now = this.context.currentTime;
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    const minTime = now + minDelaySeconds;
    let gridTime = this.nextStepTime || minTime;
    let gridStep = this.nextStep || 0;
    while (gridTime - stepDuration >= minTime) {
      gridTime -= stepDuration;
      gridStep = (gridStep + 15) % 16;
    }
    const preferred = new Set(preferredSteps.map((step) => ((Math.round(step) % 16) + 16) % 16));
    for (let offset = 0; offset < 32; offset += 1) {
      const candidateStep = (gridStep + offset) % 16;
      const candidateTime = gridTime + stepDuration * offset;
      if (candidateTime >= minTime && preferred.has(candidateStep)) {
        return candidateTime;
      }
    }
    return Math.max(minTime, gridTime);
  }

  accentWhale(gain = 0.5, delaySeconds = 0, {
    duration = 1.1,
    bend = 1,
    pan = 0
  } = {}) {
    if (!this.playing || !this.context) return;
    this.playWhaleSynth(this.context.currentTime + delaySeconds, {
      gain,
      duration,
      style: this.activePatternStyle,
      bend,
      pan
    });
  }

  async ensureContext() {
    if (this.context) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextCtor();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0;
    this.drumBus = this.context.createGain();
    this.drumFilter = this.context.createBiquadFilter();
    this.drumDrive = this.context.createWaveShaper();
    this.drumCompressor = this.context.createDynamicsCompressor();
    this.fxSend = this.context.createGain();
    this.reverbSend = this.context.createGain();
    this.delayNode = this.context.createDelay(2.5);
    this.delayFeedback = this.context.createGain();
    this.delayFilter = this.context.createBiquadFilter();
    this.echoWetGain = this.context.createGain();
    this.reverbNode = this.context.createConvolver();
    this.reverbWetGain = this.context.createGain();
    this.drumFilter.type = "highshelf";
    this.drumFilter.frequency.value = 5200;
    this.drumFilter.gain.value = -1.1;
    this.drumDrive.curve = this.createDriveCurve(0.45);
    this.drumDrive.oversample = "2x";
    this.drumCompressor.threshold.value = -13;
    this.drumCompressor.knee.value = 26;
    this.drumCompressor.ratio.value = 1.8;
    this.drumCompressor.attack.value = 0.016;
    this.drumCompressor.release.value = 0.26;
    this.delayNode.delayTime.value = 0.32;
    this.delayFilter.type = "lowpass";
    this.delayFilter.frequency.value = 1900;
    this.reverbNode.buffer = this.createReverbImpulse(1.85, 3.1);
    this.applyAudioSettings();
    this.drumBus.connect(this.drumFilter);
    this.drumFilter.connect(this.drumDrive);
    this.drumDrive.connect(this.drumCompressor);
    this.drumCompressor.connect(this.masterGain);
    this.fxSend.connect(this.delayNode);
    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.echoWetGain);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.reverbSend.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbWetGain);
    this.echoWetGain.connect(this.masterGain);
    this.reverbWetGain.connect(this.masterGain);
    // Master bus → mastering EQ + spectrum analyser → speakers.
    this.mastering = new MasteringChain(this.context, this.config.masterEq);
    this.masterGain.connect(this.mastering.input);
    this.mastering.output.connect(this.context.destination);
  }

  /** Expose the mastering chain (analyser + EQ) for the editor's spectrum UI. */
  getMasteringChain() {
    return this.mastering;
  }

  applyAudioSettings() {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (this.drumBus) this.drumBus.gain.setTargetAtTime(this.config.drumBusGain, now, 0.04);
    if (this.fxSend) this.fxSend.gain.setTargetAtTime(this.config.fxSendBase, now, 0.04);
    if (this.delayFeedback) this.delayFeedback.gain.setTargetAtTime(this.config.delayFeedbackBase, now, 0.06);
    if (this.echoWetGain) this.echoWetGain.gain.setTargetAtTime(this.config.echoWetBase, now, 0.06);
    if (this.reverbWetGain) this.reverbWetGain.gain.setTargetAtTime(this.config.reverbWetBase, now, 0.08);
    if (this.mastering) this.mastering.setEq(this.config.masterEq);
  }

  async loadKit() {
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = Promise.all(Object.entries(this.kit).map(async ([name, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load drum hit: ${name}`);
      const data = await response.arrayBuffer();
      const buffer = await this.context.decodeAudioData(data);
      this.buffers.set(name, buffer);
    })).catch((error) => {
      console.warn("Drum kit failed to load; rhythm engine will use synth fallbacks", error);
    });
    return this.loadingPromise;
  }

  /** True when the track has a user-assigned custom sample loaded. */
  hasCustomSample(track) {
    return this.customSampleBuffers.has(track);
  }

  /**
   * Assign (or replace) a user-selected sample for a track. The buffer is
   * decoded once and cached; subsequent `playHit(track, …)` calls use it
   * instead of the built-in voice. Pass `null`/empty url to clear.
   * @param {string} track registry track id
   * @param {string|null} url fetchable audio url (for example, a bundled asset URL)
   */
  async setTrackSample(track, url) {
    if (!track) return false;
    if (!url) {
      this.clearTrackSample(track);
      return true;
    }
    await this.ensureContext();
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Sample fetch failed: ${response.status}`);
      const data = await response.arrayBuffer();
      const buffer = await this.context.decodeAudioData(data);
      this.customSampleBuffers.set(track, buffer);
      this.customSampleUrls.set(track, url);
      return true;
    } catch (error) {
      console.warn(`Failed to load custom sample for ${track}`, error);
      return false;
    }
  }

  /** Remove a track's custom sample, reverting to the built-in voice. */
  clearTrackSample(track) {
    this.customSampleBuffers.delete(track);
    this.customSampleUrls.delete(track);
  }

  /** The url of a track's custom sample, or null. */
  trackSampleUrl(track) {
    return this.customSampleUrls.get(track) || null;
  }

  /**
   * Audition a track once, right now: plays its custom sample if assigned,
   * otherwise triggers the built-in voice via the generated-row dispatcher.
   */
  async auditionTrack(track, { gain = 0.6 } = {}) {
    await this.ensureContext();
    await this.resumeContext();
    await this.loadKit();
    if (this.masterGain) this.setVolume(Math.max(this.volume, 0.5), { immediate: true });
    const time = this.context.currentTime + 0.02;
    if (this.hasCustomSample(track)) {
      this.playHit(track, time, gain, 1, {});
      return;
    }
    this.previewTrackVoice(track, time, gain);
  }

  /**
   * Audition the selected track as an instrument voice. Synth tracks use their
   * melodic oscillator path; sample and sampler tracks pitch the loaded buffer.
   */
  async auditionPitchedTrack(track, pitch = 0, { gain = 0.6, pressure = 0 } = {}) {
    if (!track) return;
    await this.ensureContext();
    await this.resumeContext();
    await this.loadKit();
    if (this.masterGain) this.setVolume(Math.max(this.volume, 0.5), { immediate: true });
    const time = this.context.currentTime + 0.012;
    const semitones = Number.isFinite(Number(pitch)) ? Number(pitch) : 0;
    const force = clamp01(pressure);
    const voiceGain = Math.max(0.001, Number.isFinite(Number(gain)) ? Number(gain) : 0.6);
    const base = baseTrackId(track);
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds("jazz", 0.4);
    const frequency = SYNTH_ROOT_HZ * 2 ** (semitones / 12);
    const options = {
      pitch: semitones,
      pressure: force,
      delaySend: force * 0.08,
      reverbSend: base === "pad" ? 0.18 : 0.08,
      wobble: force * 0.18
    };
    switch (base) {
      case "bass":
        this.playBassSynth(time, frequency, { track, gain: voiceGain * 0.9, duration: 0.48 + force * 0.25, style: "jazz" });
        break;
      case "pluck":
        this.playPluckSynth(time, frequency, { track, gain: voiceGain, duration: 0.42 + force * 0.34, ...options });
        break;
      case "funk":
        this.playFunkSynth(time, frequency, {
          track,
          gain: voiceGain,
          duration: 0.42 + force * 0.28,
          bite: 0.55 + force * 0.3,
          ...options
        });
        break;
      case "pad":
        this.playPadSynth(time, [frequency], { track, gain: voiceGain * 0.72, duration: 0.7 + force * 0.45, style: "jazz", ...options });
        break;
      case "whale":
        this.playWhaleSynth(time, {
          track,
          gain: voiceGain,
          duration: stepDuration * 6,
          style: "jazz",
          bend: semitones < 0 ? -0.55 : 0.55,
          delaySend: options.delaySend,
          reverbSend: options.reverbSend,
          dubEcho: 0
        });
        break;
      case "eightOhEightKick":
        this.play808Kick(time, Math.max(voiceGain * this.config.eightOhEightLevel, this.config.eightOhEightLevel * 0.08), semitones, track, options);
        break;
      case "eightOhEightSnare":
        this.play808Snare(time, voiceGain * this.config.eightOhEightLevel * 0.82, track, options);
        break;
      case "eightOhEightHat":
        this.play808Hat(time, voiceGain * this.config.eightOhEightLevel * 0.52, track, options);
        break;
      case "eightOhEightClick":
        this.play808Click(time, voiceGain * this.config.eightOhEightLevel * 0.42, track, options);
        break;
      case "eightOhEightClap":
        this.play808Clap(time, voiceGain * this.config.eightOhEightLevel * 0.7, track, options);
        break;
      case "eightOhEightTomLow":
        this.play808Tom(time, voiceGain * this.config.eightOhEightLevel * 0.72, semitones - 7, track, options);
        break;
      case "eightOhEightTomMid":
        this.play808Tom(time, voiceGain * this.config.eightOhEightLevel * 0.72, semitones, track, options);
        break;
      case "eightOhEightTomHigh":
        this.play808Tom(time, voiceGain * this.config.eightOhEightLevel * 0.72, semitones + 7, track, options);
        break;
      case "eightOhEightCowbell":
        this.play808Cowbell(time, voiceGain * this.config.eightOhEightLevel * 0.6, track, options);
        break;
      case "eightOhEightConga":
        this.play808Conga(time, voiceGain * this.config.eightOhEightLevel * 0.7, semitones, track, options);
        break;
      case "eightOhEightMaraca":
        this.play808Maraca(time, voiceGain * this.config.eightOhEightLevel * 0.5, track, options);
        break;
      case "eightOhEightCymbal":
        this.play808Cymbal(time, voiceGain * this.config.eightOhEightLevel * 0.55, track, options);
        break;
      case "echo":
        this.playEchoPingSynth(time + 0.01, {
          gain: voiceGain,
          duration: stepDuration * 4,
          frequency,
          delaySend: options.delaySend,
          reverbSend: options.reverbSend,
          dubEcho: force * 0.35
        });
        break;
      case "space":
        if (semitones < 0) this.playSpaceDrop(time, "jazz", { force: true, drumAccent: false });
        else if (semitones > 0) this.playSpacePickup(time, "jazz", { force: true, drumAccent: false });
        else this.playNeutralSpaceSound(time, "jazz", { gain: voiceGain, dubEcho: force * 0.2 });
        break;
      default: {
        const rate = Math.pow(2, semitones / 12);
        this.playHit(track, time, voiceGain, rate, options);
        break;
      }
    }
  }

  /** Trigger a single hit of a track's built-in voice (no custom sample). */
  previewTrackVoice(track, time, gain = 0.6) {
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds("jazz", 0.4);
    const freq = this.synthFrequency(0, 1);
    const base = baseTrackId(track);
    switch (base) {
      case "bass": this.playBassSynth(time, freq, { track, gain, duration: 0.42, style: "jazz" }); break;
      case "kick": case "snare": case "hat": case "rim": this.playHit(track, time, gain, 1, {}); break;
      case "pluck": this.playPluckSynth(time, freq, { track, gain, duration: stepDuration * 1.85 }); break;
      case "funk": this.playFunkSynth(time, freq, { track, gain, duration: stepDuration * 1.35, bite: 0.6 }); break;
      case "pad": this.playPadSynth(time, [freq, this.synthFrequency(2, 1), this.synthFrequency(4, 1)], { track, gain, duration: stepDuration * 8, style: "jazz" }); break;
      case "whale": this.playWhaleSynth(time, { track, gain, duration: stepDuration * 6, style: "jazz", bend: 0.55 }); break;
      case "eightOhEightKick": this.play808Kick(time, gain * this.config.eightOhEightLevel, 0, track, {}); break;
      case "eightOhEightSnare": this.play808Snare(time, gain * this.config.eightOhEightLevel * 0.82, track, {}); break;
      case "eightOhEightHat": this.play808Hat(time, gain * this.config.eightOhEightLevel * 0.52, track, {}); break;
      case "eightOhEightClick": this.play808Click(time, gain * this.config.eightOhEightLevel * 0.42, track, {}); break;
      case "eightOhEightClap": this.play808Clap(time, gain * this.config.eightOhEightLevel * 0.7, track, {}); break;
      case "eightOhEightTomLow": this.play808Tom(time, gain * this.config.eightOhEightLevel * 0.72, -7, track, {}); break;
      case "eightOhEightTomMid": this.play808Tom(time, gain * this.config.eightOhEightLevel * 0.72, 0, track, {}); break;
      case "eightOhEightTomHigh": this.play808Tom(time, gain * this.config.eightOhEightLevel * 0.72, 7, track, {}); break;
      case "eightOhEightCowbell": this.play808Cowbell(time, gain * this.config.eightOhEightLevel * 0.6, track, {}); break;
      case "eightOhEightConga": this.play808Conga(time, gain * this.config.eightOhEightLevel * 0.7, 0, track, {}); break;
      case "eightOhEightMaraca": this.play808Maraca(time, gain * this.config.eightOhEightLevel * 0.5, track, {}); break;
      case "eightOhEightCymbal": this.play808Cymbal(time, gain * this.config.eightOhEightLevel * 0.55, track, {}); break;
      case "echo": this.playEchoPingSynth(time + 0.01, { gain, duration: stepDuration * 4, frequency: this.synthFrequency(12, 1) }); break;
      case "space": this.playNeutralSpaceSound(time, "jazz", { gain }); break;
      case "sampler": this.playHit(track, time, gain, 1, {}); break;
      default: this.playHit(track, time, gain, 1, {}); break;
    }
  }

  scheduler() {
    if (!this.playing || !this.context) return;
    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    this.queuePatternStyle(this.resolvePatternStyle(this.style, this.intensity));
    while (this.nextStepTime < this.context.currentTime + this.scheduleAheadSeconds) {
      this.scheduleStep(this.nextStep, this.nextStepTime);
      this.advanceStep();
    }
  }

  scheduleStep(step, time) {
    if (step === 0) {
      this.applyQueuedPatternStyle(time);
    }
    const patternStyle = this.activePatternStyle;
    const pattern = this.patterns[patternStyle];
    const bar = pattern.bars[this.barIndex % pattern.bars.length];
    const phraseBar = this.phraseBarIndex();
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(patternStyle, this.activeBarIntensity);
    const swingDelay = step % 2 === 1 ? stepDuration * pattern.swing * this.swingIntensity() : 0;
    const scheduledTime = time + swingDelay;

    // ── Emit timeline events for game API consumers ────────────
    const beatPayload = {
      step,
      bar: this.barIndex,
      phraseBar,
      time,
      scheduledTime,
      stepDuration,
      bpm: this.currentBpm(),
      style: patternStyle,
      intensity: this.intensity
    };
    this.events.emit("beat", beatPayload);
    if (step === 0) {
      this.events.emit("bar", beatPayload);
      if (phraseBar === 0) this.events.emit("phrase", beatPayload);
    }
    this.scheduleMetronomeStep(step, time, stepDuration);
    // ──────────────────────────────────────────────────────────

    const editableGeneratedRows = this.generatedRowsAreEditable();
    if (step === 0) {
      if (editableGeneratedRows) {
        this.spaceBreak = null;
      } else {
        this.prepareSpaceBreakForBar(patternStyle);
        this.playDownbeatEcho(scheduledTime, phraseBar);
        this.scheduleSectionPad(scheduledTime, patternStyle, phraseBar);
        this.scheduleWhaleLayer(scheduledTime, patternStyle);
      }
    }
    if (!editableGeneratedRows) {
      this.scheduleShiftedBeatEcho(step, scheduledTime, phraseBar);
    }
    this.scheduleSynthStep(step, scheduledTime, patternStyle, phraseBar);
    if (editableGeneratedRows) {
      this.scheduleEditableGeneratedRows(bar, step, scheduledTime, phraseBar, patternStyle);
    }
    if (!editableGeneratedRows && this.isSpaceBreakStart(step)) {
      this.playSpaceDrop(scheduledTime, patternStyle);
    }
    if (!editableGeneratedRows && this.isSpaceBreakPickup(step)) {
      this.playSpacePickup(scheduledTime, patternStyle);
    }
    if (this.isDrumMutedForSpace(step) || (editableGeneratedRows && this.editableSpaceMutesDrums(bar, step))) return;
    this.scheduleSequencedBassStep(bar, step, scheduledTime, phraseBar, patternStyle);
    Object.entries(bar).forEach(([hit, hits]) => {
      if (baseTrackId(hit) === "bass") return;
      if (EDITABLE_GENERATED_ROWS.includes(baseTrackId(hit))) return;
      if (!this.trackIsAudible(hit)) return;
      hits.forEach(([hitStep, velocity, optionsRaw]) => {
        const timing = this.hitTimingForSchedulerStep(hitStep, step, stepDuration);
        if (!timing) return;
        const options = effectiveStepOptionsForTrack(this.config, hit, optionsRaw);
        const human = (Math.random() * 2 - 1) * this.config.humanizeSeconds;
        const lift = this.config.drumLift;
        const rate = this.playbackRateFor(hit, patternStyle);
        const phraseLift = editableGeneratedRows ? 1 : phraseVelocityScale(hit, step, phraseBar);
        const shiftLift = editableGeneratedRows ? 1 : rhythmicShiftScale(hit, step, phraseBar, this.sectionBars());
        const arrangementLift = editableGeneratedRows ? 1 : arrangementHitScale(hit, step, phraseBar);
        if (phraseLift <= 0 || shiftLift <= 0 || arrangementLift <= 0) return;
        const layeredGain = velocity * lift * phraseLift * shiftLift * arrangementLift;
        const hitTime = scheduledTime + timing.offsetSeconds + human + options.offsetMs / 1000;
        this.playHit(hit, hitTime, this.drumGain(layeredGain), rate, options);
        if (!editableGeneratedRows) {
          this.play808Overlay(hit, hitTime, layeredGain);
        }
        const dubEcho = clamp01(options.dubEcho);
        const echoAmount = Math.max(options.delaySend, dubEcho);
        if (echoAmount > 0.001) {
          const delaySeconds = Math.max(
            0.02,
            options.delayMs / 1000 || stepDuration * (dubEcho > 0 ? 1.45 + dubEcho * 2.4 : 2)
          );
          this.pushDubFx(hitTime, echoAmount * 0.58, { sustainSeconds: 0.35 + dubEcho * 1.8 });
          this.playDubDelayTaps(hit, hitTime + delaySeconds, this.drumGain(layeredGain) * echoAmount * 0.42, rate, {
            taps: 3 + Math.round(options.delaySend * 3 + dubEcho * 5),
            spacing: delaySeconds
          });
        }
      });
    });
    if (!editableGeneratedRows) {
      this.scheduleBuildDrumVariation(step, scheduledTime, phraseBar, patternStyle);
    }
  }

  advanceStep() {
    const style = this.activePatternStyle;
    this.nextStep += 1;
    if (this.nextStep >= 16) {
      this.nextStep = 0;
      this.barIndex += 1;
    }
    ({ bar: this.barIndex, step: this.nextStep } = this.wrapStepIntoLoopRange(this.barIndex, this.nextStep));
    this.nextStepTime += this.activeStepDurationSeconds || this.stepDurationSeconds(style, this.activeBarIntensity);
  }

  resolvePatternStyle(style = this.style, intensity = this.intensity) {
    return "jazz";
  }

  queuePatternStyle(style) {
    if (!this.patterns[style]) return;
    this.queuedPatternStyle = style;
  }

  setConfig(config = {}) {
    this.config = normalizeRhythmConfig(config);
    this.patterns = this.config.patterns;
    this.applyAudioSettings();
    this.queuePatternStyle("jazz");
    this.events.emit("config", { config: this.config });
  }

  /** Live-set one master EQ band (dB) without a full config pass — for dragging. */
  setMasterEqBand(bandId, gainDb) {
    if (this.config.masterEq) this.config.masterEq[bandId] = gainDb;
    if (this.mastering) this.mastering.setBand(bandId, gainDb);
  }

  exportConfig() {
    return cloneRhythmConfig(this.config);
  }

  getPlaybackState() {
    return {
      playing: this.playing,
      step: this.nextStep,
      barIndex: this.barIndex,
      phraseBar: this.phraseBarIndex(),
      nextStepTime: this.nextStepTime,
      stepDuration: this.activeStepDurationSeconds,
      contextTime: this.context?.currentTime ?? 0,
      intensity: this.intensity,
      activeBarIntensity: this.activeBarIntensity
    };
  }

  seekToPhraseBar(phraseBar = 0, step = 0) {
    const nextBar = this.resolveBarIndexForPhrase(phraseBar);
    const nextStep = this.resolveStepIndex(step);
    ({ bar: this.barIndex, step: this.nextStep } = this.wrapStepIntoLoopRange(nextBar, nextStep));
    this.segmentStartBar = 0;
    this.spaceBreak = null;
    this.lastSpaceBreakBar = -999;
    this.lastWhaleBar = -999;
    this.lastPadSection = -999;
    this.lastDownbeatEchoBar = -999;
    this.activeBarIntensity = this.intensity;
    this.activeStepDurationSeconds = this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    if (this.context) {
      this.nextStepTime = this.context.currentTime + 0.035;
    }
  }

  resolveBarIndexForPhrase(phraseBar = 0) {
    const requested = Math.round(finiteNumber(phraseBar, 0));
    if (this.loopStepRange()) {
      const pattern = this.patterns[this.activePatternStyle] || this.patterns.jazz;
      const barCount = Math.max(1, pattern?.bars?.length || PHRASE_BARS);
      return ((requested % barCount) + barCount) % barCount;
    }
    if (Number.isFinite(this.config.loopPhraseBarStart) && finiteNumber(this.config.loopPhraseBarLength, 0) > 0) {
      const loopLength = Math.max(1, Math.round(finiteNumber(this.config.loopPhraseBarLength, 1)));
      const loopStart = Math.max(0, Math.round(finiteNumber(this.config.loopPhraseBarStart, 0)));
      return ((requested - loopStart) % loopLength + loopLength) % loopLength;
    }
    const pattern = this.patterns[this.activePatternStyle] || this.patterns.jazz;
    const barCount = Math.max(1, pattern?.bars?.length || PHRASE_BARS);
    return ((requested % barCount) + barCount) % barCount;
  }

  resolveStepIndex(step = 0) {
    const requested = Math.round(finiteNumber(step, 0));
    return ((requested % 16) + 16) % 16;
  }

  loopStepRange() {
    const startRaw = Number(this.config.loopPhraseStepStart);
    const lengthRaw = finiteNumber(this.config.loopPhraseStepLength, 0);
    if (!Number.isFinite(startRaw) || lengthRaw <= 0) return null;
    const pattern = this.patterns[this.activePatternStyle] || this.patterns.jazz;
    const totalSteps = Math.max(1, (pattern?.bars?.length || PHRASE_BARS) * 16);
    const start = Math.max(0, Math.min(totalSteps - 1, Math.round(startRaw)));
    const length = Math.max(1, Math.min(totalSteps - start, Math.round(lengthRaw)));
    return { start, end: start + length, length };
  }

  wrapStepIntoLoopRange(bar, step) {
    const range = this.loopStepRange();
    const safeBar = Math.max(0, Math.round(finiteNumber(bar, 0)));
    const safeStep = this.resolveStepIndex(step);
    if (!range) return { bar: safeBar, step: safeStep };
    const requested = safeBar * 16 + safeStep;
    const wrapped = requested < range.start || requested >= range.end ? range.start : requested;
    return {
      bar: Math.floor(wrapped / 16),
      step: wrapped % 16
    };
  }

  triggerDubThrow() {
    if (!this.playing || !this.context) return;
    this.playSpaceDrop(this.context.currentTime, this.activePatternStyle);
  }

  applyQueuedPatternStyle(time) {
    const previous = this.activePatternStyle;
    const next = this.queuedPatternStyle || previous;
    const forcedSegmentChange = this.forceSegmentChange;
    const canChangeSection = forcedSegmentChange || this.isSectionStart();
    if (next !== previous && canChangeSection) {
      this.activePatternStyle = next;
      this.playTransitionScratch(time, previous, this.activePatternStyle);
      if (forcedSegmentChange) this.segmentStartBar = this.barIndex;
      this.events.emit("section", { from: previous, to: this.activePatternStyle, bar: this.barIndex, time });
    } else if (forcedSegmentChange) {
      this.segmentStartBar = this.barIndex;
    }
    this.forceSegmentChange = false;
    if (canChangeSection) {
      this.activeBarIntensity = this.intensity;
      this.activeStepDurationSeconds = this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
      this.updateTempoFx(time);
    }
  }

  phraseBarIndex() {
    if (this.loopStepRange()) {
      const pattern = this.patterns[this.activePatternStyle] || this.patterns.jazz;
      const barCount = Math.max(1, pattern?.bars?.length || PHRASE_BARS);
      return ((this.barIndex % barCount) + barCount) % barCount;
    }
    if (Number.isFinite(this.config.loopPhraseBarStart) && finiteNumber(this.config.loopPhraseBarLength, 0) > 0) {
      const loopLength = Math.max(1, Math.round(finiteNumber(this.config.loopPhraseBarLength, 1)));
      const loopStart = Math.max(0, Math.round(finiteNumber(this.config.loopPhraseBarStart, 0)));
      return loopStart + (((this.barIndex % loopLength) + loopLength) % loopLength);
    }
    if (Number.isFinite(this.config.loopPhraseBar)) {
      return this.config.loopPhraseBar;
    }
    const offset = this.barIndex - this.segmentStartBar;
    const pattern = this.patterns[this.activePatternStyle] || this.patterns.jazz;
    const barCount = Math.max(1, pattern?.bars?.length || PHRASE_BARS);
    return ((offset % barCount) + barCount) % barCount;
  }

  isSectionStart() {
    return this.phraseBarIndex() % this.sectionBars() === 0;
  }

  playTransitionScratch(time, previousStyle, nextStyle) {
    if (!this.buffers.has("scratch")) return;
    const upshift = STYLE_ORDER.indexOf(nextStyle) > STYLE_ORDER.indexOf(previousStyle);
    const scratchTime = Math.max(this.context.currentTime, time - 0.055);
    this.playHit("scratch", scratchTime, upshift ? 0.24 : 0.18, upshift ? 1.08 : 0.92);
  }

  currentBpm(style = this.activePatternStyle, _intensity = this.intensity) {
    const base = this.patterns[style]?.bpm ?? 140;
    return base;
  }

  stepDurationSeconds(style = this.activePatternStyle, intensity = this.intensity) {
    return 60 / this.currentBpm(style, intensity) / 4;
  }

  swingIntensity() {
    return 1;
  }

  sectionBars() {
    return normalizeSectionBars(this.config.barsPerSection ?? SECTION_BARS);
  }

  scheduleMetronomeStep(step, time, stepDuration = this.activeStepDurationSeconds) {
    if (this.config.metronomeEnabled < 0.5) return;
    const duration = finiteNumber(stepDuration, this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity));
    metronomeBeatEventsForStep(step, DEFAULT_TRACK_STEPS_PER_BAR, this.config.timeSignature)
      .forEach(({ offsetSteps, accent }) => {
        this.playMetronomeClick(time + offsetSteps * duration, accent);
      });
  }

  playMetronomeClick(time, accent = false) {
    if (!this.context || !this.masterGain) return;
    const volume = Math.max(0, Math.min(1, finiteNumber(this.config.metronomeVolume, DEFAULT_RHYTHM_CONFIG.metronomeVolume)));
    if (volume <= 0.001) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const start = Math.max(this.context.currentTime, time);
    const peak = volume * (accent ? 0.32 : 0.19);
    osc.type = "square";
    osc.frequency.setValueAtTime(accent ? 1760 : 1320, start);
    osc.frequency.exponentialRampToValueAtTime(accent ? 1180 : 980, start + 0.045);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + (accent ? 0.075 : 0.048));
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(start);
    osc.stop(start + 0.09);
    osc.onended = () => this.disconnectNodes([osc, gain]);
  }

  hitTimingForSchedulerStep(hitStep, schedulerStep, stepDuration) {
    const position = finiteNumber(hitStep, 0);
    if (position < 0 || position >= 16) return null;
    const baseStep = Math.floor(position);
    if (baseStep !== schedulerStep) return null;
    return {
      position,
      offsetSeconds: Math.max(0, position - schedulerStep) * stepDuration
    };
  }

  playbackRateFor(hit, style) {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.009;
    if (hit === "rim") return jitter * 0.92;
    return jitter;
  }

  drumGain(gain) {
    return Math.max(0, Math.min(this.config.drumGainCap, gain));
  }

  synthGain(gain) {
    return Math.max(0, Math.min(0.6, gain * this.config.synthLevel));
  }

  trackIsAudible(track) {
    const soloTracks = Array.isArray(this.config.soloTracks) ? this.config.soloTracks : [];
    const mutedTracks = Array.isArray(this.config.mutedTracks) ? this.config.mutedTracks : [];
    if (mutedTracks.includes(track)) return false;
    return soloTracks.length === 0 || soloTracks.includes(track);
  }

  /**
   * Every generated (synth/808/sampler/space voice) track id that should be scheduled
   * for this bar: the registry's editable generated rows plus any *instance*
   * tracks the user has added (e.g. extra "808 Clap" instances written as
   * `eightOhEightClap~ab12`). Instances are discovered from the bar's own
   * keys so each added track plays even though it isn't in the static registry
   * row list. Returned ids keep their instance suffix so per-track
   * sends/level/pan/shape routing resolves to the right instance.
   */
  editableGeneratedTrackIds(bar) {
    const ids = [...EDITABLE_GENERATED_ROWS];
    if (bar && typeof bar === "object") {
      const known = new Set(ids);
      Object.keys(bar).forEach((key) => {
        if (known.has(key) || !isInstanceId(key)) return;
        // Only schedule instances whose base voice is a known generated row.
        // Bass is a base pattern row, but bass *instances* are editable synth
        // instrument lanes and should use this generated-row path.
        const base = baseTrackId(key);
        if (EDITABLE_GENERATED_ROWS.includes(base) || base === "bass") {
          ids.push(key);
          known.add(key);
        }
      });
    }
    return ids;
  }

  trackBusSend(track) {
    return clamp01(this.config.trackBusSends?.[track] ?? DEFAULT_TRACK_BUS_SENDS[track] ?? 0);
  }

  trackReverbSend(track) {
    return clamp01(this.config.trackReverbSends?.[track] ?? DEFAULT_TRACK_REVERB_SENDS[track] ?? 0);
  }

  /** Per-track output level / gain trim (0..2, unity = 1). */
  trackLevel(track) {
    const value = this.config.trackLevels?.[track] ?? DEFAULT_TRACK_LEVELS[track] ?? 1;
    return Math.max(0, Math.min(2, finiteNumber(value, 1)));
  }

  /** Per-track stereo pan (-1 left .. 1 right). */
  trackPan(track) {
    const value = this.config.trackPans?.[track] ?? DEFAULT_TRACK_PANS[track] ?? 0;
    return Math.max(-1, Math.min(1, finiteNumber(value, 0)));
  }

  /**
   * Connect a voice's final (dry) gain node to `destination`, inserting a
   * per-track level trim and stereo panner when the track config asks for
   * them. Any nodes created are pushed onto `collector` so the per-voice
   * cleanup releases them. This is the single choke point that applies the
   * per-track Level + Pan config from the inspector.
   */
  connectTrackOutput(source, track, destination, collector = null) {
    if (!this.context || !source || !destination) return;
    let node = source;
    const level = this.trackLevel(track);
    if (Math.abs(level - 1) > 0.001) {
      const trim = this.context.createGain();
      trim.gain.value = level;
      node.connect(trim);
      if (collector) collector.push(trim);
      node = trim;
    }
    const pan = this.trackPan(track);
    if (Math.abs(pan) > 0.001 && typeof this.context.createStereoPanner === "function") {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      node.connect(panner);
      if (collector) collector.push(panner);
      node = panner;
    }
    node.connect(destination);
  }

  connectSend(source, destination, amount, collector = null) {
    if (!this.context || !destination) return;
    const send = clamp01(amount);
    if (send <= 0.001) return;
    if (send >= 0.999) {
      source.connect(destination);
      return;
    }
    const sendGain = this.context.createGain();
    sendGain.gain.value = send;
    source.connect(sendGain);
    sendGain.connect(destination);
    if (collector) collector.push(sendGain);
  }

  connectTrackBus(source, track, options = {}, collector = null) {
    const dubEcho = clamp01(options.dubEcho);
    this.connectSend(source, this.fxSend, this.trackBusSend(track) + clamp01(options.delaySend) + dubEcho * 0.74, collector);
    this.connectSend(source, this.reverbSend, this.trackReverbSend(track) + clamp01(options.reverbSend) + dubEcho * 0.22, collector);
  }

  /**
   * Disconnect a list of Web Audio nodes, ignoring errors from nodes that are
   * already disconnected. Used to release per-voice node chains so the audio
   * graph does not accumulate dead tail nodes (the source of the memory leak).
   */
  disconnectNodes(nodes) {
    if (!nodes) return;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node) continue;
      try {
        node.disconnect();
      } catch (_) {
        /* node was already disconnected */
      }
    }
  }

  /**
   * Schedule cleanup of every node in `nodes` once all of the scheduled source
   * nodes in `sources` have finished playing. Each per-voice helper builds a
   * collector array of every node it creates (including send gains and panners)
   * and passes the longest-lived source(s) here so the whole chain is released
   * on `onended`. This prevents unbounded audio-graph growth over long sessions.
   */
  scheduleVoiceCleanup(sources, nodes) {
    if (!sources || sources.length === 0) {
      // No scheduled source to hang cleanup on; nothing to do.
      return;
    }
    let remaining = sources.length;
    const cleanup = () => this.disconnectNodes(nodes);
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (!source) {
        remaining -= 1;
        continue;
      }
      source.onended = () => {
        remaining -= 1;
        if (remaining <= 0) {
          cleanup();
        }
      };
    }
    if (remaining <= 0) {
      cleanup();
    }
  }

  triggerDubEchoTail(time, amount = 0) {
    const dubEcho = clamp01(amount);
    if (dubEcho <= 0.001) return;
    this.pushDubFx(time, 0.22 + dubEcho * 0.72, { sustainSeconds: 0.34 + dubEcho * 1.95 });
  }

  autoEchoScale(kind = "downbeat") {
    if (this.config.autoEchoEnabled < 0.5) return 0;
    const laneAmount = kind === "accent" ? this.config.accentEchoAmount : this.config.downbeatEchoAmount;
    return clamp01(this.config.autoEchoAmount) * clamp01(laneAmount);
  }

  scheduleShiftedBeatEcho(step, time, phraseBar) {
    if (!this.trackIsAudible("echo")) return;
    const autoScale = this.autoEchoScale("accent");
    if (autoScale <= 0.001) return;
    const pressure = clamp01(this.activeBarIntensity);
    const sectionBars = this.sectionBars();
    const accentSteps = shiftedAccentStepsForBar(phraseBar, sectionBars);
    if (!accentSteps.includes(step)) return;
    const localBuild = phraseBar % sectionBars;
    const primary = step === accentSteps[0];
    const echoGain = ((primary ? 0.015 : 0.012) + pressure * 0.025 + localBuild * 0.002) * autoScale;
    this.playEchoPingSynth(time + 0.01, {
      gain: echoGain,
      duration: (this.activeStepDurationSeconds || 0.12) * (primary ? 3.5 : 2.5),
      frequency: this.synthFrequency(primary ? 12 : 15, 1),
      pan: primary ? -0.18 : 0.22
    });
    if (localBuild >= 6 || pressure > 0.66) {
      this.pushFx(time, (0.2 + pressure * 0.18) * autoScale);
    }
  }

  scheduleBuildDrumVariation(step, time, phraseBar, style) {
    if (!this.trackIsAudible("hat") && !this.trackIsAudible("rim") && !this.trackIsAudible("kick")) return;
    if (phraseBar < 4) return;
    const pressure = clamp01(this.activeBarIntensity);
    const sectionBars = this.sectionBars();
    const localBuild = phraseBar % sectionBars;
    const stepDuration = this.activeStepDurationSeconds || 0.12;
    const mode = phraseBeatModeForBar(phraseBar, sectionBars);
    if (this.isDrumMutedForSpace(step)) return;
    if (this.trackIsAudible("hat") && localBuild === 6 && step === 14) {
      this.playHit("hat", time + stepDuration * 0.5, 0.04 + pressure * 0.02, 1.08);
    }
    if (this.trackIsAudible("rim") && localBuild === 7 && step === 15) {
      this.playHit("rim", time + stepDuration * 0.34, 0.055 + pressure * 0.025, 0.95);
    }
    if (this.trackIsAudible("kick") && mode === "oneTwo" && localBuild >= 4 && step === 4) {
      this.playHit("kick", time + stepDuration * 0.55, 0.05 + pressure * 0.025, 0.98);
    }
  }

  synthFrequency(scaleIndex, octave = 0) {
    const wrapped = ((scaleIndex % SYNTH_SCALE.length) + SYNTH_SCALE.length) % SYNTH_SCALE.length;
    const octaveOffset = Math.floor(scaleIndex / SYNTH_SCALE.length) + octave;
    return SYNTH_ROOT_HZ * 2 ** ((SYNTH_SCALE[wrapped] + octaveOffset * 12) / 12);
  }

  chordFrequenciesForOptions(options, octave = 1) {
    const root = this.synthFrequency(options.pitch, octave);
    const intervals = Array.isArray(options.chordIntervals) && options.chordIntervals.length
      ? options.chordIntervals
      : [0];
    return intervals.map((interval) => root * 2 ** ((Number(interval) || 0) / 12));
  }

  chromaticFrequenciesForOptions(options) {
    const root = SYNTH_ROOT_HZ * 2 ** ((Number(options.pitch) || 0) / 12);
    const intervals = Array.isArray(options.chordIntervals) && options.chordIntervals.length
      ? options.chordIntervals
      : [0];
    return intervals.map((interval) => root * 2 ** ((Number(interval) || 0) / 12));
  }

  generatedRowsAreEditable() {
    return this.config.generatedRowsEditable >= 0.5;
  }

  editableSpaceMutesDrums(bar, step) {
    const hits = Array.isArray(bar?.space) ? bar.space : [];
    return hits.some(([hitStep, velocity, optionsRaw]) => {
      if (!this.hitTimingForSchedulerStep(hitStep, step, 1) || velocity <= 0.001) return false;
      return optionsRaw?.muteDrums === true;
    });
  }

  scheduleEditableGeneratedRows(bar, step, time, phraseBar, style) {
    const pressure = clamp01(this.activeBarIntensity);
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(style, pressure);
    // Iterate the bar's own generated tracks (registry defaults + any instance    // tracks the user added, e.g. multiple "808 Clap" instances written as
    // `eightOhEightClap~ab12`). Each instance resolves to its base voice but
    // keeps its own id for per-track sends/level/pan/shape routing.
    this.editableGeneratedTrackIds(bar).forEach((track) => {
      if (!this.trackIsAudible(track)) return;
      const base = baseTrackId(track);
      const hits = Array.isArray(bar?.[track]) ? bar[track] : [];
      hits.forEach(([hitStep, velocity, optionsRaw]) => {
        const timing = this.hitTimingForSchedulerStep(hitStep, step, stepDuration);
        if (!timing || velocity <= 0.001) return;
        const options = effectiveStepOptionsForTrack(this.config, track, optionsRaw);
        const hitTime = time + timing.offsetSeconds + options.offsetMs / 1000 + Math.max(0, options.delayMs / 1000);
        const chordFrequencies = this.chordFrequenciesForOptions(options, 1);
        const frequency = chordFrequencies[0] || this.synthFrequency(options.pitch, 1);
        const gain = clamp01(velocity);
        const chordGain = gain / Math.sqrt(Math.max(1, chordFrequencies.length));
        if (base === "bass") {
          this.playBassSynth(hitTime, SYNTH_ROOT_HZ * 2 ** (options.pitch / 12), {
            track,
            gain,
            duration: stepDuration * (step % 4 === 0 ? 2.7 : 1.85),
            style,
            attackMs: options.attackMs,
            delayMs: options.delayMs,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (base === "pluck") {
          chordFrequencies.forEach((voiceFrequency, index) => {
            this.playPluckSynth(hitTime + index * 0.006, voiceFrequency, {
              track,
              gain: chordGain,
              duration: stepDuration * 1.85,
              pan: Math.sin((phraseBar * 4 + step + index * 0.6) * 0.74) * 0.5,
              wobble: options.wobble,
              delaySend: options.delaySend,
              reverbSend: options.reverbSend,
              dubEcho: options.dubEcho
            });
          });
        } else if (base === "funk") {
          chordFrequencies.forEach((voiceFrequency, index) => {
            this.playFunkSynth(hitTime + stepDuration * (step % 2 ? 0.12 : 0) + index * 0.004, voiceFrequency, {
              track,
              gain: chordGain,
              duration: stepDuration * 1.35,
              pan: Math.sin((phraseBar * 8 + step + index * 0.7) * 0.46) * 0.38,
              bite: 0.45 + pressure * 0.5,
              wobble: options.wobble,
              delaySend: options.delaySend,
              reverbSend: options.reverbSend,
              dubEcho: options.dubEcho
            });
          });
        } else if (base === "pad") {
          this.playPadSynth(hitTime, chordFrequencies, {
            track,
            gain,
            duration: stepDuration * 32,
            style,
            wobble: options.wobble,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (base === "whale") {
          this.playWhaleSynth(hitTime, {
            track,
            gain,
            duration: stepDuration * 8,
            style,
            bend: options.pitch < 0 ? -0.55 : 0.55,
            pan: Math.sin((phraseBar + step) * 0.7) * 0.42,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (base === "eightOhEightKick") {
          this.play808Kick(hitTime, Math.max(gain * this.config.eightOhEightLevel, this.config.eightOhEightLevel * 0.08), options.pitch, track, options);
        } else if (base === "eightOhEightSnare") {
          this.play808Snare(hitTime, gain * this.config.eightOhEightLevel * 0.82, track, options);
        } else if (base === "eightOhEightHat") {
          this.play808Hat(hitTime, gain * this.config.eightOhEightLevel * 0.52, track, options);
        } else if (base === "eightOhEightClick") {
          this.play808Click(hitTime, gain * this.config.eightOhEightLevel * 0.42, track, options);
        } else if (base === "eightOhEightClap") {
          this.play808Clap(hitTime, gain * this.config.eightOhEightLevel * 0.7, track, options);
        } else if (base === "eightOhEightTomLow") {
          this.play808Tom(hitTime, gain * this.config.eightOhEightLevel * 0.72, options.pitch - 7, track, options);
        } else if (base === "eightOhEightTomMid") {
          this.play808Tom(hitTime, gain * this.config.eightOhEightLevel * 0.72, options.pitch, track, options);
        } else if (base === "eightOhEightTomHigh") {
          this.play808Tom(hitTime, gain * this.config.eightOhEightLevel * 0.72, options.pitch + 7, track, options);
        } else if (base === "eightOhEightCowbell") {
          this.play808Cowbell(hitTime, gain * this.config.eightOhEightLevel * 0.6, track, options);
        } else if (base === "eightOhEightConga") {
          this.play808Conga(hitTime, gain * this.config.eightOhEightLevel * 0.7, options.pitch, track, options);
        } else if (base === "eightOhEightMaraca") {
          this.play808Maraca(hitTime, gain * this.config.eightOhEightLevel * 0.5, track, options);
        } else if (base === "eightOhEightCymbal") {
          this.play808Cymbal(hitTime, gain * this.config.eightOhEightLevel * 0.55, track, options);
        } else if (base === "echo") {
          this.playEchoPingSynth(hitTime + 0.01, {
            gain,
            duration: stepDuration * 4,
            frequency: this.synthFrequency(options.pitch || 12, 1),
            pan: step % 8 === 0 ? -0.18 : 0.22,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
          this.pushDubFx(hitTime, Math.max(gain, options.dubEcho), { sustainSeconds: 0.35 + options.dubEcho * 1.8 });
        } else if (base === "space") {
          if (options.pitch < 0) this.playSpaceDrop(hitTime, style, { force: true, drumAccent: false });
          else if (options.pitch > 0) this.playSpacePickup(hitTime, style, { force: true, drumAccent: false });
          else this.playNeutralSpaceSound(hitTime, style, { gain, dubEcho: options.dubEcho });
        } else if (this.hasCustomSample(track)) {
          // Sampler tracks (and any track with a user sample assigned): play the
          // loaded buffer, pitched by the step's pitch offset (semitones).
          const rate = Math.pow(2, (options.pitch || 0) / 12);
          this.playHit(track, hitTime, this.drumGain(gain), rate, options);
        }
        const dubEcho = clamp01(options.dubEcho);
        if ((options.delaySend > 0.001 || dubEcho > 0.001) && base !== "echo" && base !== "space") {
          this.pushDubFx(hitTime, Math.max(options.delaySend, dubEcho) * 0.62, { sustainSeconds: 0.35 + dubEcho * 1.8 });
        }
      });
    });
  }

  scheduleSynthStep(step, time, style, phraseBar) {
    if (this.generatedRowsAreEditable()) return;
    const pressure = clamp01(this.activeBarIntensity);
    const section = Math.floor(phraseBar / this.sectionBars());
    const bassSteps = this.currentBarHasSequencedBass()
      ? []
      : phraseBar < 2 ? [0] : phraseBar < 4 ? [0, 10] : pressure > 0.62 ? [0, 5, 10, 13] : pressure > 0.34 ? [0, 7, 10] : [0, 10];
    if (this.trackIsAudible("bass") && bassSteps.includes(step)) {
      const noteIndex = [0, 3, 5, 2][(Math.floor(phraseBar / 2) + bassSteps.indexOf(step)) % 4];
      this.playBassSynth(time, this.synthFrequency(noteIndex, 0), {
        gain: 0.075 + pressure * 0.075,
        duration: (this.activeStepDurationSeconds || 0.12) * (step === 0 ? 2.5 : 1.7),
        style
      });
    }
    const pluckSteps = phraseBar < 4
      ? []
      : phraseBar < 8
        ? [11]
        : section >= 2 || pressure > 0.52
      ? [3, 6, 9, 14]
      : [3, 11];
    const pluckOffset = this.config.generatedPluckOffsetMs / 1000;
    if (this.trackIsAudible("pluck") && pluckSteps.includes(step)) {
      const noteIndex = [7, 10, 5, 12][(phraseBar + step) % 4];
      this.playPluckSynth(time + pluckOffset + (step % 2 ? (this.activeStepDurationSeconds || 0.12) * 0.12 : 0), this.synthFrequency(noteIndex, 1), {
        gain: 0.035 + pressure * 0.045,
        duration: (this.activeStepDurationSeconds || 0.12) * 1.85,
        pan: Math.sin((phraseBar * 4 + step) * 0.74) * 0.5
      });
    }
    if (this.trackIsAudible("pluck") && phraseBar >= 8 && pressure > 0.72 && [2, 12].includes(step)) {
      this.playPluckSynth(time + pluckOffset, this.synthFrequency(step === 2 ? 15 : 17, 1), {
        gain: 0.025,
        duration: (this.activeStepDurationSeconds || 0.12) * 1.2,
        pan: step === 2 ? -0.42 : 0.42
      });
    }
    if (this.trackIsAudible("funk")) {
      this.scheduleFunkLineStep(step, time + this.config.generatedFunkOffsetMs / 1000, phraseBar, pressure);
    }
  }

  currentBarHasSequencedBass() {
    const pattern = this.patterns[this.activePatternStyle];
    const bars = pattern?.bars || [];
    const bar = bars[this.barIndex % Math.max(1, bars.length)];
    return Array.isArray(bar?.bass) && bar.bass.length > 0;
  }

  scheduleSequencedBassStep(bar, step, time, phraseBar, style) {
    if (!this.trackIsAudible("bass")) return;
    const bassHits = Array.isArray(bar?.bass) ? bar.bass : [];
    if (!bassHits.length) return;
    const pressure = clamp01(this.activeBarIntensity);
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(style, pressure);
    bassHits.forEach(([hitStep, velocity, optionsRaw], hitIndex) => {
      const timing = this.hitTimingForSchedulerStep(hitStep, step, stepDuration);
      if (!timing) return;
      const options = effectiveStepOptionsForTrack(this.config, "bass", optionsRaw);
      const manualPitch = this.generatedRowsAreEditable();
      const frequency = manualPitch
        ? SYNTH_ROOT_HZ * 2 ** (options.pitch / 12)
        : this.synthFrequency(sequencedBassPitchForStep({ phraseBar, hitIndex, step }), 0) * 2 ** (options.pitch / 12);
      this.playBassSynth(time + timing.offsetSeconds + options.offsetMs / 1000, frequency, {
        gain: (0.08 + pressure * 0.08) * velocity,
        duration: stepDuration * (step % 4 === 0 ? 2.7 : 1.85),
        style,
        attackMs: options.attackMs,
        delayMs: options.delayMs,
        delaySend: options.delaySend,
        reverbSend: options.reverbSend,
        dubEcho: options.dubEcho
      });
    });
  }

  scheduleFunkLineStep(step, time, phraseBar, pressure) {
    if (phraseBar < 6) return;
    const section = Math.floor(phraseBar / this.sectionBars());
    const lowPattern = [4, 11];
    const midPattern = phraseBar % 2 === 0 ? [1, 4, 9, 11] : [3, 6, 10, 14];
    const highPattern = phraseBar % 4 === 3 ? [1, 4, 6, 9, 11, 14] : [1, 5, 8, 11, 14];
    const pattern = pressure > 0.72 ? highPattern : pressure > 0.38 || section >= 2 ? midPattern : lowPattern;
    if (!pattern.includes(step)) return;
    const phraseTurnaround = phraseBar === 7 || phraseBar === 15 || phraseBar === 23 || phraseBar === 31;
    if (phraseTurnaround && step >= 10) return;
    const notePool = [7, 10, 12, 15, 17, 12, 10, 5];
    const noteIndex = notePool[(phraseBar + step + section) % notePool.length];
    const stepDuration = this.activeStepDurationSeconds || 0.12;
    const ghost = step === 1 || step === 14;
    this.playFunkSynth(time + stepDuration * (step % 2 ? 0.18 : 0), this.synthFrequency(noteIndex, 1), {
      gain: (ghost ? 0.018 : 0.03) + pressure * 0.045,
      duration: stepDuration * (ghost ? 0.8 : 1.35),
      pan: Math.sin((phraseBar * 8 + step) * 0.46) * 0.38,
      bite: 0.45 + pressure * 0.5
    });
  }

  scheduleSectionPad(time, style, phraseBar) {
    if (!this.trackIsAudible("pad")) return;
    const section = Math.floor(phraseBar / this.sectionBars());
    if (!this.isSectionStart() || this.lastPadSection === section) return;
    this.lastPadSection = section;
    const pressure = clamp01(this.activeBarIntensity);
    const chordRoot = [0, 3, 5, 2][section % 4];
    const duration = (this.activeStepDurationSeconds || 0.12) * 16 * (pressure > 0.55 ? 3.5 : 2.25);
    this.playPadSynth(time + 0.02 + this.config.generatedPadOffsetMs / 1000, [
      this.synthFrequency(chordRoot, 1),
      this.synthFrequency(chordRoot + 2, 1),
      this.synthFrequency(chordRoot + 4, 1)
    ], {
      gain: 0.032 + pressure * 0.045,
      duration,
      style
    });
  }

  updateTempoFx(time) {
    if (!this.context || !this.delayNode || !this.delayFeedback || !this.echoWetGain || !this.reverbWetGain) return;
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(this.activePatternStyle, this.activeBarIntensity);
    const pressure = clamp01(this.activeBarIntensity);
    const delaySteps = 4;
    const delayTime = Math.max(0.09, Math.min(0.72, stepDuration * delaySteps));
    this.delayNode.delayTime.cancelScheduledValues(time);
    this.delayNode.delayTime.setTargetAtTime(delayTime, time, 0.06);
    this.delayFeedback.gain.cancelScheduledValues(time);
    this.delayFeedback.gain.setTargetAtTime(0.2 + pressure * 0.18, time, 0.1);
    this.echoWetGain.gain.cancelScheduledValues(time);
    this.echoWetGain.gain.setTargetAtTime(0.11 + pressure * 0.16, time, 0.12);
    this.reverbWetGain.gain.cancelScheduledValues(time);
    this.reverbWetGain.gain.setTargetAtTime(0.08 + pressure * 0.14, time, 0.12);
  }

  prepareSpaceBreakForBar(style) {
    const pressure = clamp01(this.activeBarIntensity);
    const phraseBar = this.phraseBarIndex();
    const phraseBreak =
      phraseBar === 15 ||
      phraseBar === 31 ||
      (phraseBar === 23 && pressure > 0.34) ||
      (phraseBar === 7 && pressure > 0.66);
    if (!phraseBreak || this.lastSpaceBreakBar === this.barIndex) {
      this.spaceBreak = null;
      return;
    }
    const shortBreak = phraseBar === 7 || phraseBar === 15;
    this.spaceBreak = {
      barIndex: this.barIndex,
      startStep: shortBreak ? 12 : 8,
      endStep: 15,
      pressure
    };
    this.lastSpaceBreakBar = this.barIndex;
  }

  isCurrentSpaceBreak() {
    return this.spaceBreak?.barIndex === this.barIndex;
  }

  isSpaceBreakStart(step) {
    return this.isCurrentSpaceBreak() && step === this.spaceBreak.startStep;
  }

  isSpaceBreakPickup(step) {
    return this.isCurrentSpaceBreak() && step === this.spaceBreak.endStep;
  }

  isDrumMutedForSpace(step) {
    return this.isCurrentSpaceBreak() && step >= this.spaceBreak.startStep && step < this.spaceBreak.endStep;
  }

  playSpaceDrop(time, style, { force = false, drumAccent = true } = {}) {
    if (!force && !this.trackIsAudible("echo")) return;
    const pressure = clamp01(this.activeBarIntensity);
    const stepDuration = this.activeStepDurationSeconds || 0.12;
    this.pushDubFx(time, this.config.dubThrowAmount + pressure * 0.28);
    if (drumAccent) {
      this.playFxHit("snare", time, 0.22 + pressure * 0.1, 0.86);
      this.playFxHit("rim", time + stepDuration * 1.5, 0.16 + pressure * 0.08, 0.78);
      this.playFxHit("hat", time + stepDuration * 3, 0.09 + pressure * 0.05, 0.72);
      this.playFxHit("scratch", time + stepDuration * 0.25, 0.09 + pressure * 0.08, 0.78);
    }
    const whaleAmount = clamp01(this.config.whaleAutoAmount);
    if (whaleAmount > 0.08) {
      this.playWhaleSynth(time + 0.015, {
        gain: (0.16 + pressure * 0.16) * whaleAmount,
        duration: (this.activeStepDurationSeconds || 0.12) * 8,
        style,
        bend: -0.8,
        pan: 0.36
      });
    }
  }

  playSpacePickup(time, style, { force = false, drumAccent = true } = {}) {
    if (!force && !this.trackIsAudible("echo")) return;
    this.pushFx(time, 0.32);
    if (drumAccent) {
      this.playHit("hat", time, 0.18, 1.22);
      this.playHit("rim", time + (this.activeStepDurationSeconds || 0.12) * 0.48, 0.26, 1.08);
    }
  }

  playNeutralSpaceSound(time, style, { gain = 0.4, dubEcho = 0 } = {}) {
    const amount = clamp01(Math.max(gain, dubEcho));
    const tail = clamp01(dubEcho);
    const stepDuration = this.activeStepDurationSeconds || 0.12;
    this.pushDubFx(time, 0.24 + amount * 0.52, { sustainSeconds: 0.5 + tail * 1.85 });
    this.playFxHit("rim", time + stepDuration * 0.12, 0.08 + amount * 0.16, 0.82, {
      taps: 2 + Math.round(tail * 5),
      spacing: stepDuration * (1.8 + tail * 1.5)
    });
    this.playEchoPingSynth(time + 0.012, {
      gain: 0.026 + amount * 0.05,
      duration: stepDuration * (3.5 + tail * 5),
      frequency: this.synthFrequency(12, 1),
      pan: 0.24,
      delaySend: tail * 0.35,
      reverbSend: tail * 0.18,
      dubEcho: tail
    });
  }

  playDownbeatEcho(time, phraseBar) {
    if (!this.trackIsAudible("echo")) return;
    const autoScale = this.autoEchoScale("downbeat");
    if (autoScale <= 0.001) return;
    if (this.lastDownbeatEchoBar === this.barIndex) return;
    this.lastDownbeatEchoBar = this.barIndex;
    const pressure = clamp01(this.activeBarIntensity);
    const sectionBars = this.sectionBars();
    const sectionStart = phraseBar % sectionBars === 0;
    const phraseStart = phraseBar === 0;
    const turnaround = phraseBar === 8 || phraseBar === 16 || phraseBar === 24 || phraseBar === 31;
    const amount = (phraseStart ? 0.5 : sectionStart || turnaround ? 0.38 : 0.2 + pressure * 0.12) * autoScale;
    this.pushFx(time, amount);
    if (sectionStart || turnaround || pressure > 0.58) {
      const stepDuration = this.activeStepDurationSeconds || 0.12;
      this.playFxHit("rim", time + stepDuration * 0.15, (0.08 + pressure * 0.05) * autoScale, 0.82, {
        taps: sectionStart ? 4 : 3,
        spacing: stepDuration * 3
      });
      this.playEchoPingSynth(time + 0.012, {
        gain: ((sectionStart ? 0.045 : 0.028) + pressure * 0.035) * autoScale,
        duration: (this.activeStepDurationSeconds || 0.12) * (sectionStart ? 6 : 4),
        frequency: this.synthFrequency([12, 15, 10, 17][Math.floor(phraseBar / sectionBars) % 4], 1),
        pan: sectionStart ? -0.22 : 0.28
      });
    }
  }

  pushFx(time, amount = 0.4) {
    if (!this.context || !this.fxSend || !this.echoWetGain || !this.reverbWetGain) return;
    const now = Math.max(this.context.currentTime, time);
    const send = Math.max(0.12, amount);
    this.fxSend.gain.cancelScheduledValues(now);
    this.fxSend.gain.setValueAtTime(send, now);
    this.fxSend.gain.setTargetAtTime(this.config.fxSendBase, now + 0.12, 0.42);
    this.echoWetGain.gain.cancelScheduledValues(now);
    this.echoWetGain.gain.setValueAtTime(0.14 + send * 0.26, now);
    this.echoWetGain.gain.setTargetAtTime(this.config.echoWetBase * 0.56, now + 0.18, 0.65);
    this.reverbWetGain.gain.cancelScheduledValues(now);
    this.reverbWetGain.gain.setValueAtTime(0.13 + send * 0.18, now);
    this.reverbWetGain.gain.setTargetAtTime(this.config.reverbWetBase * 0.67, now + 0.22, 0.8);
  }

  pushDubFx(time, amount = 0.6, { sustainSeconds = 0.35 } = {}) {
    if (!this.context || !this.fxSend || !this.delayFeedback || !this.delayFilter || !this.echoWetGain || !this.reverbWetGain) return;
    const now = Math.max(this.context.currentTime, time);
    const send = Math.max(0.22, amount);
    const sustain = Math.max(0.12, Math.min(2.4, finiteNumber(sustainSeconds, 0.35)));
    this.fxSend.gain.cancelScheduledValues(now);
    this.fxSend.gain.setValueAtTime(send, now);
    this.fxSend.gain.setTargetAtTime(this.config.fxSendBase, now + sustain, 0.65 + sustain * 0.7);
    this.delayFeedback.gain.cancelScheduledValues(now);
    this.delayFeedback.gain.setValueAtTime(this.config.delayFeedbackBase + 0.18 + clamp01(send) * 0.14 + sustain * 0.045, now);
    this.delayFeedback.gain.setTargetAtTime(this.config.delayFeedbackBase, now + sustain, 1 + sustain * 0.85);
    this.delayFilter.frequency.cancelScheduledValues(now);
    this.delayFilter.frequency.setValueAtTime(1150, now);
    this.delayFilter.frequency.setTargetAtTime(1850, now + sustain, 0.8 + sustain * 0.45);
    this.echoWetGain.gain.cancelScheduledValues(now);
    this.echoWetGain.gain.setValueAtTime(0.34 + send * 0.18, now);
    this.echoWetGain.gain.setTargetAtTime(this.config.echoWetBase, now + sustain, 1 + sustain * 0.8);
    this.reverbWetGain.gain.cancelScheduledValues(now);
    this.reverbWetGain.gain.setValueAtTime(0.18 + send * 0.12, now);
    this.reverbWetGain.gain.setTargetAtTime(this.config.reverbWetBase, now + sustain, 1.1 + sustain * 0.7);
  }

  playHit(hit, time, gain = 0.5, playbackRate = 1, options = {}) {
    const buffer = this.customSampleBuffers.get(hit) || this.buffers.get(hit);
    if (!buffer) {
      this.playSynthFallback(hit, time, gain);
      return;
    }
    const source = this.context.createBufferSource();
    const hitGain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    hitGain.gain.value = Math.max(0, gain);
    source.connect(hitGain);
    const nodes = [source, hitGain];
    this.connectTrackOutput(hitGain, hit, this.drumBus || this.masterGain, nodes);
    this.connectTrackBus(hitGain, hit, options, nodes);
    source.start(Math.max(this.context.currentTime, time));
    this.scheduleVoiceCleanup([source], nodes);
  }

  getNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const sampleRate = this.context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate));
    const buffer = this.context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return this.noiseBuffer;
  }

  playFxHit(hit, time, gain = 0.25, playbackRate = 1, {
    taps = 4,
    spacing = (this.activeStepDurationSeconds || 0.12) * 3
  } = {}) {
    if (!this.fxSend || !this.context) return;
    const buffer = this.buffers.get(hit);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    const hitGain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    hitGain.gain.value = Math.max(0, gain);
    source.connect(hitGain);
    hitGain.connect(this.fxSend);
    source.start(Math.max(this.context.currentTime, time));
    this.scheduleVoiceCleanup([source], [source, hitGain]);
    this.playDubDelayTaps(hit, time, gain, playbackRate, { taps, spacing });
  }

  playDubDelayTaps(hit, time, gain = 0.2, playbackRate = 1, {
    taps = 4,
    spacing = (this.activeStepDurationSeconds || 0.12) * 3
  } = {}) {
    if (!this.context || !this.masterGain) return;
    const buffer = this.buffers.get(hit);
    if (!buffer) return;
    const start = Math.max(this.context.currentTime, time);
    const tapCount = Math.max(1, Math.min(6, Math.round(taps)));
    const safeSpacing = Math.max(0.09, spacing);
    for (let index = 1; index <= tapCount; index += 1) {
      const source = this.context.createBufferSource();
      const tapFilter = this.context.createBiquadFilter();
      const tapGain = this.context.createGain();
      const panner = typeof this.context.createStereoPanner === "function"
        ? this.context.createStereoPanner()
        : null;
      const decay = 0.72 ** index;
      const tapTime = start + safeSpacing * index;
      source.buffer = buffer;
      source.playbackRate.value = playbackRate * (1 - index * 0.018);
      tapFilter.type = "lowpass";
      tapFilter.frequency.setValueAtTime(Math.max(520, 1900 - index * 260), tapTime);
      tapFilter.Q.setValueAtTime(1.1, tapTime);
      tapGain.gain.setValueAtTime(Math.max(0.0001, gain * decay * 0.82), tapTime);
      source.connect(tapFilter);
      if (panner) {
        tapFilter.connect(panner);
        panner.pan.setValueAtTime(index % 2 === 0 ? -0.24 : 0.24, tapTime);
        panner.connect(tapGain);
      } else {
        tapFilter.connect(tapGain);
      }
      tapGain.connect(this.masterGain);
      if (this.fxSend && index <= 2) tapGain.connect(this.fxSend);
      source.start(tapTime);
      const tapNodes = [source, tapFilter, tapGain];
      if (panner) tapNodes.push(panner);
      this.scheduleVoiceCleanup([source], tapNodes);
    }
  }

  createReverbImpulse(duration = 1.4, decay = 2.4) {
    const sampleRate = this.context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const impulse = this.context.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const channelData = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const tail = 1 - index / length;
        const noise = Math.random() * 2 - 1;
        channelData[index] = noise * Math.pow(tail, decay) * 0.34;
      }
    }
    return impulse;
  }

  createDriveCurve(amount = 1) {
    const samples = 2048;
    const curve = new Float32Array(samples);
    const drive = Math.max(0.05, amount) * 5.5;
    for (let index = 0; index < samples; index += 1) {
      const x = index * 2 / samples - 1;
      curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }
}

// Mix the 808 drum-machine voices onto the prototype. They live in their own
// module to keep this file focused; see `rhythm-engine-808.js`.
Object.assign(RhythmEngine.prototype, EightOhEightVoices);

// Mix the pitched/melodic synth voices onto the prototype; see
// `rhythm-engine-synth.js`.
Object.assign(RhythmEngine.prototype, SynthVoices);
