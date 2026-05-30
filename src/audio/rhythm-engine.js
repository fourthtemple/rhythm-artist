import {
  DEFAULT_RHYTHM_CONFIG,
  DEFAULT_TRACK_BUS_SENDS,
  DEFAULT_TRACK_REVERB_SENDS,
  DUCK_SOUND_REARM_SECONDS,
  EDITABLE_GENERATED_ROWS,
  PHRASE_BARS,
  SECTION_BARS,
  STEP_OPTION_DEFAULTS,
  STYLE_ORDER,
  SYNTH_ROOT_HZ,
  SYNTH_SCALE,
  clamp01,
  finiteNumber,
  normalizeRhythmConfig,
  normalizeStepOptions,
  phraseBeatModeForBar,
  sequencedBassPitchForStep,
  shiftedAccentStepsForBar
} from "./rhythm-config.js";
import {
  arrangementHitScale,
  phraseVelocityScale,
  rhythmicShiftScale
} from "./rhythm-arrangement.js";
import { RhythmEventEmitter } from "./rhythm-events.js";

export {
  DEFAULT_RHYTHM_CONFIG,
  RHYTHM_STYLE_OPTIONS,
  generatedSynthEventsForStep,
  normalizeRhythmConfig,
  normalizeSequencedRhythmConfig,
  sequencedBassPitchForStep
} from "./rhythm-config.js";

