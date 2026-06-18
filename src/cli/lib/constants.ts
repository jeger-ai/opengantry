/** Repo-relative paths used across gapman */
export const REL_MANIFEST = ".gitagent/foreman/MANIFEST.json" as const;
/** Agent discovery for code layout (file, directory, or external). */
export const REL_ARCHITECTURE_POINTER = ".gitagent/ARCHITECTURE.pointer.json" as const;
/** Agent instructions when architecture access requires authentication. */
export const REL_ARCHITECTURE_ACCESS_SKILL = ".gitagent/teacher/ARCHITECTURE-ACCESS.md" as const;
/** Agent instructions when architecture is unset, stub, or uncertain — ask before implementing. */
export const REL_ARCHITECTURE_DISCOVERY_SKILL = ".gitagent/teacher/ARCHITECTURE-DISCOVERY.md" as const;
/** Git-ignored credential slots for architecture sources (see gapman arch cred). */
export const REL_ARCHITECTURE_CREDENTIALS_DIR = ".gitagent/history/credentials" as const;
export const REL_MISSION_SCHEMA = ".gitagent/teacher/MISSION.schema.yaml" as const;
export const REL_KPI_REPORT_SCHEMA = ".gitagent/teacher/KPI-REPORT.schema.yaml" as const;
export const DEFAULT_KPI_REPORT_DIR = ".gitagent/kpi" as const;
export const REL_MISSION_TEMPLATE = ".gitagent/teacher/MISSION.template.md" as const;
export const REL_HISTORY_DIR = ".gitagent/history" as const;
/** Git-ignored machine-readable runtime error (see templates/.gitignore.gxt). */
export const REL_AGENT_ERROR_FILE = ".gitagent/history/.ignored-last-error.json" as const;
/** Git-ignored verify failure remediation feed for IDE/agent loops (atomic swap writes). */
export const REL_NEXT_REMEDIATION = ".gitagent/tmp/NEXT_REMEDIATION.json" as const;
/** Ephemeral runtime snapshot scratch (gitignored; see docs/ADR-EPHEMERAL-VIRTUALIZATION.md). */
export const REL_VIRTUAL_SCRATCH = ".gitagent/virtual/" as const;
/** ADR markdown (optional `match_terms` in frontmatter) — Foreman may emit non-binding hints only. */
export const REL_OUT_OF_SCOPE_DIR = ".gitagent/out-of-scope" as const;
export const SKILLS_DIR_NAME = "skills" as const;
export const WORKER_LOG_FILENAME = "WORKER_LOG.md" as const;
/** Default trace quote emitted by `gapman legislate` before worker execution. */
export const LEGISLATE_TRACE_PLACEHOLDER =
  "REPLACE_WITH_VERBATIM_QUOTE_FROM_WORKER_LOG_AFTER_EXECUTION" as const;
/** Default path for `--emit-mission` (must stay under `.gitagent/missions/` for `gapman verify` git-proof). */
export const DEFAULT_ACTIVE_MISSION = ".gitagent/missions/ACTIVE_MISSION.md" as const;

/** Mission id in commits / missions (four digits) */
export const MSN_ID_PATTERN = /^MSN-\d{4}$/;

export const CLI_NAME = "gapman";
export { CLI_VERSION, NPM_PACKAGE_NAME } from "./version.gen.js";
