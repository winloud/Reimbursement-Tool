import assert from "node:assert/strict";
import test from "node:test";

import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "./appLayoutUtils.js";

test("sidebar layout keeps a compact icon rail and remembers the desktop preference", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(SIDEBAR_EXPANDED_WIDTH, 248);
  assert.equal(SIDEBAR_COLLAPSED_WIDTH, 72);
  assert.equal(readSidebarCollapsed(storage), false);
  assert.equal(writeSidebarCollapsed(storage, true), true);
  assert.equal(values.get(SIDEBAR_COLLAPSED_STORAGE_KEY), "true");
  assert.equal(readSidebarCollapsed(storage), true);
});

test("sidebar preference falls back safely when storage is unavailable", () => {
  const unavailableStorage = {
    getItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    },
  };

  assert.equal(readSidebarCollapsed(null), false);
  assert.equal(readSidebarCollapsed(unavailableStorage), false);
  assert.equal(writeSidebarCollapsed(null, true), false);
  assert.equal(writeSidebarCollapsed(unavailableStorage, true), false);
});
