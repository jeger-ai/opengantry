import type { OverviewLastVerify, OverviewViewModel } from "./report-overview-projector.js";
import { REPORT_PAGE_CSS } from "./report-template-css.js";
import {
  escapeHtml,
  formatUtcTimestamp,
  statusBadgeClass,
  statusBadgeLabel,
  type ReportOutcome,
} from "./report-template-shared.js";
import type { VerifyLastOutcome } from "./verify-run-ring.js";

function renderOutcomeBadge(outcome: ReportOutcome | VerifyLastOutcome): string {
  return `<span class="${statusBadgeClass(outcome)}">${escapeHtml(statusBadgeLabel(outcome))}</span>`;
}

function renderVerifyStatusBadge(outcome: VerifyLastOutcome | null): string {
  if (!outcome) return '<span class="meta">No local verify</span>';
  return renderOutcomeBadge(outcome);
}

function renderWhatToDo(last: OverviewLastVerify, nextStep: string | null): string {
  let body: string;
  switch (last.outcome) {
    case "EMPTY":
      body =
        '<p class="meta">Run <code>gantry verify --mission …</code>, then refresh this page.</p>';
      break;
    case "PASS":
      body =
        '<p class="meta">Last verify passed. Review the ring if you expected a failure, or open drill-down to confirm gate output.</p>';
      break;
    case "ABORT":
      body =
        '<p class="meta"><strong>ABORT</strong> — identical findings recurred. Stop the repair loop and escalate to Planner.</p>';
      break;
    case "FAIL":
      body =
        '<p class="meta"><strong>FAIL</strong> — open drill-down for findings and gate log. Fix within TMVC, trace in <code>EXECUTOR_LOG.md</code>, re-run verify.</p>';
      break;
    default: {
      const _exhaustive: never = last.outcome;
      body = _exhaustive;
    }
  }
  const suggested = nextStep
    ? `<p class="meta">Suggested: <code>${escapeHtml(nextStep)}</code></p>`
    : "";
  return `${body}${suggested}`;
}

