import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  buildAuthHeaders,
  fetchExternalArchitecture,
  type HttpFetcher,
} from "../lib/arch/external/architecture-fetch.js";
import { writeArchitectureCredential } from "../lib/arch/external/architecture-credential.js";
import { REL_ARCHITECTURE_POINTER } from "../lib/constants.js";

function writePointer(dest: string, body: Record<string, unknown>): void {
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(path.join(dest, REL_ARCHITECTURE_POINTER), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

test("buildAuthHeaders: bearer and basic", () => {
  assert.deepEqual(buildAuthHeaders({
    schema_version: "0.1.0",
    slot: "architecture/wiki",
    kind: "bearer",
    stored_at: "t",
    values: { token: "sekrit" },
  }), { Authorization: "Bearer sekrit" });

  const basic = buildAuthHeaders({
    schema_version: "0.1.0",
    slot: "architecture/wiki",
    kind: "basic",
    stored_at: "t",
    values: { username: "u", password: "p" },
  });
  assert.equal(basic.Authorization, `Basic ${Buffer.from("u:p").toString("base64")}`);
});

test("fetchExternalArchitecture: rejects non-external kind", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-fetch-"));
  writePointer(dest, {
    schema_version: "0.1.0",
    kind: "file",
    location: "docs/ARCHITECTURE.md",
    read_hint: "read file",
  });
  const result = await fetchExternalArchitecture({ repoRoot: dest });
  assert.equal(result.status, "fallback");
  assert.match(result.message, /not external/);
});

test("fetchExternalArchitecture: fetches with bearer credential", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-fetch-"));
  writePointer(dest, {
    schema_version: "0.1.0",
    kind: "external",
    location: "https://wiki.example.com/arch",
    read_hint: "fetch wiki",
    access: { required: true, credential_slot: "architecture/wiki" },
  });
  writeArchitectureCredential(dest, "architecture/wiki", "bearer", { token: "tok" });

  const fetcher: HttpFetcher = async (url, init) => {
    assert.equal(url, "https://wiki.example.com/arch");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer tok");
    return { status: 200, body: "# Architecture\n", contentType: "text/plain" };
  };

  const result = await fetchExternalArchitecture({ repoRoot: dest, fetcher });
  assert.equal(result.status, "fetched");
  assert.equal(result.body, "# Architecture\n");
});

test("fetchExternalArchitecture: fallback when credential missing", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-fetch-"));
  writePointer(dest, {
    schema_version: "0.1.0",
    kind: "external",
    location: "https://wiki.example.com/arch",
    read_hint: "fetch wiki",
    access: { required: true, credential_slot: "architecture/wiki" },
  });
  const result = await fetchExternalArchitecture({ repoRoot: dest });
  assert.equal(result.status, "fallback");
  assert.match(result.message, /credential slot/);
  assert.ok(result.discovery_skill.includes("ARCHITECTURE-DISCOVERY"));
});
