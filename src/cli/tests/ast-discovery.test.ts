import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverFolderSignature, findBannedImportsInFolder } from "../lib/ast-discovery.js";
import { buildSkillProposal, suggestSkillKeyFromFolder } from "../lib/register-proposals.js";

test("discoverFolderSignature: collects imports and exports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ast-"));
  const dir = path.join(root, "src", "payment");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "stripe-client.ts"),
    `import express from "express";
export class StripeClient {}
export default StripeClient;
`,
    "utf8",
  );
  const sig = discoverFolderSignature(root, "src/payment");
  assert.equal(sig.fileCount, 1);
  assert.ok(sig.imports.includes("express"));
  assert.ok(sig.exports.includes("StripeClient"));
  assert.ok(sig.exports.includes("default"));
});

test("findBannedImportsInFolder: detects banned specifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ban-"));
  const dir = path.join(root, "src", "db");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "bad.ts"),
    `import axios from "axios";
export const x = 1;
`,
    "utf8",
  );
  const violations = findBannedImportsInFolder(root, "src/db", ["axios"]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.specifier, "axios");
});

test("buildSkillProposal: suggests skill key from folder", () => {
  const sig = {
    folderRel: "src/database",
    imports: ["@prisma/client"],
    exports: ["QueryExecutor"],
    fileCount: 2,
  };
  assert.equal(suggestSkillKeyFromFolder(sig.folderRel), "database");
  const proposal = buildSkillProposal(sig, "db-transactions");
  assert.deepEqual(proposal.tmvc_roots, ["src/database/"]);
  assert.ok(proposal.suggested_forbidden_imports.includes("express"));
});
