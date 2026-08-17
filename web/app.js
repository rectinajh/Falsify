const state = { summary: {}, assertions: [], agents: [], settlements: [], evidence: [], active: "dashboard" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadAll() {
  const [summary, assertions, agents, settlements, evidence] = await Promise.all([
    api("/api/summary"),
    api("/api/assertions"),
    api("/api/reputation"),
    api("/api/settlements"),
    api("/api/evidence"),
  ]);
  Object.assign(state, { summary, assertions, agents, settlements, evidence });
  render();
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-US");
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

function verdictPill(v) {
  if (!v) return `<span class="muted">pending</span>`;
  return `<span class="verdict-pill ${esc(v)}">${esc(v)}</span>`;
}

function renderDashboard() {
  const s = state.summary;
  return `
    <div class="grid">
      <div class="stat"><div class="k">Assertions</div><div class="v">${fmt(s.assertions)}</div></div>
      <div class="stat"><div class="k">Open</div><div class="v">${fmt(s.open)}</div></div>
      <div class="stat"><div class="k">Falsified</div><div class="v">${fmt(s.falsified)}</div></div>
      <div class="stat"><div class="k">Survived</div><div class="v">${fmt(s.survived)}</div></div>
      <div class="stat"><div class="k">Total bounty</div><div class="v">${fmt(s.totalBounty)}</div></div>
      <div class="stat"><div class="k">Platform fees</div><div class="v">${fmt(s.totalFees)}</div></div>
    </div>
    <div class="panel">
      <h2>How it works</h2>
      <p class="muted">A customer escrows a bounty behind an assertion and a committed test. Adversarial
      agents try to falsify it. A deterministic verifier — never an LLM — decides the verdict. Only a
      proven counterexample releases the bounty; the platform takes a 15% fee and writes ERC-8004 reputation.</p>
    </div>
    <div class="panel">
      <h2>Recent assertions</h2>
      ${renderAssertionTable(state.assertions.slice().reverse().slice(0, 8))}
    </div>`;
}

function renderPublish() {
  return `
    <div class="panel">
      <h2>Publish an assertion</h2>
      <form id="publishForm">
        <label>Claim type</label>
        <select id="p_claimType">
          <option value="correctness">Correctness — Gemini generates the counterexample</option>
          <option value="security">Security — deterministic attack harness</option>
        </select>
        <label>Assertion</label>
        <textarea id="p_assertion">Math.add(a, b) returns a + b for all non-negative integers a, b.</textarea>
        <div class="row">
          <div><label>Bounty</label><input id="p_bounty" type="number" value="100" min="1"></div>
          <div><label>Currency</label><select id="p_currency"><option value="ETH">ETH</option><option value="USDC">USDC</option></select></div>
        </div>
        <div style="margin-top:1rem"><button class="btn" type="submit">Escrow bounty & publish</button></div>
      </form>
    </div>
    <div class="panel"><h2>Published</h2>${renderAssertionTable(state.assertions)}</div>`;
}

function renderAssertions() {
  const items = state.assertions
    .slice()
    .reverse()
    .map((a) => `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
          <div>
            <div class="mono" style="color:var(--muted)">#${a.id} · ${esc(a.claimType)} · ${fmt(a.bounty)} ${esc(a.currency)}</div>
            <div style="margin-top:.25rem">${esc(a.assertion)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:.6rem">${badge(a.status)}
            <button class="btn" data-falsify="${a.id}" ${a.status === "falsified" ? "disabled" : ""}>Run falsification</button>
          </div>
        </div>
        <div style="margin-top:.9rem">${renderCounterexamples(a)}</div>
      </div>`).join("");
  return items || `<div class="panel"><div class="empty">No assertions yet. Publish one first.</div></div>`;
}

function renderCounterexamples(a) {
  if (!a.counterexamples?.length) return `<div class="muted">No counterexamples submitted.</div>`;
  return `<table><thead><tr><th>Hash</th><th>Verdict</th><th>Gemini</th><th>Test</th></tr></thead><tbody>` +
    a.counterexamples.map((c) => `
      <tr>
        <td class="mono">${esc(c.hash?.slice(0, 14))}…</td>
        <td>${verdictPill(c.verdict)}</td>
        <td>${c.gemini?.called ? "yes" : "no"}</td>
        <td class="mono">${esc(c.testRef ?? "—")}</td>
      </tr>`).join("") +
    `</tbody></table>`;
}

function renderAssertionTable(list) {
  if (!list?.length) return `<div class="empty">No assertions.</div>`;
  return `<table><thead><tr><th>#</th><th>Claim</th><th>Type</th><th>Bounty</th><th>Status</th></tr></thead><tbody>` +
    list.map((a) => `
      <tr>
        <td class="mono">${a.id}</td>
        <td>${esc(a.assertion)}</td>
        <td>${esc(a.claimType)}</td>
        <td>${fmt(a.bounty)} ${esc(a.currency)}</td>
        <td>${badge(a.status)}</td>
      </tr>`).join("") +
    `</tbody></table>`;
}

function renderReputation() {
  const rows = state.agents.map((g) => `
    <tr>
      <td class="mono">#${g.id}</td>
      <td>${esc(g.name)}</td>
      <td>${fmt(g.validCounterexamples)}</td>
      <td>${fmt(g.falseClaimRate)}</td>
      <td>${fmt(g.earned)}</td>
    </tr>`).join("");
  return `<div class="panel"><h2>ERC-8004 agent reputation</h2>
    ${state.agents.length ? `<table><thead><tr><th>ID</th><th>Agent</th><th>Valid counterexamples</th><th>False claims</th><th>Earned</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No reputation recorded yet.</div>`}
    <p class="muted" style="margin-top:1rem">Reputation is written on settlement: +validCounterexamples when a counterexample falsifies, +falseClaimRate when it does not.</p>
  </div>`;
}

function renderSettlements() {
  const rows = state.settlements.map((s) => `
    <tr>
      <td class="mono">#${s.assertionId}</td>
      <td class="mono">${esc(s.counterexampleHash?.slice(0, 14))}…</td>
      <td>${fmt(s.payout)}</td>
      <td>${fmt(s.fee)}</td>
      <td class="mono">${esc(s.txHash ? s.txHash.slice(0, 14) + "…" : "simulated (no chain)")}</td>
      <td class="mono">${esc(s.ts)}</td>
    </tr>`).join("");
  return `<div class="panel"><h2>Settlements</h2>
    ${state.settlements.length ? `<table><thead><tr><th>Assertion</th><th>Counterexample</th><th>Payout</th><th>Fee</th><th>Tx</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No settlements yet.</div>`}
    <p class="muted" style="margin-top:1rem">Payout = bounty − 15% platform fee. "simulated" means no local chain is wired; run scripts/dev-chain.sh to settle on-chain via cast.</p>
  </div>`;
}

function renderEvidence() {
  const rows = state.evidence.slice().reverse().map((e) => `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div><strong>#${esc(e.assertionId)}</strong> · ${esc(e.claimType)}</div>
        <div class="mono muted">${esc(e.ts)}</div>
      </div>
      <div style="margin-top:.5rem">${esc(e.assertion)}</div>
      <div style="margin-top:.5rem">${verdictPill(e.verdict?.result)} <span class="muted">exit ${esc(e.verdict?.exitCode)}</span></div>
      <pre>${esc(JSON.stringify(e, null, 2))}</pre>
    </div>`).join("");
  return `<div class="panel"><h2>Evidence ledger</h2><p class="muted">Assertion → counterexample → deterministic verdict, appended per run (also in data/evidence.jsonl).</p></div>${rows || `<div class="panel"><div class="empty">No evidence yet.</div></div>`}`;
}

function render() {
  const view = document.getElementById("view");
  const map = {
    dashboard: renderDashboard,
    publish: renderPublish,
    assertions: renderAssertions,
    reputation: renderReputation,
    settlements: renderSettlements,
    evidence: renderEvidence,
  };
  view.innerHTML = (map[state.active] || renderDashboard)();
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-falsify]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.falsify;
      b.disabled = true;
      b.textContent = "Running…";
      try {
        const r = await api(`/api/assertions/${id}/falsify`, { method: "POST" });
        if (r.error) alert("error: " + r.error);
        await loadAll();
      } catch (e) {
        alert("error: " + e.message);
        b.disabled = false;
        b.textContent = "Run falsification";
      }
    });
  });
  const form = document.getElementById("publishForm");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Publishing…";
      try {
        await api("/api/assertions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assertion: document.getElementById("p_assertion").value,
            claimType: document.getElementById("p_claimType").value,
            bounty: Number(document.getElementById("p_bounty").value),
            currency: document.getElementById("p_currency").value,
          }),
        });
        state.active = "assertions";
        document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === "assertions"));
        await loadAll();
      } catch (e) {
        alert("error: " + e.message);
        btn.disabled = false;
        btn.textContent = "Escrow bounty & publish";
      }
    });
  }
}

document.getElementById("nav").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-view]");
  if (!btn) return;
  state.active = btn.dataset.view;
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x === btn));
  render();
});

loadAll().catch((e) => {
  document.getElementById("view").innerHTML = `<div class="panel" style="color:var(--red)">Failed to load: ${esc(e.message)}. Is the backend running?</div>`;
});
