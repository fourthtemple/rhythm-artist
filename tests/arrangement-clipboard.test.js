// Unit tests for arrangement context-menu actions. `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { createArrangementClipboard } from "../src/ui/arrangement-clipboard.js";

function makeArrangement({ selectedBars = [] } = {}) {
  const menu = { items: [] };
  const loopCalls = [];
  const removedTracks = [];
  let renderCalls = 0;
  const state = {
    selectedBars: [...selectedBars],
    selectedLoops: [],
    selectedTracks: [],
    activeBar: 0,
    activeLoopIndex: 0,
    barClipboard: null
  };
  const arrangement = createArrangementClipboard({
    $: () => null,
    state,
    clone: (value) => structuredClone(value),
    setStatus: () => {},
    loopBarCount: () => 8,
    maxLoopCount: () => 8,
    bars: () => Array.from({ length: 16 }, () => ({})),
    clampLoopStart: (start = 0) => start,
    activeLoopLength: () => 0,
    loopRangeLabel: () => "",
    loopBarSlice: () => [],
    loopStartBar: () => 0,
    localBarIndex: () => 0,
    clampActiveBar: () => {},
    loopCount: () => 1,
    applyConfig: () => {},
    buildLoopTabs: () => {},
    buildBarTabs: () => {},
    buildStepGrid: () => {},
    renderStepGrid: () => { renderCalls += 1; },
    refreshLoopBarButton: () => {},
    selectStep: () => {},
    playFromBar: () => {},
    loopFromBar: (barIndex, length) => {
      loopCalls.push({ barIndex, length });
    },
    showContextMenu: (_event, items) => {
      menu.items = items;
    },
    resetSelectedPanel: () => {},
    trackName: (hit) => hit,
    removeGridTrack: (hit) => {
      removedTracks.push(hit);
    }
  });
  return { arrangement, loopCalls, menu, removedTracks, state, getRenderCalls: () => renderCalls };
}

test("bar context Loop here loops the selected bar span", () => {
  const { arrangement, loopCalls, menu } = makeArrangement({ selectedBars: [4, 5, 6] });
  arrangement.openBarContextMenu({}, 5);

  const loopItem = menu.items.find((item) => item.label === "Loop selected");
  assert.ok(loopItem);
  loopItem.action();

  assert.deepEqual(loopCalls, [{ barIndex: 4, length: 3 }]);
});

test("bar context Loop here falls back to the clicked bar outside selection", () => {
  const { arrangement, loopCalls, menu } = makeArrangement({ selectedBars: [4, 5, 6] });
  arrangement.openBarContextMenu({}, 9);

  const loopItem = menu.items.find((item) => item.label === "Loop here");
  assert.ok(loopItem);
  loopItem.action();

  assert.deepEqual(loopCalls, [{ barIndex: 9, length: 1 }]);
});

test("bar selection click toggles individual bars", () => {
  const { arrangement, state, getRenderCalls } = makeArrangement();

  arrangement.toggleBarMultiSelect(0, {});
  assert.deepEqual(state.selectedBars, [0]);
  assert.equal(state.barAnchor, 0);
  assert.equal(getRenderCalls(), 1);

  arrangement.toggleBarMultiSelect(0, {});
  assert.deepEqual(state.selectedBars, []);
  assert.equal(state.barAnchor, 0);
  assert.equal(getRenderCalls(), 2);
});

test("bar selection shift-click toggles a range on and off", () => {
  const { arrangement, state } = makeArrangement();

  arrangement.toggleBarMultiSelect(1, {});
  arrangement.toggleBarMultiSelect(4, { shiftKey: true });
  assert.deepEqual(state.selectedBars, [1, 2, 3, 4]);

  arrangement.toggleBarMultiSelect(4, { shiftKey: true });
  assert.deepEqual(state.selectedBars, []);
});

test("bar selection shift-click adds a partially unselected range", () => {
  const { arrangement, state } = makeArrangement({ selectedBars: [1, 3] });
  state.barAnchor = 1;

  arrangement.toggleBarMultiSelect(3, { shiftKey: true });

  assert.deepEqual(state.selectedBars, [1, 2, 3]);
});

test("track context can delete a track from the left label menu", () => {
  const { arrangement, menu, removedTracks } = makeArrangement();
  arrangement.openTrackContextMenu({}, "pluck");

  const deleteItem = menu.items.find((item) => item.label === "Delete pluck");
  assert.ok(deleteItem);
  assert.equal(deleteItem.disabled, undefined);
  deleteItem.action();

  assert.deepEqual(removedTracks, ["pluck"]);
});

test("track context can delete former core tracks from the left label menu", () => {
  const { arrangement, menu, removedTracks } = makeArrangement();
  arrangement.openTrackContextMenu({}, "kick");

  const deleteItem = menu.items.find((item) => item.label === "Delete kick");
  assert.ok(deleteItem);
  assert.equal(deleteItem.disabled, undefined);
  deleteItem.action();

  assert.deepEqual(removedTracks, ["kick"]);
});
