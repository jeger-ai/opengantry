---
title: "Operation admission capabilities"
description: "Capability levels for each platform, harness, and operation family, with inventory and host evidence."
publish: true
section: reference
order: 99
---

# Operation admission capabilities

Generated from the default capability report (inventory commit `be464fe9`). Regenerate with `node scripts/gen-admission-capabilities.mjs > docs/reference/admission-capabilities.md` after building.

The [probe evidence](https://github.com/jeger-ai/opengantry/blob/008501e981f8c04d89ee9b3fae72497708a1e83a/docs/concepts/operation-admission-coverage.md) records host-specific results. On the documented Ubuntu host, the strict-network launch probe (digest prefix `cf28dc4346ff`) supported workspace writes, process spawning, dependency materialization, and network confinement under its stated prerequisites. A fresh artifact-read result from jai01, macOS Seatbelt and Windows sandbox evidence, and live GitHub App installation evidence remain pending.

| Platform | Harness | Operation | Level | Inventory evidence |
| --- | --- | --- | --- | --- |
| ubuntu-26.04-x64 | claude-code | artifact.read | unproven | unproven |
| ubuntu-26.04-x64 | claude-code | workspace.write | unproven | unproven / detection |
| ubuntu-26.04-x64 | claude-code | process.spawn | unproven | unproven |
| ubuntu-26.04-x64 | claude-code | dependency.materialize | unsupported | unsupported |
| ubuntu-26.04-x64 | claude-code | network.connect | unsupported | unsupported |
| ubuntu-26.04-x64 | claude-code | git.publish | unproven | unproven |
| ubuntu-26.04-x64 | claude-code | delivery.mutate | unsupported | unsupported |
| ubuntu-26.04-x64 | cursor | artifact.read | unsupported | unsupported |
| ubuntu-26.04-x64 | cursor | workspace.write | unproven | unproven / detection |
| ubuntu-26.04-x64 | cursor | process.spawn | unproven | unproven / audit-only |
| ubuntu-26.04-x64 | cursor | dependency.materialize | unsupported | unsupported |
| ubuntu-26.04-x64 | cursor | network.connect | unsupported | unsupported |
| ubuntu-26.04-x64 | cursor | git.publish | audit-only | audit-only |
| ubuntu-26.04-x64 | cursor | delivery.mutate | unsupported | unsupported |
| ubuntu-26.04-x64 | codex-cli | artifact.read | unsupported | unsupported |
| ubuntu-26.04-x64 | codex-cli | workspace.write | detection | detection |
| ubuntu-26.04-x64 | codex-cli | process.spawn | unsupported | unsupported |
| ubuntu-26.04-x64 | codex-cli | dependency.materialize | unsupported | unsupported |
| ubuntu-26.04-x64 | codex-cli | network.connect | unsupported | unsupported |
| ubuntu-26.04-x64 | codex-cli | git.publish | audit-only | audit-only |
| ubuntu-26.04-x64 | codex-cli | delivery.mutate | unsupported | unsupported |
| ubuntu-26.04-x64 | headless | artifact.read | unsupported | unsupported |
| ubuntu-26.04-x64 | headless | workspace.write | detection | detection |
| ubuntu-26.04-x64 | headless | process.spawn | audit-only | audit-only / detection |
| ubuntu-26.04-x64 | headless | dependency.materialize | detection | detection |
| ubuntu-26.04-x64 | headless | network.connect | unsupported | unsupported |
| ubuntu-26.04-x64 | headless | git.publish | unproven | unproven |
| ubuntu-26.04-x64 | headless | delivery.mutate | unsupported | unsupported |
| ubuntu-26.04-x64 | repository | artifact.read | unsupported | unsupported |
| ubuntu-26.04-x64 | repository | workspace.write | detection | detection |
| ubuntu-26.04-x64 | repository | process.spawn | unsupported | unsupported |
| ubuntu-26.04-x64 | repository | dependency.materialize | detection | detection |
| ubuntu-26.04-x64 | repository | network.connect | unsupported | unsupported |
| ubuntu-26.04-x64 | repository | git.publish | detection | detection |
| ubuntu-26.04-x64 | repository | delivery.mutate | unsupported | unsupported |
| macos-26.2-arm64 | claude-code | artifact.read | unproven | unproven |
| macos-26.2-arm64 | claude-code | workspace.write | unproven | unproven / detection |
| macos-26.2-arm64 | claude-code | process.spawn | unproven | unproven |
| macos-26.2-arm64 | claude-code | dependency.materialize | unsupported | unsupported |
| macos-26.2-arm64 | claude-code | network.connect | unsupported | unsupported |
| macos-26.2-arm64 | claude-code | git.publish | unproven | unproven |
| macos-26.2-arm64 | claude-code | delivery.mutate | unsupported | unsupported |
| macos-26.2-arm64 | cursor | artifact.read | unsupported | unsupported |
| macos-26.2-arm64 | cursor | workspace.write | unproven | unproven / detection |
| macos-26.2-arm64 | cursor | process.spawn | unproven | unproven / audit-only |
| macos-26.2-arm64 | cursor | dependency.materialize | unsupported | unsupported |
| macos-26.2-arm64 | cursor | network.connect | unsupported | unsupported |
| macos-26.2-arm64 | cursor | git.publish | unproven | audit-only |
| macos-26.2-arm64 | cursor | delivery.mutate | unsupported | unsupported |
| macos-26.2-arm64 | codex-cli | artifact.read | unsupported | unsupported |
| macos-26.2-arm64 | codex-cli | workspace.write | unproven | detection |
| macos-26.2-arm64 | codex-cli | process.spawn | unsupported | unsupported |
| macos-26.2-arm64 | codex-cli | dependency.materialize | unsupported | unsupported |
| macos-26.2-arm64 | codex-cli | network.connect | unsupported | unsupported |
| macos-26.2-arm64 | codex-cli | git.publish | unproven | audit-only |
| macos-26.2-arm64 | codex-cli | delivery.mutate | unsupported | unsupported |
| macos-26.2-arm64 | headless | artifact.read | unsupported | unsupported |
| macos-26.2-arm64 | headless | workspace.write | unproven | detection |
| macos-26.2-arm64 | headless | process.spawn | unproven | audit-only / detection |
| macos-26.2-arm64 | headless | dependency.materialize | unproven | detection |
| macos-26.2-arm64 | headless | network.connect | unsupported | unsupported |
| macos-26.2-arm64 | headless | git.publish | unproven | unproven |
| macos-26.2-arm64 | headless | delivery.mutate | unsupported | unsupported |
| macos-26.2-arm64 | repository | artifact.read | unsupported | unsupported |
| macos-26.2-arm64 | repository | workspace.write | unproven | detection |
| macos-26.2-arm64 | repository | process.spawn | unsupported | unsupported |
| macos-26.2-arm64 | repository | dependency.materialize | unproven | detection |
| macos-26.2-arm64 | repository | network.connect | unsupported | unsupported |
| macos-26.2-arm64 | repository | git.publish | unproven | detection |
| macos-26.2-arm64 | repository | delivery.mutate | unsupported | unsupported |
| windows-11-x64 | claude-code | artifact.read | unproven | unproven |
| windows-11-x64 | claude-code | workspace.write | unproven | unproven |
| windows-11-x64 | claude-code | process.spawn | unsupported | unsupported |
| windows-11-x64 | claude-code | dependency.materialize | unsupported | unsupported |
| windows-11-x64 | claude-code | network.connect | unsupported | unsupported |
| windows-11-x64 | claude-code | git.publish | unsupported | unsupported |
| windows-11-x64 | claude-code | delivery.mutate | unsupported | unsupported |
| windows-11-x64 | cursor | artifact.read | unsupported | unsupported |
| windows-11-x64 | cursor | workspace.write | unproven | unproven / detection |
| windows-11-x64 | cursor | process.spawn | unproven | unproven / audit-only |
| windows-11-x64 | cursor | dependency.materialize | unsupported | unsupported |
| windows-11-x64 | cursor | network.connect | unsupported | unsupported |
| windows-11-x64 | cursor | git.publish | unproven | audit-only |
| windows-11-x64 | cursor | delivery.mutate | unsupported | unsupported |
| windows-11-x64 | codex-cli | artifact.read | unsupported | unsupported |
| windows-11-x64 | codex-cli | workspace.write | unproven | detection |
| windows-11-x64 | codex-cli | process.spawn | unsupported | unsupported |
| windows-11-x64 | codex-cli | dependency.materialize | unsupported | unsupported |
| windows-11-x64 | codex-cli | network.connect | unsupported | unsupported |
| windows-11-x64 | codex-cli | git.publish | unproven | audit-only |
| windows-11-x64 | codex-cli | delivery.mutate | unsupported | unsupported |
| windows-11-x64 | headless | artifact.read | unsupported | unsupported |
| windows-11-x64 | headless | workspace.write | unsupported | unsupported / unproven |
| windows-11-x64 | headless | process.spawn | unproven | audit-only |
| windows-11-x64 | headless | dependency.materialize | unsupported | unsupported |
| windows-11-x64 | headless | network.connect | unsupported | unsupported |
| windows-11-x64 | headless | git.publish | unsupported | unsupported |
| windows-11-x64 | headless | delivery.mutate | unsupported | unsupported |
| windows-11-x64 | repository | artifact.read | unsupported | unsupported |
| windows-11-x64 | repository | workspace.write | unproven | unproven |
| windows-11-x64 | repository | process.spawn | unsupported | unsupported |
| windows-11-x64 | repository | dependency.materialize | unproven | unproven |
| windows-11-x64 | repository | network.connect | unsupported | unsupported |
| windows-11-x64 | repository | git.publish | unproven | detection |
| windows-11-x64 | repository | delivery.mutate | unsupported | unsupported |
