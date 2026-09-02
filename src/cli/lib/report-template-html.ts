import type { ReportViewModel } from "./report-projector.js";
import { REPORT_CSS } from "./report-template-css.js";
import { escapeHtml, jsonScriptIsland, statusBadgeClass, statusBadgeLabel } from "./report-template-shared.js";

function renderRing(model: ReportViewModel): string {
  const source = model.digest_ring.length > 0 ? [...model.digest_ring] : ["—", "—", "—", "—"];
  while (source.length < 4) source.unshift("—");
  const visible = source.slice(-4);
  return visible
    .map((digest) => {
      const hit =
        model.ring_highlight && digest !== "—" && digest === model.findings_digest;
      const label = digest === "—" ? "—" : digest.slice(0, 6);
      return `<div class="ring-slot${hit ? " ring-slot--hit" : ""}" title="${escapeHtml(digest)}">${escapeHtml(label)}</div>`;
    })
    .join("");
}

function renderBars(model: ReportViewModel): string {
  if (model.phases.length === 0) return '<p class="meta">No phase timings recorded.</p>';
  return model.phases
    .map(
      (p) => /* html */ `<div class="bar-row">
  <span>${escapeHtml(p.id)}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${p.bar_pct}%"></div></div>
  <span>${p.duration_ms}ms</span>
</div>`,
    )
    .join("");
}

function renderFindings(model: ReportViewModel, expandFindings: boolean): string {
  if (model.findings.length === 0) {
    return '<p class="meta">No findings in this snapshot.</p>';
  }
  return model.findings
    .map(
      (f) => /* html */ `<details class="finding"${expandFindings ? " open" : ""}>
  <summary>${escapeHtml(f.failed_gate)} • ${escapeHtml(f.rule_id)} • ${escapeHtml(f.location)}</summary>
  <div class="finding-body">
    <p>${escapeHtml(f.resolution_hint)}</p>
    ${f.evidence ? `<pre class="evidence">${escapeHtml(f.evidence)}</pre>` : ""}
    <p class="fp">exact: ${escapeHtml(f.fingerprint)}</p>
    <p class="fp">semantic: ${escapeHtml(f.semantic_fingerprint)}</p>
  </div>
</details>`,
    )
    .join("");
}

export interface ReportRenderOptions {
  expandFindings?: boolean;
}

function renderHead(model: ReportViewModel): string {
  return /* html */ `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenGantry Report — ${escapeHtml(model.msn_id)}</title>
  <style>${REPORT_CSS}</style>`;
}

function renderHeader(model: ReportViewModel): string {
  return /* html */ `<header>
    <a class="nav-link" href="${escapeHtml(model.back_href)}">← Back to Overview</a>
    <h1>OpenGantry Report</h1>
    <span class="${statusBadgeClass(model.outcome)}">${escapeHtml(statusBadgeLabel(model.outcome))}</span>
    <span class="meta">${escapeHtml(model.msn_id)}</span>
    ${model.error_code ? `<span class="meta">${escapeHtml(model.error_code)}</span>` : ""}
  </header>`;
}

function renderStatusPanel(model: ReportViewModel): string {
  return /* html */ `<section class="panel status-panel">
      <span class="${statusBadgeClass(model.outcome)} status-panel__badge">${escapeHtml(statusBadgeLabel(model.outcome))}</span>
      <div class="status-panel__meta">
        <p class="status-panel__msn">${escapeHtml(model.msn_id)}</p>
        ${model.written_at ? `<p class="meta">Verified ${escapeHtml(model.written_at)}</p>` : ""}
        <p class="meta">Mission: ${escapeHtml(model.mission_file_path)}</p>
      </div>
    </section>`;
}

function renderBreakerPanel(model: ReportViewModel): string {
  const digestPreview = model.findings_digest
    ? `${escapeHtml(model.findings_digest.slice(0, 16))}…`
    : "—";
  return /* html */ `<section class="panel">
        <h2>Circuit breaker</h2>
        <div class="ring">${renderRing(model)}</div>
        <p class="meta">Recurrence in ring: ${model.ring_recurrence_count}</p>
        <p class="meta">Digest: ${digestPreview}</p>
      </section>`;
}

function renderDonutPanel(model: ReportViewModel): string {
  return /* html */ `<section class="panel">
        <h2>Failure breakdown</h2>
        <div class="donut-wrap">
          <div class="donut" style="background:conic-gradient(${model.donut.conic})"></div>
          <div class="legend">
            <span class="kpi">KPI ${model.donut.buckets.kpi}</span>
            <span class="error">Error ${model.donut.buckets.error}</span>
            <span class="warning">Warning ${model.donut.buckets.warning}</span>
          </div>
        </div>
      </section>`;
}

