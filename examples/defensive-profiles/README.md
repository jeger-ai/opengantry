# Defensive profiles (parked example)

Until 3.9 the gantry CLI carried opt-in "defensive profiles": a `defensive_profile` block in `.gitagent/config.json`
(presets `strict_enterprise`, `balanced_partner`, `lean_scratchpad`) with severity-tiered guards on the TMVC diff
(net lines changed, file scope, churn ratio, test-to-code), a verify phase that ran them, and an `init` step that
wrote a preset. Nobody used them in a gate, and the structural law of ADR-0052 (layer budgets, owner, registry,
dependency and duplicate rules in `TARGET_ARCHITECTURE.yaml`) covers the same ground deterministically, so A10 parks
them here. The CLI ignores a `defensive_profile` block, `gantry init` no longer offers a preset, and `gantry verify`
has no defensive phase. One behaviour to note: `ledger.mode` is no longer inferred from a preset; set it explicitly.

What is here, as it was:

- `src/defensive-profile.ts`: the config shape, validation and preset resolution.
- `src/defensive-profile-presets.ts`: the three presets and their defaults.
- `src/defensive-guard.ts`: the guards over the TMVC diff.
- `src/verify-defensive-phase.ts`: the verify phase wrapper that produced warnings, audits or a failure.
- `src/init-defensive-profile.ts`: the `init` merge of a preset into `config.json`.
- `tests/`: the unit tests as they ran inside the CLI tree.

The sources import the CLI's lib through relative paths and type-check against the repository:
`npx tsc -p examples/defensive-profiles/tsconfig.json`.
