import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uriIsDirectory } from "../lib/sarif-uri.js";

test("sarif-uri: trailing slash and stat both count as directories", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-sarif-uri-"));
  fs.mkdirSync(path.join(dest, "src", "new-module"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "file.ts"), "export {}\n");
  assert.equal(uriIsDirectory("src/new-module/", dest), true);
  assert.equal(uriIsDirectory("src/new-module", dest), true);
  assert.equal(uriIsDirectory("src/file.ts", dest), false);
  assert.equal(uriIsDirectory("src/missing", dest), false);
});
