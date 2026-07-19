import test from "node:test";
import assert from "node:assert/strict";

import { shouldStartWithBlankProject } from "../src/ui/config-file.js";

test("hosted Rhythm Artist starts with a blank project", () => {
  assert.equal(shouldStartWithBlankProject({
    protocol: "https:",
    hostname: "fourthtemple.github.io",
    pathname: "/rhythm-artist/"
  }), true);
});

test("local development keeps its configured startup project", () => {
  assert.equal(shouldStartWithBlankProject({
    protocol: "http:",
    hostname: "127.0.0.1",
    pathname: "/"
  }), false);
});