function renderTabs(model: ReportViewModel, expandFindings: boolean): string {
  const logTab = model.has_log
    ? '<button type="button" class="tab" data-tab="log">Gate log</button>'
    : "";
  const logView = model.has_log
    ? /* html */ `<div id="view-log" class="view">
  <div class="log-tools"><input type="search" id="log-filter" placeholder="Filter log lines…" aria-label="Filter log" /></div>
  <div id="log-pane" class="log-pane" aria-live="polite">Loading log…</div>
</div>`
    : "";
  return /* html */ `<div class="tabs" style="margin-top:1.25rem">
      <button type="button" class="tab tab--active" data-tab="findings">Findings</button>
      ${logTab}
    </div>
    <div id="view-findings" class="view view--active">${renderFindings(model, expandFindings)}</div>
    ${logView}`;
}

export function renderReportHtml(model: ReportViewModel, options: ReportRenderOptions = {}): string {
  const expandFindings = options.expandFindings === true;
  const metaJson = jsonScriptIsland({ has_log: model.has_log, log_href: model.log_href });
  return /* html */ `<!doctype html>
<html lang="en">
<head>
  ${renderHead(model)}
</head>
<body>
  ${renderHeader(model)}
  <p class="guide">
    <strong>How to read this view:</strong>
    PASS / FAIL / ABORT — ABORT means GXT_FINDINGS_RECURRED; stop the repair loop and escalate to Planner.
    Ring slots — last four semantic digests; highlighted slot = digest already in ring (breaker trip).
    Duration bars — verify phases (git_proof, interrogation, gate, defensive, kpi, trace), not per-linter steps.
    Donut — each finding counted once: kpi if failed_gate=kpi, else error or warning.
    Logs — last gate stdout/stderr; inspect-only; does not re-run verify.
  </p>
  <main>
    ${renderStatusPanel(model)}
    ${model.empty ? '<p class="empty">Run <code>gantry verify</code>, then refresh.</p>' : ""}
    <p class="meta">${escapeHtml(model.message)}</p>
    <div class="grid">
      ${renderBreakerPanel(model)}
      ${renderDonutPanel(model)}
    </div>
    <section class="panel" style="margin-top:1.25rem">
      <h2>Phase durations</h2>
      <div class="bars">${renderBars(model)}</div>
    </section>
    ${renderTabs(model, expandFindings)}
  </main>
  <script type="application/json" id="gxt-report-meta">${metaJson}</script>
  <script>${REPORT_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

const REPORT_CLIENT_SCRIPT = /* js */ `
(function () {
  const tabs = document.querySelectorAll(".tab");
  const views = { findings: document.getElementById("view-findings"), log: document.getElementById("view-log") };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("tab--active"));
      tab.classList.add("tab--active");
      Object.values(views).forEach((v) => v && v.classList.remove("view--active"));
      const id = tab.getAttribute("data-tab");
      if (id && views[id]) views[id].classList.add("view--active");
      if (id === "log") loadLog();
    });
  });
  let logLoaded = false;
  const metaEl = document.getElementById("gxt-report-meta");
  const meta = metaEl ? JSON.parse(metaEl.textContent || "{}") : {};
  const logHref = meta.log_href || "/log";
  function loadLog() {
    if (logLoaded) return;
    logLoaded = true;
    fetch(logHref).then((r) => r.ok ? r.text() : Promise.reject()).then((text) => {
      const pane = document.getElementById("log-pane");
      const lines = text.split(/\\n/);
      pane.innerHTML = lines.map((line, i) =>
        '<div class="log-line" data-text="' + line.replace(/"/g, "&quot;") + '">' +
        '<span class="log-n">' + (i + 1) + '</span><span class="log-t">' + line.replace(/</g, "&lt;") + '</span></div>'
      ).join("");
      const input = document.getElementById("log-filter");
      if (input) input.addEventListener("input", () => {
        const q = input.value.toLowerCase();
        pane.querySelectorAll(".log-line").forEach((row) => {
          const t = row.getAttribute("data-text") || "";
          row.style.display = !q || t.toLowerCase().includes(q) ? "" : "none";
        });
      });
    }).catch(() => {
      const pane = document.getElementById("log-pane");
      if (pane) pane.textContent = "Log unavailable.";
    });
  }
})();
`;