const DRUM_KIT = {
  kick: new URL("../assets/audio/drums/kick.wav", import.meta.url).href,
  snare: new URL("../assets/audio/drums/snare.wav", import.meta.url).href,
  hat: new URL("../assets/audio/drums/hat.wav", import.meta.url).href,
  rim: new URL("../assets/audio/drums/rim.wav", import.meta.url).href,
  scratch: new URL("../assets/audio/drums/scratch.wav", import.meta.url).href
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
    this.buffers = new Map();
    this.noiseBuffer = null;
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

  async start({
    style = this.style,
    volume = this.volume,
    phraseBar = 0,
    step = 0
  } = {}) {
    this.setStyle(style);
    this.volume = volume;
    await this.ensureContext();
    await this.loadKit();
    await this.context.resume();
    if (this.playing) {
      this.setVolume(volume);
      return;
    }
    this.playing = true;
    this.nextStep = this.resolveStepIndex(step);
    this.barIndex = this.resolveBarIndexForPhrase(phraseBar);
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
    this.masterGain.connect(this.context.destination);
  }

  applyAudioSettings() {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (this.drumBus) this.drumBus.gain.setTargetAtTime(this.config.drumBusGain, now, 0.04);
    if (this.fxSend) this.fxSend.gain.setTargetAtTime(this.config.fxSendBase, now, 0.04);
    if (this.delayFeedback) this.delayFeedback.gain.setTargetAtTime(this.config.delayFeedbackBase, now, 0.06);
    if (this.echoWetGain) this.echoWetGain.gain.setTargetAtTime(this.config.echoWetBase, now, 0.06);
    if (this.reverbWetGain) this.reverbWetGain.gain.setTargetAtTime(this.config.reverbWetBase, now, 0.08);
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
      bpm: this.currentBpm(),
      style: patternStyle,
      intensity: this.intensity
    };
    this.events.emit("beat", beatPayload);
    if (step === 0) {
      this.events.emit("bar", beatPayload);
      if (phraseBar === 0) this.events.emit("phrase", beatPayload);
    }
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
      if (hit === "bass") return;
      if (EDITABLE_GENERATED_ROWS.includes(hit)) return;
      if (!this.trackIsAudible(hit)) return;
      hits.forEach(([hitStep, velocity, optionsRaw]) => {
        if (hitStep !== step) return;
        const options = normalizeStepOptions(optionsRaw);
        const human = (Math.random() * 2 - 1) * this.config.humanizeSeconds;
        const lift = this.config.drumLift;
        const rate = this.playbackRateFor(hit, patternStyle);
        const phraseLift = editableGeneratedRows ? 1 : phraseVelocityScale(hit, step, phraseBar);
        const shiftLift = editableGeneratedRows ? 1 : rhythmicShiftScale(hit, step, phraseBar);
        const arrangementLift = editableGeneratedRows ? 1 : arrangementHitScale(hit, step, phraseBar);
        if (phraseLift <= 0 || shiftLift <= 0 || arrangementLift <= 0) return;
        const layeredGain = velocity * lift * phraseLift * shiftLift * arrangementLift;
        const hitTime = scheduledTime + human + options.offsetMs / 1000;
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

  exportConfig() {
    return cloneRhythmConfig(this.config);
  }

  getPlaybackState() {
    return {
      playing: this.playing,
      step: this.nextStep,
      barIndex: this.barIndex,
      phraseBar: this.phraseBarIndex(),
      intensity: this.intensity,
      activeBarIntensity: this.activeBarIntensity
    };
  }

  seekToPhraseBar(phraseBar = 0, step = 0) {
    const nextBar = this.resolveBarIndexForPhrase(phraseBar);
    const nextStep = this.resolveStepIndex(step);
    this.barIndex = nextBar;
    this.segmentStartBar = 0;
    this.nextStep = nextStep;
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
    return this.phraseBarIndex() % SECTION_BARS === 0;
  }

  playTransitionScratch(time, previousStyle, nextStyle) {
    if (!this.buffers.has("scratch")) return;
    const upshift = STYLE_ORDER.indexOf(nextStyle) > STYLE_ORDER.indexOf(previousStyle);
    const scratchTime = Math.max(this.context.currentTime, time - 0.055);
    this.playHit("scratch", scratchTime, upshift ? 0.24 : 0.18, upshift ? 1.08 : 0.92);
  }

  currentBpm(style = this.activePatternStyle, intensity = this.intensity) {
    const base = this.patterns[style]?.bpm ?? 140;
    return base + clamp01(intensity) * 6;
  }

  stepDurationSeconds(style = this.activePatternStyle, intensity = this.intensity) {
    return 60 / this.currentBpm(style, intensity) / 4;
  }

  swingIntensity() {
    return 1;
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
    return soloTracks.length === 0 || soloTracks.includes(track);
  }

  trackBusSend(track) {
    return clamp01(this.config.trackBusSends?.[track] ?? DEFAULT_TRACK_BUS_SENDS[track] ?? 0);
  }

  trackReverbSend(track) {
    return clamp01(this.config.trackReverbSends?.[track] ?? DEFAULT_TRACK_REVERB_SENDS[track] ?? 0);
  }

  connectSend(source, destination, amount) {
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
  }

  connectTrackBus(source, track, options = {}) {
    const dubEcho = clamp01(options.dubEcho);
    this.connectSend(source, this.fxSend, this.trackBusSend(track) + clamp01(options.delaySend) + dubEcho * 0.74);
    this.connectSend(source, this.reverbSend, this.trackReverbSend(track) + clamp01(options.reverbSend) + dubEcho * 0.22);
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
    const accentSteps = shiftedAccentStepsForBar(phraseBar);
    if (!accentSteps.includes(step)) return;
    const localBuild = phraseBar % SECTION_BARS;
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
    const localBuild = phraseBar % SECTION_BARS;
    const stepDuration = this.activeStepDurationSeconds || 0.12;
    const mode = phraseBeatModeForBar(phraseBar);
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

  generatedRowsAreEditable() {
    return this.config.generatedRowsEditable >= 0.5;
  }

  editableSpaceMutesDrums(bar, step) {
    const hits = Array.isArray(bar?.space) ? bar.space : [];
    return hits.some(([hitStep, velocity, optionsRaw]) => {
      if (hitStep !== step || velocity <= 0.001) return false;
      return optionsRaw?.muteDrums === true;
    });
  }

  scheduleEditableGeneratedRows(bar, step, time, phraseBar, style) {
    const pressure = clamp01(this.activeBarIntensity);
    const stepDuration = this.activeStepDurationSeconds || this.stepDurationSeconds(style, pressure);
    EDITABLE_GENERATED_ROWS.forEach((track) => {
      if (!this.trackIsAudible(track)) return;
      const hits = Array.isArray(bar?.[track]) ? bar[track] : [];
      hits.forEach(([hitStep, velocity, optionsRaw]) => {
        if (hitStep !== step || velocity <= 0.001) return;
        const options = normalizeStepOptions(optionsRaw);
        const hitTime = time + options.offsetMs / 1000 + Math.max(0, options.delayMs / 1000);
        const frequency = this.synthFrequency(options.pitch, 1);
        const gain = clamp01(velocity);
        if (track === "pluck") {
          this.playPluckSynth(hitTime, frequency, {
            gain,
            duration: stepDuration * 1.85,
            pan: Math.sin((phraseBar * 4 + step) * 0.74) * 0.5,
            wobble: options.wobble,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (track === "funk") {
          this.playFunkSynth(hitTime + stepDuration * (step % 2 ? 0.12 : 0), frequency, {
            gain,
            duration: stepDuration * 1.35,
            pan: Math.sin((phraseBar * 8 + step) * 0.46) * 0.38,
            bite: 0.45 + pressure * 0.5,
            wobble: options.wobble,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (track === "pad") {
          this.playPadSynth(hitTime, [
            this.synthFrequency(options.pitch, 1),
            this.synthFrequency(options.pitch + 2, 1),
            this.synthFrequency(options.pitch + 4, 1)
          ], {
            gain,
            duration: stepDuration * 32,
            style,
            wobble: options.wobble,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (track === "whale") {
          this.playWhaleSynth(hitTime, {
            gain,
            duration: stepDuration * 8,
            style,
            bend: options.pitch < 0 ? -0.55 : 0.55,
            pan: Math.sin((phraseBar + step) * 0.7) * 0.42,
            delaySend: options.delaySend,
            reverbSend: options.reverbSend,
            dubEcho: options.dubEcho
          });
        } else if (track === "eightOhEightKick") {
          this.play808Kick(hitTime, Math.max(gain * this.config.eightOhEightLevel, this.config.eightOhEightLevel * 0.08), options.pitch, track, options);
        } else if (track === "eightOhEightSnare") {
          this.play808Snare(hitTime, gain * this.config.eightOhEightLevel * 0.82, track, options);
        } else if (track === "eightOhEightHat") {
          this.play808Hat(hitTime, gain * this.config.eightOhEightLevel * 0.52, track, options);
        } else if (track === "eightOhEightClick") {
          this.play808Click(hitTime, gain * this.config.eightOhEightLevel * 0.42, track, options);
        } else if (track === "echo") {
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
        } else if (track === "space") {
          if (options.pitch < 0) this.playSpaceDrop(hitTime, style, { force: true, drumAccent: false });
          else if (options.pitch > 0) this.playSpacePickup(hitTime, style, { force: true, drumAccent: false });
          else this.playNeutralSpaceSound(hitTime, style, { gain, dubEcho: options.dubEcho });
        }
        const dubEcho = clamp01(options.dubEcho);
        if ((options.delaySend > 0.001 || dubEcho > 0.001) && track !== "echo" && track !== "space") {
          this.pushDubFx(hitTime, Math.max(options.delaySend, dubEcho) * 0.62, { sustainSeconds: 0.35 + dubEcho * 1.8 });
        }
      });
    });
  }

  scheduleSynthStep(step, time, style, phraseBar) {
    if (this.generatedRowsAreEditable()) return;
    const pressure = clamp01(this.activeBarIntensity);
    const section = Math.floor(phraseBar / SECTION_BARS);
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
      if (hitStep !== step) return;
      const options = normalizeStepOptions(optionsRaw);
      const noteIndex = sequencedBassPitchForStep({ phraseBar, hitIndex, step });
      this.playBassSynth(time + options.offsetMs / 1000, this.synthFrequency(noteIndex, 0) * 2 ** (options.pitch / 12), {
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
    const section = Math.floor(phraseBar / SECTION_BARS);
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
    const section = Math.floor(phraseBar / SECTION_BARS);
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
    const sectionStart = phraseBar % SECTION_BARS === 0;
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
        frequency: this.synthFrequency([12, 15, 10, 17][Math.floor(phraseBar / SECTION_BARS) % 4], 1),
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
    const buffer = this.buffers.get(hit);
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
    hitGain.connect(this.drumBus || this.masterGain);
    this.connectTrackBus(hitGain, hit, options);
    source.start(Math.max(this.context.currentTime, time));
  }

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
  }

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
    kickGain.connect(this.drumBus || this.masterGain);
    this.connectTrackBus(kickGain, track, options);
    oscillator.start(now);
    body.start(now);
    oscillator.stop(now + 0.82);
    body.stop(now + 0.82);
  }

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
    noiseGain.connect(this.drumBus || this.masterGain);
    toneGain.connect(this.drumBus || this.masterGain);
    this.connectTrackBus(noiseGain, track, options);
    noise.start(now);
    tone.start(now);
    noise.stop(now + 0.18);
    tone.stop(now + 0.14);
  }

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
    hatGain.connect(this.drumBus || this.masterGain);
    this.connectTrackBus(hatGain, track, options);
    noise.start(now);
    noise.stop(now + 0.07);
  }

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
    clickGain.connect(this.drumBus || this.masterGain);
    this.connectTrackBus(clickGain, track, options);
    noise.start(now);
    noise.stop(now + 0.04);
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
    }
  }

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
    bassGain.connect(this.masterGain);
    accent.connect(accentGain);
    accentGain.connect(this.masterGain);
    this.connectTrackBus(bassGain, "bass", { delaySend, reverbSend, dubEcho });
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
  }

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
    pluckGain.connect(this.masterGain);
    this.connectTrackBus(pluckGain, "pluck", { delaySend, reverbSend, dubEcho });
    oscillator.start(now);
    if (lfo) lfo.start(now);
    oscillator.stop(now + safeDuration + 0.02);
    if (lfo) lfo.stop(now + safeDuration + 0.02);
  }

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
    funkGain.connect(this.masterGain);
    this.connectTrackBus(funkGain, "funk", { delaySend, reverbSend, dubEcho });
    oscillator.start(now);
    if (lfo) lfo.start(now);
    oscillator.stop(now + safeDuration + 0.03);
    if (lfo) lfo.stop(now + safeDuration + 0.03);
  }

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
    if (this.fxSend) {
      this.connectTrackBus(pingGain, "echo", { delaySend, reverbSend, dubEcho });
    } else {
      pingGain.connect(this.masterGain);
    }
    oscillator.start(now);
    oscillator.stop(now + safeDuration + 0.03);
  }

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
    });
    filter.connect(padGain);
    padGain.connect(this.masterGain);
    this.connectTrackBus(padGain, "pad", { delaySend, reverbSend, dubEcho });
    if (lfo) {
      lfo.start(now);
      lfo.stop(now + safeDuration + 0.04);
    }
  }

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
  }

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
    voiceGain.connect(this.masterGain);
    this.connectTrackBus(voiceGain, "whale", { delaySend, reverbSend, dubEcho });
    oscillator.start(now);
    second.start(now);
    lfo.start(now);
    oscillator.stop(now + safeDuration + 0.05);
    second.stop(now + safeDuration + 0.05);
    lfo.stop(now + safeDuration + 0.05);
  }

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
    this.connectTrackBus(hitGain, hit);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
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
