export const REPORT_CSS = /* css */ `
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --pass: #3fb950;
  --fail: #f85149;
  --abort: #d29922;
  --accent: #58a6ff;
  --kpi: #c9a227;
  --error: #e5534b;
  --warning: #d29922;
  --font: ui-sans-serif, system-ui, sans-serif;
  --mono: ui-monospace, "Cascadia Code", monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.nav-link { color: var(--accent); text-decoration: none; font-size: 0.875rem; }
.nav-link:hover { text-decoration: underline; }
h1 { margin: 0; font-size: 1.25rem; }
.badge {
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}
.badge--pass { background: color-mix(in srgb, var(--pass) 25%, transparent); color: var(--pass); }
.badge--fail { background: color-mix(in srgb, var(--fail) 25%, transparent); color: var(--fail); }
.badge--abort { background: color-mix(in srgb, var(--abort) 25%, transparent); color: var(--abort); }
.badge--empty { background: var(--surface); color: var(--muted); }
.meta { color: var(--muted); font-size: 0.875rem; }
.guide {
  margin: 0;
  padding: 0.75rem 1.5rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--muted);
}
.guide strong { color: var(--text); }
main { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }
.grid { display: grid; gap: 1.25rem; grid-template-columns: 1fr 1fr; }
@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
}
.panel h2 { margin: 0 0 0.75rem; font-size: 0.9375rem; }
.ring { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.ring-slot {
  width: 3rem;
  height: 2rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--mono);
  font-size: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--muted);
}
.ring-slot--hit { border-color: var(--abort); color: var(--abort); }
.bars { display: flex; flex-direction: column; gap: 0.5rem; }
.bar-row { display: grid; grid-template-columns: 6rem 1fr 3rem; gap: 0.5rem; align-items: center; font-size: 0.8125rem; }
.bar-track { background: var(--bg); border-radius: 4px; height: 0.75rem; overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 4px; }
.donut-wrap { display: flex; gap: 1rem; align-items: center; }
.donut {
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend { font-size: 0.8125rem; color: var(--muted); }
.legend span { display: block; margin-bottom: 0.25rem; }
.legend .kpi::before { content: "■ "; color: var(--kpi); }
.legend .error::before { content: "■ "; color: var(--error); }
.legend .warning::before { content: "■ "; color: var(--warning); }
.tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tab {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8125rem;
}
.tab--active { border-color: var(--accent); color: var(--accent); }
.view { display: none; }
.view--active { display: block; }
details.finding {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  background: var(--surface);
}
details.finding summary {
  padding: 0.6rem 0.75rem;
  cursor: pointer;
  font-size: 0.8125rem;
  font-family: var(--mono);
}
.finding-body { padding: 0 0.75rem 0.75rem; font-size: 0.8125rem; }
.evidence {
  background: var(--bg);
  border-radius: 4px;
  padding: 0.5rem;
  font-family: var(--mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
  overflow-x: auto;
}
.fp { color: var(--muted); font-family: var(--mono); font-size: 0.6875rem; word-break: break-all; }
.log-tools { margin-bottom: 0.5rem; }
.log-tools input {
  width: 100%;
  padding: 0.4rem 0.6rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.8125rem;
}
.log-pane {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 24rem;
  overflow: auto;
  font-family: var(--mono);
  font-size: 0.75rem;
  padding: 0.5rem 0;
}
.log-line { display: flex; gap: 0.5rem; padding: 0 0.5rem; }
.log-line:hover { background: var(--surface); }
.log-n { color: var(--muted); min-width: 2.5rem; text-align: right; user-select: none; }
.empty { text-align: center; color: var(--muted); padding: 2rem; }
.status-panel {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.status-panel__badge { font-size: 0.875rem; padding: 0.4rem 0.9rem; flex-shrink: 0; }
.status-panel__msn { margin: 0 0 0.25rem; font-weight: 600; font-family: var(--mono); font-size: 1rem; }
.status-panel__meta p { margin: 0.15rem 0; }
`;

export const OVERVIEW_CSS = /* css */ `
.glance { margin-bottom: 1.25rem; }
.glance-grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(3, 1fr); }
@media (max-width: 900px) { .glance-grid { grid-template-columns: 1fr; } }
.glance-cell h2 { margin: 0 0 0.65rem; font-size: 0.9375rem; }
.glance-detail { margin: 0.35rem 0 0.5rem; font-size: 0.8125rem; }
.glance-stat { margin: 0 0 0.35rem; font-size: 0.9375rem; }
.glance-breakdown { margin: 0; font-size: 0.875rem; }
.glance-pass { color: var(--pass); }
.glance-fail { color: var(--fail); }
.glance-abort { color: var(--abort); }
.status-row { display: flex; align-items: center; gap: 0.65rem; margin: 0 0 0.5rem; flex-wrap: wrap; }
.badge--pin { font-size: 0.625rem; text-transform: lowercase; }
.run-history { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.run-history th, .run-history td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
.run-history th:last-child, .run-history td:last-child { text-align: right; white-space: nowrap; }
.run-when { white-space: nowrap; font-family: var(--mono); font-size: 0.75rem; }
.run-summary { max-width: 18rem; font-size: 0.8125rem; color: var(--text); }
.run-findings { color: var(--fail); font-weight: 600; }
.run-error { font-family: var(--mono); font-size: 0.75rem; color: var(--abort); }
.run-row:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.timeline { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.timeline th, .timeline td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
.blockers { margin: 0; padding-left: 1.2rem; font-size: 0.8125rem; color: var(--muted); }
`;

export const REPORT_PAGE_CSS = `${REPORT_CSS}\n${OVERVIEW_CSS}`;
