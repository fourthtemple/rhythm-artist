import assert from "node:assert/strict";
import test from "node:test";

import { positionContextMenu } from "../src/ui/context-menu.js";

function withViewport(width, height, fn) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { innerWidth: width, innerHeight: height };
  globalThis.document = { documentElement: { clientWidth: width, clientHeight: height } };
  try {
    fn();
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}

function px(value) {
  return Number(String(value || "0").replace("px", ""));
}

function fakeMenu(width, height) {
  const menu = {
    style: {},
    getBoundingClientRect() {
      const renderedWidth = Math.min(width, px(menu.style.maxWidth) || width);
      const renderedHeight = Math.min(height, px(menu.style.maxHeight) || height);
      const left = px(menu.style.left);
      const top = px(menu.style.top);
      return {
        left,
        top,
        width: renderedWidth,
        height: renderedHeight,
        right: left + renderedWidth,
        bottom: top + renderedHeight
      };
    }
  };
  return menu;
}

test("positionContextMenu keeps a bottom-edge menu inside the viewport", () => {
  withViewport(300, 200, () => {
    const menu = fakeMenu(100, 80);
    positionContextMenu(menu, 260, 190);
    const rect = menu.getBoundingClientRect();
    assert.equal(menu.style.overflowY, "auto");
    assert.ok(rect.right <= 292);
    assert.ok(rect.bottom <= 192);
    assert.ok(rect.left >= 8);
    assert.ok(rect.top >= 8);
  });
});

test("positionContextMenu caps very tall menus and scrolls them internally", () => {
  withViewport(300, 200, () => {
    const menu = fakeMenu(180, 500);
    positionContextMenu(menu, 24, 24);
    const rect = menu.getBoundingClientRect();
    assert.equal(menu.style.maxHeight, "184px");
    assert.equal(menu.style.overflowY, "auto");
    assert.ok(rect.bottom <= 192);
  });
});
