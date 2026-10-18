# Virtual scratch (parked example)

Until 3.9 a mission could set `virtual_capture: true` and `gantry verify` captured the gate's output under
`.gitagent/virtual/<flight-id>/` (gitignored), purging it on success and scavenging stale flights; KPI reports under
that directory skipped the stale-evidence binding. The design record is `docs/ADR-EPHEMERAL-VIRTUALIZATION.md`.
Nobody used it in a gate, so ADR-0052 A10 parks it here: the CLI still accepts `virtual_capture` in a mission file and
ignores it (the field goes in 4.0), and `gantry init` still ignores `.gitagent/virtual/` and `.gitagent/tmp/`.

- `src/virtual-scratch-store.ts`: flight ids, atomic JSON writes, gate capture, purge and scavenging, as it was.
- `tests/virtual-scratch.test.ts`: the unit test as it ran inside the CLI tree.

Type-check against the repository with `npx tsc -p examples/virtual-scratch/tsconfig.json`.
