import { emitCliJson } from "./command-boundary.js";
import { readEnvWithLegacy } from "./config-namespace.js";
import { GantryUserError } from "./errors.js";
import {
  filterEpochs,
  getPeppersForOrg,
  loadPepperKeyring,
  listOrgIds,
  type PepperKeyringEntry,
} from "./pepper-keyring.js";
import {
  canonicalizeRepositoryIdentifier,
  hmacSha256Hex,
  type SignerPrincipalKind,
} from "./receipt-attribution.js";

export interface PrincipalHmacResult {
  pepper_version: number;
  hmac: string;
  canonical_input: string;
}

export interface PrincipalHmacOptions {
  org?: string;
  keyring?: string;
  kind?: SignerPrincipalKind;
  value?: string;
  repo?: string;
  branch?: string;
  epochs?: string;
  json?: boolean;
}

function resolveOrgId(explicit: string | undefined, entries: PepperKeyringEntry[]): string {
  const orgId = explicit?.trim() || readEnvWithLegacy("ORG_ID");
  if (orgId) return orgId;

  const available = listOrgIds(entries);
  const hint =
    available.length > 0
      ? `available org_ids in keyring: ${available.join(", ")}`
      : "keyring has no org entries";
  throw new GantryUserError(
    "ORG_ID_REQUIRED",
    "principal-hmac requires --org (or GANTRY_ORG_ID)",
    hint,
    2,
  );
}

function parseKind(raw: string | undefined): SignerPrincipalKind | undefined {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "email" || trimmed === "github_actor") return trimmed;
  throw new GantryUserError(
    "PRINCIPAL_KIND_INVALID",
    `invalid --kind: ${raw}`,
    "use email or github_actor",
    2,
  );
}

function resolveCanonicalInput(options: PrincipalHmacOptions): string {
  const kind = parseKind(options.kind);
  const value = options.value?.trim();
  const repo = options.repo?.trim();
  const branch = options.branch?.trim();

  const modes = [kind && value ? "kind" : null, repo ? "repo" : null, branch ? "branch" : null].filter(
    Boolean,
  );
  if (modes.length !== 1) {
    throw new GantryUserError(
      "PRINCIPAL_HMAC_INPUT",
      "specify exactly one of: --kind <email|github_actor> <value>, --repo <url>, or --branch <name>",
      undefined,
      2,
    );
  }

  if (kind && value) {
    if (kind === "email") return value.toLowerCase();
    return value;
  }
  if (repo) return canonicalizeRepositoryIdentifier(repo);
  if (branch) return branch;
  throw new GantryUserError(
    "PRINCIPAL_HMAC_INPUT",
    "specify exactly one of: --kind <email|github_actor> <value>, --repo <url>, or --branch <name>",
    undefined,
    2,
  );
}

export function computePrincipalHmacs(
  peppers: PepperKeyringEntry[],
  canonicalInput: string,
): PrincipalHmacResult[] {
  return peppers.map((entry) => ({
    pepper_version: entry.pepper_version,
    hmac: hmacSha256Hex(entry.pepper, canonicalInput),
    canonical_input: canonicalInput,
  }));
}

export function runPrincipalHmac(options: PrincipalHmacOptions): void {
  const entries = loadPepperKeyring(options.keyring);
  const orgId = resolveOrgId(options.org, entries);
  const orgPeppers = getPeppersForOrg(entries, orgId);
  if (orgPeppers.length === 0) {
    const available = listOrgIds(entries);
    throw new GantryUserError(
      "ORG_ID_UNKNOWN",
      `no peppers found for org_id: ${orgId}`,
      available.length > 0 ? `available org_ids: ${available.join(", ")}` : undefined,
      2,
    );
  }

  const epochsSpec = options.epochs?.trim() || "current";
  const peppers = filterEpochs(orgPeppers, epochsSpec);
  if (peppers.length === 0) {
    throw new GantryUserError(
      "PEPPER_EPOCHS_EMPTY",
      `no pepper epochs matched --epochs ${epochsSpec} for org ${orgId}`,
      undefined,
      2,
    );
  }

  const canonicalInput = resolveCanonicalInput(options);
  const results = computePrincipalHmacs(peppers, canonicalInput);

  if (options.json) {
    emitCliJson({ status: "ok", hmacs: results });
    return;
  }

  for (const row of results) {
    process.stdout.write(`${row.hmac}\n`);
  }
}
