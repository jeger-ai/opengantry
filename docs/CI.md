# CI exporters (SARIF and JUnit)

All docs: [`index.md`](index.md) · IDE and plane receipt ingest: [`INTEGRATIONS.md`](INTEGRATIONS.md)

`gantry verify` can print a machine document for enterprise CI. Human logs stay off that stream.

| Flag | Stdout |
|------|--------|
| `--format text` | Human report (default) |
| `--format json` or `--json` | Verify JSON envelope |
| `--format sarif` | SARIF 2.1.0 |
| `--format junit` | JUnit XML (`testsuite` name `gantry-verify`) |

`--format json`, `sarif`, and `junit` are incompatible with `--fix`.

Diagnostics (`gantry verify:` chatter) go to **stderr**. The document is the only **stdout** payload. Redirect stdout only. Do not pipe stderr into the SARIF or JUnit file. The process exit code is still the verify result (0 pass, 1 fail).

Plane receipt ingest (`gantry verify --export`) is a separate contract. See [`INTEGRATIONS.md`](INTEGRATIONS.md) § CI receipt ingestion and [ADR-0037](../.gitagent/out-of-scope/ADR-0037-plane-deployment-and-ci-ingestion-contract.md). Export formats: [ADR-0027](../.gitagent/out-of-scope/ADR-0027-verify-export-formats.md).

## Exit codes differ by host

GitHub Code Scanning and GitLab test reports do not treat a failing `gantry verify` the same way.

**GitHub Actions (SARIF).** `if: always()` on the upload step is not enough. Exit code 1 still fails the job, so the pull request shows a red check and a Code Scanning alert. Set `continue-on-error: true` on the verify step so the exit code is swallowed, and `if: always()` on `github/codeql-action/upload-sarif`. Code Scanning is the failure indicator.

**GitLab CI (JUnit).** Do not swallow the exit code. There is no `allow_failure` and no `continue-on-error` equivalent on this job. `artifacts:reports:junit` parses the XML into pipeline test status. `when: always` on the artifact is enough for GitLab to keep the report when verify exits non-zero.

## GitHub Actions — Code Scanning

`security-events: write` is required for the upload. `fetch-depth: 0` gives verify the history it needs for git-proof.

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

The redirect writes stdout to `gantry.sarif`. Stderr stays in the Actions log.

## GitLab CI — JUnit

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

The script keeps the verify exit code. `when: always` stores the XML even when that exit code is 1, and GitLab reads test status from the report.
