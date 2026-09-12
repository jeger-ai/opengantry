import test from "node:test";
import assert from "node:assert/strict";
import { contractSha256, isEmptyContract, normalizeContract, normalizeContractPath } from "../lib/contract/contract-hash.js";
import { resolveEffectiveScope } from "../lib/contract/effective-scope.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import type { Manifest } from "../lib/types.js";

function manifest(skill: { tmvc_roots: string[]; forbidden_zones: string[] }): Manifest {
  return {
    schema_version: "0.5.0",
    skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: skill.tmvc_roots, forbidden_zones: skill.forbidden_zones } },
    path_risks: {},
    risk_keywords: [],
  } as unknown as Manifest;
}

test("contract hash: key order, array order, duplicates, and path spelling do not change the digest", () => {
  const a = contractSha256({
    banned_imports: ["prisma", "pg"],
    tmvc_roots: ["./src/ui/", "src/ui"],
    allow_dynamic_specifiers: false,
  });
  const b = contractSha256({
    tmvc_roots: ["src/ui/"],
    banned_imports: ["pg", "prisma", "pg"],
  });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("contract hash: normalizeContract omits empty lists and false booleans", () => {
  const norm = normalizeContract({
    tmvc_roots: [],
    forbidden_zones: ["  "],
    allowed_imports: ["zod", "zod"],
    strict_relative_imports: false,
    allow_dynamic_specifiers: true,
  });
  assert.deepEqual(norm, { allowed_imports: ["zod"], allow_dynamic_specifiers: true });
  assert.equal(isEmptyContract({ tmvc_roots: [] }), true);
  assert.equal(isEmptyContract(norm), false);
});

test("contract hash: normalizeContractPath collapses ./, backslashes, duplicate slashes; dirs keep one trailing /", () => {
  assert.equal(normalizeContractPath("./src//ui\\components/"), "src/ui/components/");
  assert.equal(normalizeContractPath("package.json"), "package.json");
  assert.equal(normalizeContractPath("src/ui///"), "src/ui/");
});

test("effective scope: contract narrows TMVC and unions forbidden/banned (tighten-only)", () => {
  const scope = resolveEffectiveScope({
    manifest: manifest({ tmvc_roots: ["src/"], forbidden_zones: [".gitagent/foreman/"] }),
    skillKey: "ui",
    contract: {
      tmvc_roots: ["src/ui/"],
      forbidden_zones: ["src/db/"],
      banned_imports: ["prisma"],
      allowed_imports: ["react"],
    },
    policy: {
      banned_imports: [{ specifier: "left-pad" }],
      manifest_constraints: { forbidden_zones_add: ["infra/"] },
    } as never,
  });
  assert.deepEqual(scope.tmvcRoots, ["src/ui/"]);
  assert.deepEqual(scope.forbiddenZones, [".gitagent/foreman/", "infra/", "src/db/"]);
  assert.deepEqual(scope.bannedImports, ["left-pad", "prisma"]);
  assert.deepEqual(scope.allowedImports, ["react"]);
  assert.equal(scope.hasContract, true);
});

test("effective scope: no contract falls back to skill roots", () => {
  const scope = resolveEffectiveScope({
    manifest: manifest({ tmvc_roots: ["src/"], forbidden_zones: [] }),
    skillKey: "ui",
    contract: null,
  });
  assert.deepEqual(scope.tmvcRoots, ["src/"]);
  assert.equal(scope.hasContract, false);
  assert.equal(scope.allowDynamicSpecifiers, false);
});

test("effective scope: contract root outside skill roots fails GXT_CONTRACT_SCOPE_ESCAPE", () => {
  assert.throws(
    () =>
      resolveEffectiveScope({
        manifest: manifest({ tmvc_roots: ["src/ui/"], forbidden_zones: [] }),
        skillKey: "ui",
        contract: { tmvc_roots: ["src/db/"] },
      }),
    (e: unknown) => e instanceof Error && e.message.includes(GXT_ERROR.CONTRACT_SCOPE_ESCAPE),
  );
});

test("effective scope: contract root inside a forbidden zone fails GXT_CONTRACT_SCOPE_ESCAPE", () => {
  assert.throws(
    () =>
      resolveEffectiveScope({
        manifest: manifest({ tmvc_roots: ["src/"], forbidden_zones: ["src/secrets/"] }),
        skillKey: "ui",
        contract: { tmvc_roots: ["src/secrets/keys/"] },
      }),
    /overlap forbidden zones/,
  );
});

test("effective scope: empty skill roots accept any contract roots (substrate skills)", () => {
  const scope = resolveEffectiveScope({
    manifest: manifest({ tmvc_roots: [], forbidden_zones: [] }),
    skillKey: "ui",
    contract: { tmvc_roots: ["src/cli/"] },
  });
  assert.deepEqual(scope.tmvcRoots, ["src/cli/"]);
});
