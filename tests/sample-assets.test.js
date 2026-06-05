import test from "node:test";
import assert from "node:assert/strict";
import { findSampleFileHandleInDirectory } from "../src/ui/sample-assets.js";

class FakeFileHandle {
  kind = "file";

  constructor(name) {
    this.name = name;
  }

  async getFile() {
    return { name: this.name };
  }
}

class FakeDirectoryHandle {
  kind = "directory";

  constructor(name, entries = {}) {
    this.name = name;
    this.entriesByName = new Map(Object.entries(entries));
  }

  async getFileHandle(name) {
    const handle = this.entriesByName.get(name);
    if (!handle || handle.kind !== "file") throw new Error("not-found");
    return handle;
  }

  async getDirectoryHandle(name) {
    const handle = this.entriesByName.get(name);
    if (!handle || handle.kind !== "directory") throw new Error("not-found");
    return handle;
  }

  async *entries() {
    yield* this.entriesByName.entries();
  }
}

test("findSampleFileHandleInDirectory falls back to root filename search", async () => {
  const fileName = "SUPERSEAL 3D DIRECTOR'S KUTS (Skipless Side) Q's dirty used copy.R.wav";
  const root = new FakeDirectoryHandle("Samples", {
    [fileName]: new FakeFileHandle(fileName)
  });

  const found = await findSampleFileHandleInDirectory(root, {
    path: "SUPERSEAL 3D DIRECTOR'S KUTS (Skipless Side) Q'S Dirty Used Copy.R.wav"
  });

  assert.equal(found.path, fileName);
  assert.equal(found.handle.name, fileName);
});

test("findSampleFileHandleInDirectory strips a saved root folder prefix", async () => {
  const fileName = "break.wav";
  const root = new FakeDirectoryHandle("Samples", {
    [fileName]: new FakeFileHandle(fileName)
  });

  const found = await findSampleFileHandleInDirectory(root, {
    path: `Samples/${fileName}`
  });

  assert.equal(found.path, fileName);
});
