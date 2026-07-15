# Content governance example

Brand/compliance fixture for OpenGantry v3.0.0 domain adapters. Demonstrates the same agent loop as code governance — discovery, blueprint, perimeter check, verify — over marketing copy instead of TypeScript imports.

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
# From repository root (after npm run build)
node dist/cli/index.js init --discover --domain content --yes --cwd examples/content-governance
node dist/cli/index.js perimeter check --cwd examples/content-governance
# Expect violations — fix files, rerun until OK
```

See [`docs/AGENT-LOOP.md`](../../docs/AGENT-LOOP.md) and [`docs/DOMAINS.md`](../../docs/DOMAINS.md).
