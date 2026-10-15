---
title: "Docs style contract"
description: "Rules every page under docs/ follows. scripts/assert-docs-structure.mjs enforces the checkable ones on every validate run."
publish: false
---

# Docs style contract

`docs/` is the source for the documentation section of [opengantry.ai](https://opengantry.ai). The site builds its navigation from frontmatter, so pages carry content, not navigation. `scripts/assert-docs-structure.mjs` checks the rules marked **(gate)** on every `npm run validate`; the rest are review criteria.

## Layout

| Folder | Audience | Holds |
|--------|----------|-------|
| `cage/` | Anyone running an agent today | `gantry cage` / `gantry-cage`: quickstart, protected paths, `.cage.yaml`, report and exit codes, limits |
| `start/` | New OpenGantry adopters | Install, first mission, how the mission graph works |
| `guides/` | Adopters doing one task | One agent, CI, a domain, regulated teams, org control plane, troubleshooting |
| `concepts/` | Anyone who wants the model | Missions, scope, perimeters, verify, trace evidence, enforcement boundary, when to adopt |
| `reference/` | Lookup | MCP tools, session variables, metrics and report, break-glass, experimental features, release notes |

Top-level files: `index.md` (docs landing), `MANIFESTO.md` (`section: about`) and `SECURITY.md` (`section: reference`) are published. `DEVELOPMENT.md`, `ARCHITECTURE.md`, `ADR-EPHEMERAL-VIRTUALIZATION.md`, `CHANGELOG.md` and this file are repository docs with `publish: false`. The remaining upper-case files are moved pages (below). New pages go in a folder, with a lower-case hyphenated file name.

## Frontmatter (gate)

Every file under `docs/` except `archive/` starts with:

```yaml
---
title: "Protected paths"
description: "One or two sentences, at most 160 characters, used for search and link previews."
section: cage        # overview | cage | start | guides | concepts | reference | about
order: 2             # position in the sidebar section
---
```

A page in a folder uses that folder as its `section`. A page that is not published sets `publish: false` instead of `section` and `order`. The page title comes from `title`; the body may repeat it as its `#` heading for GitHub readers.

## One page, one job

- A published page holds at most **1,500 words**, not counting frontmatter and fenced code **(gate)**. Split a page that grows past that; do not trim facts to fit.
- Lead with what the reader can do. Put the reasoning after the steps, not before.
- Keep paragraphs short. Use a table when the reader compares rows, a list when order or grouping matters, and prose otherwise.
- State current behaviour without version tags. Version history lives in `reference/release-notes.md` and `CHANGELOG.md`.

## No navigation inside pages (gate)

The site sidebar and page footer handle navigation. A published page has none of:

- `Product home:` or `All docs:` lines
- `When to read` tables
- `**How:**` link chains, `See also:` or `Related docs:` lines

Link inline where a sentence needs it. A page may end with one short sentence that names the next step.

## References

- Published pages do not name missions (`MSN-NNNN`) outside code **(gate)**. Mission ids belong in commit history.
- An ADR may be named only on one trailing line that starts with `Design notes:` **(gate)**, as a link to the ADR on GitHub.
- Relative links from a published page stay inside `docs/` **(gate)**; link repository files outside `docs/` with a `https://github.com/jeger-ai/opengantry/...` URL, because the site renders only `docs/`.
- Every relative link and `#anchor` in `docs/`, `README.md`, `packages/opengantry-cage/README.md` and `examples/*/README.md` resolves **(gate)**. Anchors follow GitHub heading slugs.

## Cage pages stand alone

The cage is the first thing most readers run, and it needs no OpenGantry setup. Pages under `cage/` link only to other `cage/` pages plus at most one link into `start/` each **(gate)**, and never require missions, TMVC or the manifest to make sense. Manifest `forbidden_zones` are mentioned only as an extra protected source when a manifest exists.

## Moved pages (gate)

When a page is split or renamed, the old file stays at its path so links from released CLI hints, shipped templates, ADRs and old npm READMEs keep resolving on GitHub:

```yaml
---
title: "Adoption runbook (moved)"
description: "This page was split into the start and guides sections."
publish: false
moved_to:
  - start/install.md
  - start/first-mission.md
---
```

The body is at most 20 lines: one sentence and a table that maps the old sections to their new pages, with `<a id="old-heading-slug"></a>` anchors so old `#fragment` links still land on the right row. Every `moved_to` target must exist. The site turns `moved_to` into redirects.

## Facts

Docs describe what the code does. When a page names a flag, default, exit code or error code, it matches `src/cli/`. When behaviour changes, the mission that changes it updates the page in the same pull request.
