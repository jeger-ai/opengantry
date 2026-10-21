---
title: "CI exporters and receipts"
description: "Run gantry verify in CI: SARIF for GitHub Code Scanning, JUnit for GitLab, the pull request mission check, and receipt export to a control plane."
section: guides
order: 6
---

# CI exporters and receipts

`gantry verify` can print a machine document for CI. Human logs stay off that stream.

| Flag | Stdout |
|------|--------|
| `--format text` | Human report (default) |
| `--format json`, `--json` | The verify JSON envelope |
| `--format sarif` | SARIF 2.1.0 |
| `--format junit` | JUnit XML (`testsuite` named `gantry-verify`) |

With `json`, `sarif` or `junit`, diagnostics (`gantry verify:` lines) go to **stderr** and the document is the only **stdout** payload. Redirect stdout only; do not pipe stderr into the SARIF or JUnit file. The exit code is still the verify result: `0` pass, `1` fail. These formats cannot be combined with `--fix`.

The same formats work for a contract without missions: `gantry verify --contract … --format sarif` or `--format junit` (`testsuite` named `gantry-verify-contract`); the rule ids are listed in [Verify a change without missions](verify-contract.md#in-ci).

## Exit codes differ by host

GitHub Code Scanning and GitLab test reports treat a failing `gantry verify` differently.

**GitHub Actions (SARIF).** `if: always()` on the upload step is not enough: exit code 1 still fails the job, so the pull request shows both a red check and a Code Scanning alert. Set `continue-on-error: true` on the verify step and `if: always()` on `github/codeql-action/upload-sarif`. Code Scanning is then the failure indicator.

**GitLab CI (JUnit).** Do not swallow the exit code: no `allow_failure`, no `continue-on-error` equivalent. `artifacts:reports:junit` parses the XML into pipeline test status, and `when: always` keeps the report when verify exits non-zero.

## GitHub Actions: Code Scanning

`security-events: write` is required for the upload. `fetch-depth: 0` gives verify the history it needs for the Planner commit check.

```yaml
name: gantry-code-scanning
on:
  pull_request:
permissions:
  contents: read
  security-events: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install -g @jeger-ai/opengantry
      - name: Verify (SARIF on stdout)
        continue-on-error: true
        run: gantry verify --mission .gitagent/missions/MSN-NNNN.<slug>.yaml --format sarif > gantry.sarif
      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: gantry.sarif
          category: gantry-verify
```

The redirect writes stdout to `gantry.sarif`; stderr stays in the Actions log.

## GitLab CI: JUnit

```yaml
gantry-verify:
  image: node:24
  script:
    - npm install -g @jeger-ai/opengantry
    - gantry verify --mission .gitagent/missions/MSN-NNNN.<slug>.yaml --format junit > gantry-junit.xml
  artifacts:
    when: always
    reports:
      junit: gantry-junit.xml
```

## The pull request mission check

`gantry init` adds `.github/workflows/gxt-validate.yml` unless you pass `--no-ci`. On pull requests, commits that touch `.gitagent/`, `EXECUTOR_LOG.md`, the hooks or that workflow need an `[MSN-NNNN]` subject, unless the commit satisfies a [trusted automation](../concepts/enforcement-boundary.md#trusted-automation) rule or carries a valid break-glass note ([Break-glass](../reference/break-glass.md)). Without a trusted automation config the check fails closed.

## Receipt export to a control plane

Teams that run an OpenGantry control plane ingest a verify envelope from every pull request, pass or fail. The workflow ingests the envelope **before** failing the job, so failed gates still reach the ledger. Copy [`templates/.github/workflows/gxt-attest-ingest.yml`](https://github.com/jeger-ai/opengantry/blob/main/templates/.github/workflows/gxt-attest-ingest.yml) to `.github/workflows/` in your repository.

| Name | Type | Purpose |
|------|------|---------|
| `GANTRY_ORG_ID` | variable | Must match the plane's ingestion token org |
| `GANTRY_ORG_PEPPER` | secret | Customer-held pepper, never sent to the plane |
| `GANTRY_ORG_PEPPER_VERSION` | variable | Optional; default `1` |
| `PLANE_INGEST_URL` | variable | Public HTTPS base of the control plane |
| `PLANE_INGEST_TOKEN` | secret | From `planectl token-create` on the plane |

Without `GANTRY_ORG_ID` or `GANTRY_ORG_PEPPER` the workflow still runs `gantry verify` but skips `--export`; without `PLANE_INGEST_URL` or `PLANE_INGEST_TOKEN` it skips ingest. Missing optional hub config never fails a pull request.

**Order matters:**

1. Check out the pull request head with `fetch-depth: 0`.
2. Set a runner-verified identity, never the `git log` committer email: `GANTRY_SIGNER_PRINCIPAL=github:<user_id>:<login>` from `github.event.pull_request.user`, `GANTRY_SIGNER_PRINCIPAL_KIND=github_actor`, and `GANTRY_BRANCH_NAME` from `github.event.pull_request.head.ref`.
3. Run `gantry verify --mission … --ci --export envelope.json` with `continue-on-error: true`.
4. `POST $PLANE_INGEST_URL/api/v1/attestations/ingest` with the bearer token; expect `202` and a `request_id`.
5. Poll `GET $PLANE_INGEST_URL/api/v1/ingest/requests/:request_id` until `status=chained`; fail on `rejected` or a timeout. A `202` alone is not cryptographic success.
6. Fail the job if verify failed.

To debug an export locally:

```bash
export GANTRY_ORG_ID=org-example
export GANTRY_ORG_PEPPER='<secret>'
gantry verify --mission .gitagent/missions/MSN-NNNN.<slug>.yaml --export /tmp/envelope.json
```

Plane provisioning is documented in [opengantry-plane](https://github.com/jeger-ai/opengantry-plane/blob/main/docs/DEPLOYMENT.md). SARIF and JUnit above are a separate path from the receipt envelope.

Design notes: [ADR-0027 verify export formats](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0027-verify-export-formats.md), [ADR-0037 CI ingestion contract](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0037-plane-deployment-and-ci-ingestion-contract.md).
