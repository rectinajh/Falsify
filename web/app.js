const BASE_SEPOLIA_CHAIN_ID = "0x14a34";
const BASE_SEPOLIA_NAME = "Base Sepolia";
const state = { account: null, chainId: null, summary: {}, assertions: [], agents: [], settlements: [], evidence: [] };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
function fmt(n) {
  return Number(n ?? 0).toLocaleString("en-US");
}

// ---------- wallet ----------
function hasWallet() {
  return typeof window.ethereum !== "undefined";
}
async function connectWallet() {
  if (!hasWallet()) { alert("No wallet detected. Install MetaMask."); return null; }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    state.account = accounts[0];
    state.chainId = chainId;
    renderWallet();
    return accounts[0];
  } catch (e) {
    if (e.code !== 4001) alert("Wallet error: " + (e.message || e.code));
    return null;
  }
}
async function ensureBaseSepolia() {
  if (!hasWallet() || !state.account) return false;
  if (state.chainId === BASE_SEPOLIA_CHAIN_ID) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
    });
    state.chainId = BASE_SEPOLIA_CHAIN_ID;
    renderWallet();
    return true;
  } catch (e) {
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID, chainName: BASE_SEPOLIA_NAME, rpcUrls: ["https://sepolia.base.org"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
      });
      state.chainId = BASE_SEPOLIA_CHAIN_ID;
      renderWallet();
      return true;
    } catch (e2) {
      return false;
    }
  }
}
function renderWallet() {
  const btn = document.getElementById("connectBtn");
  const btn2 = document.getElementById("connectBtn2");
  const info = document.getElementById("walletInfo");
  const addr = document.getElementById("walletAddr");
  if (state.account) {
    btn.style.display = "none";
    btn2.textContent = "Wallet connected";
    info.style.display = "flex";
    addr.textContent = short(state.account);
    addr.title = state.account;
  } else {
    btn.style.display = "";
    btn2.textContent = "Connect wallet";
    info.style.display = "none";
  }
}
async function signMessage(msg) {
  const hex = "0x" + [...new TextEncoder().encode(msg)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return await window.ethereum.request({ method: "personal_sign", params: [hex, state.account] });
}

// ---------- data ----------
async function loadAll() {
  const [summary, assertions, agents, settlements, evidence] = await Promise.all([
    api("/api/summary"), api("/api/assertions"), api("/api/reputation"), api("/api/settlements"), api("/api/evidence"),
  ]);
  Object.assign(state, { summary, assertions, agents, settlements, evidence });
  render();
}

// ---------- render ----------
function badge(s) { return `<span class="badge ${esc(s)}">${esc(s)}</span>`; }
function verdictPill(v) {
  if (!v) return `<span class="muted">pending</span>`;
  return `<span class="verdict ${esc(v)}">${esc(v)}</span>`;
}

function renderStats() {
  const s = state.summary;
  const items = [
    ["Assertions", s.assertions], ["Falsified", s.falsified], ["Survived", s.survived],
    ["Total bounty", s.totalBounty], ["Platform fees", s.totalFees], ["Agents", s.agents],
  ];
  return items.map(([k, v]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${fmt(v)}</div></div>`).join("");
}

function renderAssertions() {
  const list = state.assertions.slice().reverse();
  if (!list.length) return `<div class="panel"><div class="empty">No assertions yet. Publish the first one above.</div></div>`;
  return list.map((a) => `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
        <div>
          <div class="muted mono" style="font-size:.8rem">#${a.id} · ${esc(a.claimType)} · ${fmt(a.bounty)} ${esc(a.currency)} · by ${esc(short(a.customer))}</div>
          <div style="margin-top:.35rem;font-weight:600">${esc(a.assertion)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.6rem">${badge(a.status)}
          <button class="btn btn-ghost" data-falsify="${a.id}" ${a.status === "falsified" ? "disabled" : ""}>Run falsification</button>
        </div>
      </div>
      ${a.counterexamples?.length ? `<table style="margin-top:1rem"><thead><tr><th>Counterexample</th><th>Verdict</th><th>Gemini</th></tr></thead><tbody>` +
        a.counterexamples.map((c) => `<tr><td class="mono" style="font-size:.8rem">${esc(c.hash?.slice(0, 16))}…</td><td>${verdictPill(c.verdict)}</td><td>${c.gemini?.called ? "yes" : "no"}</td></tr>`).join("") +
        `</tbody></table>` : `<div class="muted" style="margin-top:.8rem;font-size:.88rem">No counterexamples submitted yet.</div>`}
    </div>`).join("");
}

function renderReputation() {
  if (!state.agents.length) return `<div class="panel"><div class="empty">No reputation recorded yet.</div></div>`;
  const rows = state.agents.map((g) => `
    <tr><td class="mono">#${g.id}</td><td>${esc(g.name)}</td><td>${fmt(g.validCounterexamples)}</td><td>${fmt(g.falseClaimRate)}</td><td>${fmt(g.earned)}</td></tr>`).join("");
  return `<div class="panel"><table><thead><tr><th>Agent</th><th>Name</th><th>Valid counterexamples</th><th>False claims</th><th>Earned</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="margin:.8rem 0 0;font-size:.84rem">Written on-chain on settlement: +validCounterexamples when a counterexample falsifies, +falseClaimRate when it does not.</p></div>`;
}

function renderSettlements() {
  if (!state.settlements.length) return `<div class="panel"><div class="empty">No settlements yet.</div></div>`;
  const rows = state.settlements.map((s) => `
    <tr><td class="mono">#${s.assertionId}</td><td>${fmt(s.payout)}</td><td>${fmt(s.fee)}</td>
    <td>${s.txHash ? `<a class="tx" href="https://sepolia.basescan.org/tx/${esc(s.txHash)}" target="_blank">${esc(s.txHash.slice(0, 12))}…</a>` : `<span class="muted">simulated</span>`}</td></tr>`).join("");
  return `<div class="panel"><table><thead><tr><th>Assertion</th><th>Payout</th><th>Fee</th><th>Transaction</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="margin:.8rem 0 0;font-size:.84rem">Payout = bounty − 15% platform fee. On-chain tx links open Basescan.</p></div>`;
}

function renderEvidence() {
  const list = state.evidence.slice().reverse();
  if (!list.length) return `<div class="panel"><div class="empty">No evidence yet.</div></div>`;
  return list.map((e) => `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div><strong>#${esc(e.assertionId)}</strong> · ${esc(e.claimType)}</div>
        <div class="mono muted" style="font-size:.78rem">${esc(e.ts)}</div>
      </div>
      <div style="margin-top:.4rem">${esc(e.assertion)}</div>
      <div style="margin-top:.5rem">${verdictPill(e.verdict?.result)} <span class="muted" style="font-size:.82rem">exit ${esc(e.verdict?.exitCode)}</span></div>
      <pre>${esc(JSON.stringify(e, null, 2))}</pre>
    </div>`).join("");
}

function render() {
  document.getElementById("stats").innerHTML = renderStats();
  document.getElementById("assertionsList").innerHTML = renderAssertions();
  document.getElementById("reputationList").innerHTML = renderReputation();
  document.getElementById("settlementsList").innerHTML = renderSettlements();
  document.getElementById("evidenceList").innerHTML = renderEvidence();
  bind();
}

// ---------- interactions ----------
function bind() {
  document.querySelectorAll("[data-falsify]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.falsify;
      b.disabled = true; b.textContent = "Verifying…";
      try {
        const r = await api(`/api/assertions/${id}/falsify`, { method: "POST" });
        if (r.error) alert("error: " + r.error);
        await loadAll();
      } catch (e) {
        alert("error: " + e.message);
        b.disabled = false; b.textContent = "Run falsification";
      }
    });
  });
  const form = document.getElementById("publishForm");
  if (form) form.addEventListener("submit", publish);
}

async function publish(ev) {
  ev.preventDefault();
  if (!state.account) { await connectWallet(); if (!state.account) return; }
  const assertion = document.getElementById("p_assertion").value.trim();
  const claimType = document.getElementById("p_claimType").value;
  const bounty = Number(document.getElementById("p_bounty").value);
  const currency = document.getElementById("p_currency").value;
  const btn = ev.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Signing…";
  try {
    const msg = `Falsify: publish assertion "${assertion}" with bounty ${bounty} ${currency}`;
    const signature = await signMessage(msg);
    const rec = await api("/api/assertions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assertion, claimType, bounty, currency, customer: state.account, signature }),
    });
    document.getElementById("sigBox").style.display = "block";
    document.getElementById("sigAddr").textContent = short(state.account);
    await loadAll();
    document.getElementById("assertions").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    alert("error: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Sign & publish";
  }
}

// ---------- init ----------
document.getElementById("connectBtn").addEventListener("click", connectWallet);
document.getElementById("connectBtn2").addEventListener("click", connectWallet);
if (window.ethereum) {
  window.ethereum.on("accountsChanged", (accs) => { state.account = accs[0] ?? null; renderWallet(); });
  window.ethereum.on("chainChanged", (cid) => { state.chainId = cid; renderWallet(); });
}
loadAll().catch((e) => { document.getElementById("stats").innerHTML = `<div class="panel" style="color:var(--red)">Failed to load: ${esc(e.message)}</div>`; });
