const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const api = (path, init) => fetch("/admin/api" + path, init).then((r) => r.json());

const STATE = { agents: [], proposals: [], targets: [], spend: null };

async function refresh() {
  const [a, p, t, s] = await Promise.all([
    api("/agents"),
    api("/proposals?status=pending"),
    api("/targets"),
    api("/spend"),
  ]);
  STATE.agents = a.agents || [];
  STATE.proposals = p.proposals || [];
  STATE.targets = t.targets || [];
  STATE.spend = s;
  render();
}

function render() {
  renderKpis();
  renderProposals();
  renderAgents();
  renderTargets();
}

function renderKpis() {
  const enabledCount = STATE.agents.filter((a) => a.enabled).length;
  const pendingCount = STATE.proposals.length;
  const s = STATE.spend || { spentUsd: 0, capUsd: 0, calls: 0 };
  $("#kpis").innerHTML = `
    <div class="kpi"><div class="label">Pending</div><div class="val">${pendingCount}</div><div class="sub">awaiting review</div></div>
    <div class="kpi"><div class="label">Enabled agents</div><div class="val">${enabledCount}</div><div class="sub">of ${STATE.agents.length}</div></div>
    <div class="kpi"><div class="label">Targets</div><div class="val">${STATE.targets.filter(t => t.enabled).length}</div><div class="sub">tracked competitors</div></div>
    <div class="kpi"><div class="label">Spend today</div><div class="val">$${s.spentUsd.toFixed(4)}</div><div class="sub">of $${(s.capUsd||0).toFixed(2)} cap · ${s.calls||0} calls</div></div>
  `;
  $("#pendingCount").textContent = pendingCount ? `(${pendingCount})` : "";
}

function renderProposals() {
  const box = $("#pending");
  if (!STATE.proposals.length) {
    box.innerHTML = `<div class="empty">No pending proposals. Trigger an agent run or wait for the schedule.</div>`;
    return;
  }
  box.innerHTML = STATE.proposals
    .map(
      (p) => `
    <div class="proposal">
      <div>
        <h4>${esc(p.title)}</h4>
        <div class="meta">${esc(p.type)} · ${esc(p.id)} · ${new Date(p.createdAt).toLocaleString()}</div>
        <p>${esc(p.summary)}</p>
      </div>
      <div class="row-actions">
        <button class="btn-sm" data-action="view" data-id="${esc(p.id)}">View</button>
        <button class="btn-sm primary" data-action="approve" data-id="${esc(p.id)}">Approve</button>
        <button class="btn-sm danger" data-action="reject" data-id="${esc(p.id)}">Reject</button>
      </div>
    </div>`
    )
    .join("");
  box.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => handleProposalAction(b.dataset.action, b.dataset.id))
  );
}

function renderAgents() {
  $("#agents").innerHTML = STATE.agents
    .map(
      (a) => `
    <div class="agent-row">
      <div>
        <h4>${esc(a.name)} <span class="status-pill ${a.enabled ? "approved" : ""}">${a.enabled ? "enabled" : "disabled"}</span></h4>
        <div class="meta">${esc(a.type)} · ${esc(a.id)} · cron <code>${esc(a.schedule || "—")}</code>${a.config?.stub ? " · STUB (Phase 2)" : ""}</div>
      </div>
      <div class="row-actions">
        <label class="toggle"><input type="checkbox" data-action="toggle" data-id="${esc(a.id)}" ${a.enabled ? "checked" : ""}/> on</label>
        <button class="btn-sm dark" data-action="run" data-id="${esc(a.id)}" ${a.config?.stub ? "disabled" : ""}>Run now</button>
      </div>
    </div>`
    )
    .join("");
  $("#agents").querySelectorAll("input,button").forEach((el) =>
    el.addEventListener("click", () => handleAgentAction(el.dataset.action, el.dataset.id, el))
  );
}

function renderTargets() {
  if (!STATE.targets.length) {
    $("#targets").innerHTML = `<div class="empty">No targets yet. Run <code>node bin/agents.js add-target &lt;name&gt; &lt;domain&gt;</code>.</div>`;
    return;
  }
  $("#targets").innerHTML = STATE.targets
    .map(
      (t) => `
    <div class="target-row">
      <div>
        <h4>${esc(t.name)} <span class="status-pill ${t.enabled ? "approved" : ""}">${t.enabled ? "enabled" : "disabled"}</span></h4>
        <div class="meta">${esc(t.domain)} · ${esc(t.id)}</div>
      </div>
      <div class="row-actions"><span class="meta">manage via CLI</span></div>
    </div>`
    )
    .join("");
}

async function handleProposalAction(action, id) {
  if (action === "view") return openDetail(id);
  if (action === "approve" || action === "reject") {
    await api(`/proposals/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: action === "approve" ? "approved" : "rejected" }),
    });
    refresh();
  }
}

async function handleAgentAction(action, id, el) {
  if (action === "toggle") {
    await api(`/agents/${id}/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: el.checked }),
    });
    refresh();
  } else if (action === "run") {
    el.disabled = true;
    el.textContent = "Running…";
    await api(`/agents/${id}/run`, { method: "POST" });
    setTimeout(() => refresh(), 2500); // give the background run a head start
    setTimeout(() => { el.disabled = false; el.textContent = "Run now"; }, 4000);
  }
}

async function openDetail(id) {
  const { proposal, logs } = await api(`/proposals/${id}`);
  if (!proposal) return;
  $("#drawerBody").innerHTML = `
    <h3 style="margin-top:0;font-family:var(--font-serif);font-weight:400;font-size:24px">${esc(proposal.title)}</h3>
    <p style="color:var(--ink-3);font-size:12px;font-family:var(--font-mono)">${esc(proposal.type)} · ${esc(proposal.id)} · run ${esc(proposal.runId)}</p>
    <p>${esc(proposal.summary)}</p>
    <h4>Payload</h4>
    <pre class="payload-pre">${esc(JSON.stringify(proposal.payload, null, 2))}</pre>
    <h4>Agent log (${logs.length} entr${logs.length === 1 ? "y" : "ies"})</h4>
    ${logs.map((l) => `<div class="log-entry ${esc(l.type)}"><b>${esc(l.type)}</b> · ${esc(l.at)}\n${esc(JSON.stringify(l.content, null, 2))}</div>`).join("")}
  `;
  $("#detailDrawer").setAttribute("aria-hidden", "false");
}

$("#drawerClose").addEventListener("click", () => $("#detailDrawer").setAttribute("aria-hidden", "true"));

refresh();
setInterval(refresh, 15_000);
