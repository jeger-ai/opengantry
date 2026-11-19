// Build first, then redirect stdout to docs/reference/admission-capabilities.md.
import { admissionCapabilityReport } from "../dist/packages/core/src/admission-capabilities.js";

const report = admissionCapabilityReport();
console.log(`---
title: "Operation admission capabilities"
description: "Capability levels for each platform, harness, and operation family, with inventory and host evidence."
publish: true
section: reference
order: 99
---

# Operation admission capabilities

Generated from the default capability report (inventory commit \`${report.inventoryCommit}\`). Regenerate with \`node scripts/gen-admission-capabilities.mjs > docs/reference/admission-capabilities.md\` after building.

The [probe evidence](https://github.com/jeger-ai/opengantry/blob/008501e981f8c04d89ee9b3fae72497708a1e83a/docs/concepts/operation-admission-coverage.md) records host-specific results. On the documented Ubuntu host, the strict-network launch probe (digest prefix \`cf28dc4346ff\`) supported workspace writes, process spawning, dependency materialization, and network confinement under its stated prerequisites. A fresh artifact-read result from jai01, macOS Seatbelt and Windows sandbox evidence, and live GitHub App installation evidence remain pending.

| Platform | Harness | Operation | Level | Inventory evidence |
| --- | --- | --- | --- | --- |`);
for (const row of report.rows) {
  console.log(`| ${row.platform} | ${row.harness} | ${row.family} | ${row.level} | ${row.evidence.inventoryLevel} |`);
}
