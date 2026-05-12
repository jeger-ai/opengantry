/** Repo-relative paths used across gapman */
export const REL_MANIFEST = ".gitagent/foreman/MANIFEST.json" as const;
export const REL_MISSION_SCHEMA = ".gitagent/teacher/MISSION.schema.yaml" as const;
export const REL_MISSION_TEMPLATE = ".gitagent/teacher/MISSION.template.md" as const;
export const REL_HISTORY_DIR = ".gitagent/history" as const;
export const SKILLS_DIR_NAME = "skills" as const;
export const WORKER_LOG_FILENAME = "WORKER_LOG.md" as const;
export const DEFAULT_ACTIVE_MISSION = "ACTIVE_MISSION.md" as const;

/** Mission id in commits / missions (four digits) */
export const MSN_ID_PATTERN = /^MSN-\d{4}$/;

export const CLI_NAME = "gapman";
