import type { ArchitecturePointer } from "./architecture-pointer.js";
import { REL_ARCHITECTURE_DISCOVERY_SKILL } from "./constants.js";
import type { ArchitectureSourceKind, InitProfile } from "./init-profile.js";

const DEFAULT_FILE_LOCATION = "docs/ARCHITECTURE.md";
const DEFAULT_DIRECTORY_LOCATION = "docs/architecture";

export function defaultArchitectureLocation(kind: ArchitectureSourceKind): string {
  switch (kind) {
    case "file":
      return DEFAULT_FILE_LOCATION;
    case "directory":
      return DEFAULT_DIRECTORY_LOCATION;
    case "external":
      return "https://example.com/architecture";
    default:
      return "";
  }
}

export function composeArchitecturePointer(profile: InitProfile): ArchitecturePointer {
  const kind = profile.architectureSource;
  const location = (profile.architectureLocation ?? defaultArchitectureLocation(kind)).trim();

  if (kind === "unset") {
    return {
      schema_version: "0.1.0",
      kind: "unset",
      location: "",
      read_hint:
        "Architecture source not selected. Do NOT invent layer layout, module boundaries, or dependency rules. Read .gitagent/teacher/ARCHITECTURE-DISCOVERY.md and ask the user structured questions before any application code changes.",
      discovery: { skill: REL_ARCHITECTURE_DISCOVERY_SKILL },
    };
  }

  if (kind === "file") {
    return {
      schema_version: "0.1.0",
      kind: "file",
      location,
      read_hint:
        "Read this markdown file for repository layout and boundaries. If content is still the init stub, treat as unset and follow ARCHITECTURE-DISCOVERY.md before implementing.",
      discovery: { skill: REL_ARCHITECTURE_DISCOVERY_SKILL },
    };
  }

  if (kind === "directory") {
    return {
      schema_version: "0.1.0",
      kind: "directory",
      location,
      read_hint:
        "List this folder, read README or index first, then layer notes. If empty or placeholder-only, follow ARCHITECTURE-DISCOVERY.md before implementing.",
      discovery: { skill: REL_ARCHITECTURE_DISCOVERY_SKILL },
    };
  }

  return {
    schema_version: "0.1.0",
    kind: "external",
    location,
    read_hint:
      "Fetch architecture docs from this external source. If access.required, read ARCHITECTURE-ACCESS.md first. If unreachable or empty, follow ARCHITECTURE-DISCOVERY.md — do not assume layout.",
    discovery: { skill: REL_ARCHITECTURE_DISCOVERY_SKILL },
    access: profile.architectureAccessRequired
      ? {
          required: true,
          credential_slot: profile.architectureCredentialSlot,
          auth_hint: profile.architectureAuthHint,
        }
      : undefined,
  };
}

export function serializeArchitecturePointer(pointer: ArchitecturePointer): string {
  return `${JSON.stringify(pointer, null, 2)}\n`;
}
