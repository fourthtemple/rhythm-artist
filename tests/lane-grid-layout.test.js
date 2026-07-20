import test from "node:test";
import assert from "node:assert/strict";
import { syncStepGridLaneRows } from "../src/ui/grid/lane-grid-layout.js";

function makeStyle(initial = {}) {
  const props = new Map();
  return {
    ...initial,
    setProperty(name, value) {
      props.set(name, String(value));
    },
    getPropertyValue(name) {
      return props.get(name) || "";
    }
  };
}

function makeLane(row, height, classNames = []) {
  const style = makeStyle({ gridRow: String(row), height: `${height}px`, minHeight: `${height}px` });
  style.setProperty("--lane-height", `${height}px`);
  return {
    classList: {
      contains: (className) => classNames.includes(className)
    },
    style,
    getBoundingClientRect: () => ({ height })
  };
}

function makeCameraGrid(lanes) {
  return {
    classList: {
      contains: (className) => className === "is-camera-canvas"
    },
    style: makeStyle(),
    querySelectorAll: () => lanes
  };
}

test("camera lane row heights shrink when a resizable editor lane shrinks", () => {
  let lane = makeLane(2, 180, ["piano-roll-lane"]);
  const grid = makeCameraGrid([lane]);

  syncStepGridLaneRows(grid);
  assert.equal(grid.style.gridTemplateRows, "20px 180px");

  lane = makeLane(2, 58, ["piano-roll-lane"]);
  grid.querySelectorAll = () => [lane];
  syncStepGridLaneRows(grid);

  assert.equal(grid.style.gridTemplateRows, "20px 58px");
});

test("camera grid tracks stay fixed when their rendered row was stretched", () => {
  const label = makeLane(2, 640, ["track-label"]);
  const row = makeLane(2, 640, ["step-row"]);
  const grid = makeCameraGrid([label, row]);

  syncStepGridLaneRows(grid);

  assert.equal(grid.style.gridTemplateRows, "20px 32px");
});
