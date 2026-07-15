// Unit tests for transport seek/start behavior. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "../src/ui/transport.js";

class FakeEngine {
  constructor() {
    this.playing = false;
    this.context = { currentTime: 0 };
    this.startCalls = [];
    this.seekCalls = [];
    this.configCalls = 0;
    this.step = 0;
    this.phraseBar = 0;
  }

  on() { return () => {}; }

  setConfig() { this.configCalls += 1; }

  async start(options = {}) {
    this.startCalls.push(options);
    if (this.startGate) await this.startGate;
    this.playing = true;
    this.step = options.step ?? 0;
    this.phraseBar = options.phraseBar ?? 0;
  }

  stop() { this.playing = false; }

  seekToPhraseBar(bar, step = 0) {
    this.seekCalls.push({ bar, step });
    this.phraseBar = bar;
    this.step = step;
  }

  getPlaybackState() {
    return {
      playing: this.playing,
      step: this.step,
      phraseBar: this.phraseBar,
      activeBarIntensity: 0
    };
  }

  update() {}
}

function fakeClassList() {
  const classes = new Set();
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    toggle: (item, force) => {
      const next = force ?? !classes.has(item);
      if (next) classes.add(item);
      else classes.delete(item);
      return next;
    },
    contains: (item) => classes.has(item)
  };
}

function fakeElement() {
  return {
    textContent: "",
    scrollLeft: 0,
    scrollWidth: 1000,
    clientWidth: 400,
    style: { setProperty() {} },
    classList: fakeClassList(),
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, right: 400, top: 0, bottom: 200, width: 400, height: 200 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollTo({ left }) { this.scrollLeft = left; }
  };
}

function withFakeWindow(t) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
}

function createHarness(t, { playing = false, stateOverrides = {}, renderStepGrid = () => {}, selectStep = () => {} } = {}) {
  withFakeWindow(t);
  const engine = new FakeEngine();
  engine.playing = playing;
  const elements = new Map([
    ["#play-toggle", fakeElement()],
    ["#transport-position", fakeElement()]
  ]);
  const state = {
    engine,
    playing,
    activeBar: 0,
    playheadStep: 0,
    cameraPlayheadBar: 0,
    cameraPlayheadStep: 0,
    pausedPlayback: null,
    loopBeatRange: null,
    loopBar: false,
    loopBarIndex: 0,
    loopBarLength: 0,
    selectedBars: [],
    selected: null,
    config: {
      patterns: {
        jazz: {
          bars: [{}, {}, {}, {}]
        }
      }
    },
    segmentsCount: 2,
    renderedSegmentsCount: 2,
    cameraMode: true,
    cameraFollow: false,
    uiTimer: null,
    ...stateOverrides
  };
  const stepGrid = fakeElement();
  const barTabs = fakeElement();
  const transport = createTransport({
    $: (selector) => elements.get(selector) ?? null,
    state,
    setStatus: () => {},
    runningFromFile: false,
    stepGrid,
    barTabs,
    RhythmEngine: FakeEngine,
    barLabel: (bar) => `Bar ${bar + 1}`,
    loopRangeLabel: () => "",
    activeLoopLength: () => state.loopBarLength,
    clampLoopStart: (start = 0) => start,
    previewConfig: () => state.config,
    refreshLoopBarButton: () => {},
    reapplyTrackSamples: () => {},
    syncActiveLoopToBar: () => {},
    buildLoopTabs: () => {},
    buildBarTabs: () => {},
    renderStepGrid,
    renderCameraPlayheadHits: () => {},
    clearCameraPlayheadHits: () => {},
    updatePlaybackTabHighlights: () => {},
    selectStep,
    soundingStepForRow: (_hit, step) => step,
    getHitData: () => ({ velocity: 0 }),
    syncSelectedPitchDisplay: () => {}
  });
  return { transport, engine, state, elements };
}

test("playFromBar starts at the requested bar without a second seek when stopped", async (t) => {
  const { transport, engine } = createHarness(t);
  await transport.playFromBar(0);
  assert.equal(engine.startCalls.length, 1);
  assert.equal(engine.startCalls[0].phraseBar, 0);
  assert.equal(engine.startCalls[0].step, 0);
  assert.deepEqual(engine.seekCalls, []);
});

test("loopFromBar starts directly at the loop start when stopped", async (t) => {
  const { transport, engine } = createHarness(t);
  await transport.loopFromBar(1, 1);
  assert.equal(engine.startCalls.length, 1);
  assert.equal(engine.startCalls[0].phraseBar, 1);
  assert.equal(engine.startCalls[0].step, 0);
  assert.deepEqual(engine.seekCalls, []);
});

test("playFromBar seeks only once while playback is already running", async (t) => {
  const { transport, engine } = createHarness(t, { playing: true });
  await transport.playFromBar(2);
  assert.deepEqual(engine.startCalls, []);
  assert.deepEqual(engine.seekCalls, [{ bar: 2, step: 0 }]);
});

test("selected loop primes the next start instead of seeking a stopped engine", (t) => {
  const { transport, engine, state } = createHarness(t);
  state.selectedBars = [1, 2];
  transport.toggleSelectedLoop();
  assert.deepEqual(engine.seekCalls, []);
  assert.deepEqual(state.pausedPlayback, { bar: 1, step: 0 });
});

test("restart while playing replaces the engine and starts from the beginning", async (t) => {
  const { transport, engine, state } = createHarness(t, { playing: true });
  engine.playing = true;
  state.activeBar = 2;
  transport.restartPlayback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(engine.playing, false);
  assert.notEqual(state.engine, engine);
  assert.equal(state.playing, true);
  assert.equal(state.engine.startCalls.length, 1);
  assert.equal(state.engine.startCalls[0].phraseBar, 0);
  assert.equal(state.engine.startCalls[0].step, 0);
});

test("restart while stopped primes the next play from the beginning", async (t) => {
  const { transport, state } = createHarness(t);
  state.activeBar = 2;
  transport.restartPlayback();
  assert.equal(state.playing, false);
  assert.deepEqual(state.pausedPlayback, { bar: 0, step: 0 });
  await transport.startPlayback();
  assert.equal(state.engine.startCalls.length, 1);
  assert.equal(state.engine.startCalls[0].phraseBar, 0);
  assert.equal(state.engine.startCalls[0].step, 0);
});

test("stop during async startup prevents stale play state from reactivating", async (t) => {
  const { transport, engine, state } = createHarness(t);
  let releaseStart = () => {};
  engine.startGate = new Promise((resolve) => { releaseStart = resolve; });
  const starting = transport.startPlayback();
  await Promise.resolve();
  transport.stopPlayback();
  assert.equal(state.playing, false);
  releaseStart();
  await starting;
  assert.equal(state.playing, false);
  assert.equal(engine.playing, false);
});

test("selected row playback updates without rebuilding the whole grid", async (t) => {
  let gridRenders = 0;
  const selectCalls = [];
  const { transport, state } = createHarness(t, {
    stateOverrides: {
      cameraMode: false,
      selected: { hit: "kick", step: 0, mode: "row", bar: 0 },
      pausedPlayback: { bar: 0, step: 1 }
    },
    renderStepGrid: () => { gridRenders += 1; },
    selectStep: (...args) => { selectCalls.push(args); }
  });

  await transport.startPlayback();

  assert.equal(state.playing, true);
  assert.equal(gridRenders, 0);
  assert.equal(selectCalls.length, 1);
  assert.equal(selectCalls[0][0], "kick");
  assert.equal(selectCalls[0][2], "row");
  assert.deepEqual(selectCalls[0][6], { deferTrackPanels: true });
});
