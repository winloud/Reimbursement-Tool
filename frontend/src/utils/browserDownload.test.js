import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saveBlobDownload, triggerBrowserDownload } from "./browserDownload.js";

const createFakeDocument = () => {
  const links = [];
  return {
    links,
    body: {
      appendChild(link) {
        links.push(link);
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "a");
      return {
        clicked: false,
        removed: false,
        click() {
          this.clicked = true;
        },
        remove() {
          this.removed = true;
        },
      };
    },
  };
};

describe("browser download helpers", () => {
  it("opens a real URL without creating a secondary blob download", () => {
    const documentRef = createFakeDocument();

    triggerBrowserDownload("/api/reports/downloads/token", { documentRef });

    assert.equal(documentRef.links.length, 1);
    assert.equal(documentRef.links[0].href, "/api/reports/downloads/token");
    assert.equal("download" in documentRef.links[0], false);
    assert.equal(documentRef.links[0].clicked, true);
    assert.equal(documentRef.links[0].removed, true);
  });

  it("rejects empty blobs before clicking a link", () => {
    const documentRef = createFakeDocument();

    assert.throws(
      () => saveBlobDownload({ blob: new Blob([]), filename: "empty.zip" }, { documentRef }),
      /下载内容为空/,
    );
    assert.equal(documentRef.links.length, 0);
  });

  it("keeps nonempty blob URLs alive until the delayed cleanup", () => {
    const documentRef = createFakeDocument();
    const callbacks = [];
    const revoked = [];
    const urlApi = {
      createObjectURL: () => "blob:test-download",
      revokeObjectURL: (url) => revoked.push(url),
    };

    saveBlobDownload(
      { blob: new Blob(["content"]), filename: "backup.zip" },
      {
        documentRef,
        urlApi,
        revokeDelayMs: 1234,
        setTimeoutFn: (callback, delay) => callbacks.push({ callback, delay }),
      },
    );

    assert.equal(documentRef.links[0].href, "blob:test-download");
    assert.equal(documentRef.links[0].download, "backup.zip");
    assert.deepEqual(revoked, []);
    assert.equal(callbacks[0].delay, 1234);
    callbacks[0].callback();
    assert.deepEqual(revoked, ["blob:test-download"]);
  });
});
