# Content governance example

Brand/compliance fixture for the OpenGantry content domain. Demonstrates the same agent graph as code governance — a hand-written TARGET_ARCHITECTURE.yaml, arch check, verify — over marketing copy instead of TypeScript imports.

## Fixture layout

| Path | Purpose |
|------|---------|
| `content/ad-*.md` | Ad copy with seeded violations |
| `TARGET_ARCHITECTURE.yaml` | Perimeter schema 0.3.0 (`domain: content`) |
| `.gitagent/` | Minimal GXT substrate for verify walkthrough |

## Seeded violations

1. **Forbidden claim** — `cures cancer` in `content/ad-bad.md` (`forbid_pattern`)
2. **Missing FDA disclaimer** — `content/ad-incomplete.md` lacks required boilerplate (`require_pattern`)
3. **Wrong brand hex** — `#FF0000` instead of approved `#1A2B3C` (`forbid_pattern`)

## Walkthrough

```bash
# gantry judges the repository it runs in, so copy the fixture into its own repository first
cp -r examples/content-governance /tmp/content-governance && cd /tmp/content-governance
git init -q && gantry init --yes --no-hooks --no-ci   # keeps the fixture's TARGET_ARCHITECTURE.yaml
gantry arch check
# Expect violations — fix files, rerun until OK
```

See [`docs/guides/content-domain.md`](../../docs/guides/content-domain.md) and [`docs/concepts/perimeters.md`](../../docs/concepts/perimeters.md).
