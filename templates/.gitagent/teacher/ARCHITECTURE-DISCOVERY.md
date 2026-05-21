# Architecture discovery (unset or uncertain)

Read this when [`.gitagent/ARCHITECTURE.pointer.json`](../ARCHITECTURE.pointer.json) has **`"kind": "unset"`**, or when pointed architecture docs are missing, empty, or still the init stub.

## Hard rule

**Do NOT define or assume the full codebase architecture yourself.** The user may expect you to invent layers, folders, and boundaries — that is the **worst outcome**. Uncertainty MUST be resolved with the user **before** planning or editing application code.

## When this applies

- Pointer `kind` is **`unset`** (no source selected)
- `docs/ARCHITECTURE.md` (or pointed file) still contains placeholder text such as *"Replace this section with your project structure"*
- Pointed directory is empty or has no layout guidance
- External source is unreachable and no fallback docs exist in-repo

## What to do (in order)

1. **Stop** — do not scaffold modules, pick frameworks, or create folder trees based on guesses.
2. **Tell the user** architecture is unset or incomplete and implementation will wait until layout is clarified.
3. **Ask focused questions** (one or two at a time), for example:
   - Where should architecture documentation live? (markdown file, folder, Confluence/wiki, other)
   - What are the main layers or bounded contexts?
   - Which directories are entry points for each skill / TMVC root in MANIFEST?
   - Dependency direction rules (what may import what)?
   - Existing conventions from another repo or ADR to follow?
4. **Log a Context Request** in `WORKER_LOG.md` when the discussion expands scope beyond current TMVC.
5. **Update the pointer** (or ask the user / Teacher to) once source is chosen — e.g. set `kind: file` and fill `docs/ARCHITECTURE.md`, or `kind: external` with `access` if authenticated.
6. **Only then** proceed with implementation aligned to documented layout and MANIFEST `tmvc_roots`.

## After the user answers

- If they choose a **file** or **folder**, help them write concise architecture notes; update `.gitagent/ARCHITECTURE.pointer.json` accordingly.
- If they choose **external**, set `kind: external`, follow [ARCHITECTURE-ACCESS.md](./ARCHITECTURE-ACCESS.md) for auth.
- If they want **you to draft** architecture text, treat it as a **proposal** — present for explicit approval before treating it as law.

## Never

- Silently invent `src/` layout, clean/hexagonal layers, or package structure without approval
- Treat generic best practices as this repository's architecture
- Skip discovery because the task "sounds simple"