function renderRuns(runs: OverviewViewModel["verify_runs"]): string {
  if (runs.length === 0) {
    return '<p class="meta">No local verify-run history yet. Runs appear after <code>gantry verify</code> on this machine.</p>';
  }
  const rows = runs
    .map((r) => {
      const findings =
        r.findings_count === 0
          ? '<span class="meta">0</span>'
          : `<span class="run-findings">${r.findings_count}</span>`;
      const error = r.error_code
        ? `<span class="run-error" title="${escapeHtml(r.error_code)}">${escapeHtml(r.error_code)}</span>`
        : '<span class="meta">—</span>';
      return /* html */ `<tr class="run-row">
  <td>${renderOutcomeBadge(r.outcome)}</td>
  <td><a class="nav-link" href="${escapeHtml(r.href)}"><code>${escapeHtml(r.msn_id ?? "—")}</code></a></td>
  <td class="meta run-when">${escapeHtml(r.when)}</td>
  <td class="meta">${escapeHtml(r.duration)}</td>
  <td>${findings}</td>
  <td>${error}</td>
  <td class="run-summary">${escapeHtml(r.summary)}</td>
  <td><a class="nav-link" href="${escapeHtml(r.href)}">Drill-down →</a></td>
</tr>`;
    })
    .join("");
  return /* html */ `<table class="run-history">
  <thead>
    <tr>
      <th>Status</th>
      <th>Mission</th>
      <th>When</th>
      <th>Duration</th>
      <th>Findings</th>
      <th>Error</th>
      <th>Summary</th>
      <th></th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderVerifyGlance(model: OverviewViewModel): string {
  const last = model.last_verify;
  const glance = model.verify_glance;
  const lastVerifyBlock = last.empty
    ? '<p class="meta">No verify snapshot yet — run <code>gantry verify</code> on this machine.</p>'
    : /* html */ `<p class="status-row">${renderOutcomeBadge(last.outcome)}
        <code>${escapeHtml(last.msn_id)}</code></p>
      <p class="glance-detail">${escapeHtml(last.message || last.outcome)}</p>
      <p><a class="nav-link" href="${last.href}">Open last-verify drill-down →</a></p>`;

  const ringBlock =
    glance.ring_total === 0
      ? '<p class="meta">No runs in the local ring yet.</p>'
      : /* html */ `<p class="glance-stat">
          <strong>${glance.ring_total}</strong> run${glance.ring_total === 1 ? "" : "s"} recorded
          <span class="meta">(max 20, this machine only)</span>
        </p>
        <p class="glance-breakdown">
          <span class="glance-pass">${glance.ring_pass} pass</span>
          · <span class="glance-fail">${glance.ring_fail} fail</span>
          · <span class="glance-abort">${glance.ring_abort} abort</span>
        </p>`;

  const failureBlock = glance.last_failure
    ? /* html */ `<p class="status-row">${renderOutcomeBadge(glance.last_failure.outcome)}
        <code>${escapeHtml(glance.last_failure.msn_id)}</code>
        <span class="meta">${escapeHtml(glance.last_failure.when)}</span></p>
      <p class="glance-detail">${escapeHtml(glance.last_failure.summary)}</p>
      <p><a class="nav-link" href="${escapeHtml(glance.last_failure.href)}">Open failure drill-down →</a></p>`
    : '<p class="meta">No failures in the local ring.</p>';

  return /* html */ `<section class="panel glance">
  <div class="glance-grid">
    <div class="glance-cell">
      <h2>Last verify</h2>
      ${lastVerifyBlock}
    </div>
    <div class="glance-cell">
      <h2>Local ring</h2>
      ${ringBlock}
    </div>
    <div class="glance-cell">
      <h2>Latest failure</h2>
      ${failureBlock}
    </div>
  </div>
</section>`;
}

function renderTimeline(model: OverviewViewModel): string {
  if (model.timeline.length === 0) {
    return '<p class="meta">No missions found at HEAD.</p>';
  }
  const rows = model.timeline
    .map((row) => {
      const pin = row.pinned ? ' <span class="badge badge--empty badge--pin">pinned</span>' : "";
      const firstSeen = formatUtcTimestamp(row.first_seen_ms) ?? "—";
      const lastSeen = formatUtcTimestamp(row.last_seen_ms) ?? "—";
      return /* html */ `<tr>
  <td>${renderVerifyStatusBadge(row.verify_status)}</td>
  <td><a class="nav-link" href="${escapeHtml(row.href)}"><code>${escapeHtml(row.msn_id)}</code></a>${pin}</td>
  <td class="meta">${escapeHtml(firstSeen)}</td>
  <td class="meta">${escapeHtml(lastSeen)}</td>
</tr>`;
    })
    .join("");
  return /* html */ `<table class="timeline"><thead><tr><th>Status</th><th>Mission</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderBlockers(model: OverviewViewModel): string {
  if (model.blockers.length === 0) return '<p class="meta">No blockers.</p>';
  return `<ul class="blockers">${model.blockers.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
}

export function renderOverviewHtml(model: OverviewViewModel): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenGantry Report — ${escapeHtml(model.repo_name)}</title>
  <style>${REPORT_PAGE_CSS}</style>
</head>
<body>
  <header>
    <h1>OpenGantry Report</h1>
    <span class="badge badge--empty">${escapeHtml(model.verify_readiness)}</span>
    <span class="meta">${escapeHtml(model.repo_name)}</span>
    <span class="meta">schema ${escapeHtml(model.schema_version)}</span>
  </header>
  <p class="guide">
    <strong>How to read this view:</strong>
    Local verify triage after <code>gantry verify</code> — not a hosted console or adoption dashboard.
    <strong>Last verify</strong> is the most recent snapshot on this machine.
    <strong>Local ring</strong> keeps up to 20 runs (gitignored).
    <strong>Latest failure</strong> is the most recent FAIL/ABORT in that ring.
    Use the history table and drill-down links for findings, circuit breaker, phase timings, and gate logs.
  </p>
  <main>
    ${renderVerifyGlance(model)}
    <div class="grid">
      <section class="panel">
        <h2>Now</h2>
        <p class="meta">Pinned: ${escapeHtml(model.pinned_mission ?? "(none)")}</p>
        <p class="meta">Readiness: ${escapeHtml(model.readiness_summary)}</p>
        ${model.next_step ? `<p class="meta">Next: <code>${escapeHtml(model.next_step)}</code></p>` : ""}
        ${renderBlockers(model)}
      </section>
      <section class="panel">
        <h2>What to do</h2>
        ${renderWhatToDo(model.last_verify, model.next_step)}
      </section>
    </div>
    <section class="panel" style="margin-top:1.25rem">
      <h2>Verify history (local ring)</h2>
      ${renderRuns(model.verify_runs)}
    </section>
    <section class="panel" style="margin-top:1.25rem">
      <h2>Recent missions</h2>
      <p class="meta" style="margin:-0.35rem 0 0.75rem">Last ${model.timeline.length} missions at HEAD — status is latest local verify when available.</p>
      ${renderTimeline(model)}
    </section>
  </main>
</body>
</html>`;
}
