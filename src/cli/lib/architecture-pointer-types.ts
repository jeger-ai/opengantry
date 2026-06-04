export type ArchitectureDocKind = "file" | "directory" | "external" | "unset";

export interface ArchitectureDiscovery {
  skill?: string;
}

export interface ArchitectureAccess {
  required: boolean;
  tool?: string;
  skill?: string;
  credential_slot?: string;
  auth_hint?: string;
  detect?: string[];
}

export interface ArchitecturePointer {
  schema_version: string;
  kind: ArchitectureDocKind;
  location: string;
  read_hint: string;
  access?: ArchitectureAccess;
  discovery?: ArchitectureDiscovery;
}

export const ARCHITECTURE_POINTER_SCHEMA_VERSION = "0.1.0" as const;

/** Init stub markers — file content matching these still requires discovery. */
export const ARCHITECTURE_STUB_MARKERS = [
  "Replace this section with your project structure",
  "Your architecture notes",
] as const;
