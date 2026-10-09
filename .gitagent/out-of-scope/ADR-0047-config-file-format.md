---
id: ADR-0047
title: Config file format — humans write YAML, machines write JSON
status: ACTIVE
match_terms:
  - yaml
  - json
  - file format
  - config format
  - MANIFEST.yaml
  - rewrite to yaml
---

## Context

OpenGantry reads and writes both YAML and JSON with no stated rule. Missions, `TARGET_ARCHITECTURE.yaml` ([ADR-0024](ADR-0024-target-architecture-yaml.md)) and `.cage.yaml` are YAML. `MANIFEST.json`, `.gitagent/config.json`, `ARCHITECTURE.pointer.json`, `POLICY.pointer.json`, KPI files, receipts, attestations and the ledger are JSON. Each new config surface reopens the question, and a blanket "rewrite everything to YAML" keeps coming up because YAML is easier to read and allows comments.

A blanket rewrite is wrong for three reasons:

- **Hashed and signed artifacts need one byte form.** Receipt signatures, ledger entries, draft tokens, `contract_sha256`, interrogation checksums and verify finding fingerprints go through `canonicalJson` (`src/cli/lib/canonical-json.ts`). JSON has one canonical serialization, whereas YAML can express the same data in many ways (quoting, block vs flow, anchors, comments).
- **Third-party tools own their formats.** `package.json`, `tsconfig.json`, `.cursor/mcp.json`, `.cursor/hooks.json`, `opencode.json` and JSON Schemas are read by tools that only accept JSON.
- **Adopters already have the JSON files.** `gantry init` copies `templates/.gitagent/**` into adopter repos, and about 60 CLI modules reference those paths. If the CLI silently stopped reading `MANIFEST.json`, governance would quietly turn off.

## Decision

Pick the format by **who writes the file**:

1. **Humans write YAML.** Any new hand-edited config or law file (missions, architecture boundaries, cage rules, future Planner-authored config) MUST be YAML.
   - Parse with the `yaml` package (YAML 1.2 core schema, so `no` / `on` stay strings).
   - Validate against an explicit schema and reject unknown keys with a typed `GXT_*` error. Never trust implicit typing.
   - New loaders SHOULD reject aliases and anchors in governance files, so the file a reviewer reads is the data the CLI sees.
2. **Machines write JSON.** Files the CLI generates, hashes, signs or ingests (KPI evidence, receipts, attestations, ledger payloads, verify-run records, quality baselines, `SUBSTRATE.version.json`, MCP and SARIF/JUnit output) MUST stay JSON. Hashed or signed bytes MUST come from `canonicalJson`. Nobody should hand-edit these files, so readability is not a goal.
3. **Third-party formats stay native.** Files owned by another tool keep whatever format that tool reads. This ADR does not apply to them.
4. **Existing hand-edited JSON stays until migrated deliberately.** `MANIFEST.json`, `.gitagent/config.json`, `ARCHITECTURE.pointer.json` and `POLICY.pointer.json` remain authoritative as JSON. Moving any of them to YAML needs its own Planner mission (Tier-3), one file per mission, and MUST include:
   - **dual-read:** prefer `<name>.yaml` when present, fall back to `<name>.json`, and fail closed when both exist with different content;
   - a `gantry doctor` hint that suggests migrating, plus a deterministic migrate path (no hand conversion);
   - the template switch and docs in a minor release, with the JSON form still accepted for at least one minor version.

   `MANIFEST.json` is the first candidate, because comments explaining `forbidden_zones` and `path_risks` are the main gain.

## Consequences

- New config surfaces skip the format debate: if a human writes it, it is YAML; if the CLI writes it, it is JSON.
- No file changes format because of this ADR. It records the rule and the migration bar; migrations happen mission by mission.
- Signing, hashing and receipt schemas ([ADR-0036](ADR-0036-receipt-v0-2-signed-attribution.md), [ADR-0043](ADR-0043-compliance-ledger-git-ref.md)) are unaffected and stay JSON.
- A future migration that cannot meet the dual-read bar MUST NOT ship; adopters must never lose enforcement because a file was renamed.
