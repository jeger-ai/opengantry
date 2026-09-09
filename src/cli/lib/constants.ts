/** Repo-relative paths used across gantry */
export const REL_MANIFEST = ".gitagent/foreman/MANIFEST.json" as const;
/** Agent discovery for code layout (file, directory, or external). */
export const REL_ARCHITECTURE_POINTER = ".gitagent/ARCHITECTURE.pointer.json" as const;
/** Agent instructions when architecture access requires authentication. */
export const REL_ARCHITECTURE_ACCESS_SKILL = ".gitagent/planner/ARCHITECTURE-ACCESS.md" as const;
/** Agent instructions when architecture is unset, stub, or uncertain — ask before implementing. */
export const REL_ARCHITECTURE_DISCOVERY_SKILL = ".gitagent/planner/ARCHITECTURE-DISCOVERY.md" as const;
/** Git-ignored credential slots for architecture sources (see gantry arch cred). */
export const REL_ARCHITECTURE_CREDENTIALS_DIR = ".gitagent/history/credentials" as const;
export const REL_MISSION_SCHEMA = ".gitagent/planner/MISSION.schema.yaml" as const;
export const REL_KPI_REPORT_SCHEMA = ".gitagent/planner/KPI-REPORT.schema.yaml" as const;
export const DEFAULT_KPI_REPORT_DIR = ".gitagent/kpi" as const;
export const REL_MISSION_TEMPLATE = ".gitagent/planner/MISSION.template.md" as const;
export const REL_HISTORY_DIR = ".gitagent/history" as const;
/** Git-ignored attestation receipts for optional hub ingestion. */
export const REL_RECEIPTS_DIR = ".gitagent/history/receipts" as const;
/** Planner SSH allowed signers for `git log --format=%G?` / perimeter --ci. */
export const REL_PLANNER_SIGNING_PUB = ".gitagent/foreman/PLANNER.signing.pub" as const;
/** git config key set by doctor and `gantry perimeter --ci`. */
export const GIT_CONFIG_ALLOWED_SIGNERS = "gpg.ssh.allowedSignersFile" as const;
/** Tracked pin of an org policy git source (ADR-0042). */
export const REL_POLICY_POINTER = ".gitagent/foreman/POLICY.pointer.json" as const;
/** Git-ignored org policy bundle cache (ADR-0042). */
export const REL_POLICY_CACHE = ".gitagent/history/policy" as const;
/** Orphan commit chain for digest-only compliance entries (ADR-0043). */
export const LEDGER_REF = "refs/gxt/ledger" as const;
/** Fetched foreign ledger refs (ADR-0044). */
export const LEDGER_DEPS_REF_PREFIX = "refs/gxt/deps/" as const;
export const LEDGER_GENESIS_HASH = "0".repeat(64);
/** Git-ignored machine-readable runtime error (see templates/.gitignore.gxt). */
export const REL_AGENT_ERROR_FILE = ".gitagent/history/.ignored-last-error.json" as const;
/** Git-ignored verify failure remediation feed for IDE/agent loops (atomic swap writes). */
export const REL_NEXT_REMEDIATION = ".gitagent/tmp/NEXT_REMEDIATION.json" as const;
/** Default localhost port for `gantry report` (walks +1..+10 on EADDRINUSE when unset). */
export const DEFAULT_REPORT_PORT = 3134;
/** Ephemeral runtime snapshot scratch (gitignored; see docs/ADR-EPHEMERAL-VIRTUALIZATION.md). */
export const REL_VIRTUAL_SCRATCH = ".gitagent/virtual/" as const;
/** ADR markdown (optional `match_terms` in frontmatter) — Foreman may emit non-binding hints only. */
export const REL_OUT_OF_SCOPE_DIR = ".gitagent/out-of-scope" as const;
export const SKILLS_DIR_NAME = "skills" as const;
export const EXECUTOR_LOG_FILENAME = "EXECUTOR_LOG.md" as const;
/** Default trace quote emitted by `gantry legislate` before executor execution. */
export const LEGISLATE_TRACE_PLACEHOLDER =
  "REPLACE_WITH_VERBATIM_QUOTE_FROM_EXECUTOR_LOG_AFTER_EXECUTION" as const;
/** Default path for `--emit-mission` (must stay under `.gitagent/missions/` for `gantry verify` git-proof). */
export const DEFAULT_ACTIVE_MISSION = ".gitagent/missions/ACTIVE_MISSION.md" as const;

/** Mission id in commits / missions (four digits) */
export const MSN_ID_PATTERN = /^MSN-\d{4}$/;

export const CLI_NAME = "gantry";
export const LEGACY_CLI_NAME = "gapman";
export const OPENGANTRY_WEBSITE_URL = "https://opengantry.ai" as const;
export { CLI_VERSION, NPM_PACKAGE_NAME } from "./version.gen.js";
