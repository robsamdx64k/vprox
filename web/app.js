(function(){
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const THEME_KEY = "vprox.theme";
  const themeBtn = $("#themeToggle");

  function applyTheme(theme){
    const t = (theme === "light") ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    if (themeBtn) themeBtn.textContent = (t === "light") ? "☀️" : "🌙";
  }

  function loadTheme(){
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    // default to dark, but honor OS preference if user never set a choice
    try{
      return (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
    }catch(e){ return "dark"; }
  }

  function toggleTheme(){
    const cur = document.documentElement.dataset.theme || "dark";
    const next = (cur === "light") ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  applyTheme(loadTheme());
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const views = {
    status: $("#view-status"),
    miners: $("#view-miners"),
    alerts: $("#view-alerts"),
    metrics: $("#view-metrics"),
  };
  const badge = $("#connBadge");
  const alertsNavBadge = $("#alertsNavBadge");
  const nowEl = $("#now");
  const dialog = $("#minerDialog");
  const dialogSub = $("#minerDialogSub");
  const dialogBody = $("#minerDialogBody");

  function fmtInt(n){ return (n ?? 0).toLocaleString(); }
  function fmtMs(n){
    if (n == null || !isFinite(n)) return "—";
    if (n < 1000) return `${Math.round(n)} ms`;
    return `${(n/1000).toFixed(2)} s`;
  }
  function fmtAgo(ts){
    if (!ts) return "—";
    const t = new Date(ts).getTime();
    if (!isFinite(t)) return "—";
    const s = Math.max(0, (Date.now() - t)/1000);
    if (s < 60) return `${Math.floor(s)}s`;
    const m = s/60;
    if (m < 60) return `${Math.floor(m)}m`;
    const h = m/60;
    if (h < 48) return `${Math.floor(h)}h`;
    const d = h/24;
    return `${Math.floor(d)}d`;
  }

  // Uptime formatting:
  //  - < 1 day:  HH:MM:SS
  //  - >= 1 day: Xd HH:MM:SS
  function fmtUptime(seconds){
    seconds = Math.floor(seconds ?? 0);
    if (!isFinite(seconds) || seconds < 0) seconds = 0;

    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    const pad = (n) => String(n).padStart(2, "0");
    if (days >= 1) return `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }

  // Display a cleaner "worker" label in the table.
  // Many miners authorize as "WALLET.worker"; we show only the suffix after the first dot.
  // The full value is still available in the miner details modal.
  function getThemeLineColor(){
    // Use current text color as a reasonable default for canvas line stroke in both themes.
    try { return getComputedStyle(document.body).color || "#9ad"; } catch(e){ return "#9ad"; }
  }

  function drawBigChart(canvas, points, windowMin){
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width || 920;
    const h = canvas.height || 280;
    ctx.clearRect(0, 0, w, h);

    const now = Date.now();
    const cutoff = now - (Number(windowMin || 60) * 60 * 1000);
    const pts = (points || []).filter(p => p && p.t >= cutoff);

    // background
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0,0,w,h);

    const padL = 46, padR = 14, padT = 12, padB = 30;

    if (pts.length < 2){
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "14px system-ui";
      ctx.fillText("Not enough data yet…", padL, padT + 18);
      return;
    }

    const xs = pts.map(p => p.t);
    const ys = pts.map(p => p.v);

    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
    const yPad = (yMax - yMin) * 0.18 || 1;
    const Y0 = Math.max(0, yMin - yPad);
    const Y1 = yMax + yPad;

    const xTo = t => padL + ((t - xMin) / Math.max(1, (xMax - xMin))) * (w - padL - padR);
    const yTo = v => padT + (1 - ((v - Y0) / Math.max(1e-6, (Y1 - Y0)))) * (h - padT - padB);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i=0;i<=4;i++){
      const yy = padT + i * ((h - padT - padB)/4);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
    }

    // y labels (top/bottom)
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px system-ui";
    ctx.fillText(String(Math.round(Y1)), 10, padT + 10);
    ctx.fillText(String(Math.round(Y0)), 10, h - padB);

    // x labels (start/end)
    const fmtTime = (t) => {
      const d = new Date(t);
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      return `${hh}:${mm}`;
    };
    ctx.fillText(fmtTime(xMin), padL, h - 10);
    const endLbl = fmtTime(xMax);
    const tw = ctx.measureText(endLbl).width;
    ctx.fillText(endLbl, w - padR - tw, h - 10);

    // line
    ctx.strokeStyle = getThemeLineColor();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xTo(pts[0].t), yTo(pts[0].v));
    for (let i=1;i<pts.length;i++){
      ctx.lineTo(xTo(pts[i].t), yTo(pts[i].v));
    }
    ctx.stroke();

    // last point
    const last = pts[pts.length-1];
    ctx.fillStyle = getThemeLineColor();
    ctx.beginPath();
    ctx.arc(xTo(last.t), yTo(last.v), 3, 0, Math.PI*2);
    ctx.fill();
  }

  function getWorkerAggregates(items, workerShort){
    const agg = { miners: 0, submitted: 0, accepted: 0, rejected: 0, avgLatencyMs: null, software: new Set() };
    let latSum = 0, latCnt = 0;
    for (const m of (items || [])){
      const w = shortWorkerName(m.workerName);
      if (w !== workerShort) continue;
      agg.miners += 1;
      agg.submitted += Number(m.submitted) || 0;
      agg.accepted += Number(m.accepted) || 0;
      agg.rejected += Number(m.rejected) || 0;
      if (m.avgSubmitLatencyMs != null){
        const v = Number(m.avgSubmitLatencyMs);
        if (isFinite(v) && v > 0){ latSum += v; latCnt += 1; }
      }
      if (m.software) agg.software.add(String(m.software));
    }
    if (latCnt) agg.avgLatencyMs = latSum / latCnt;
    agg.software = Array.from(agg.software).slice(0, 5);
    return agg;
  }

  function openWorkerChart(workerShort){
    const dlg = $("#workerChartDialog");
    if (!dlg) return;
    const title = $("#workerChartTitle");
    const sub = $("#workerChartSub");
    const winSel = $("#workerChartWindow");
    const canvas = $("#workerChartCanvas");
    const stats = $("#workerChartStats");

    const windowMin = Number(winSel?.value || 60);
    if (title) title.textContent = workerShort || "Worker";
    if (sub) sub.textContent = `Last ${windowMin} minutes`;

    const series = workerSeries.get(workerShort);
    const points = series ? series.points : [];
    drawBigChart(canvas, points, windowMin);

    // Aggregate stats from current miner list snapshot
    const items = minerState.lastData?.items || minerState.lastData?.miners || [];
    const a = getWorkerAggregates(items, workerShort);
    if (stats){
      const lat = a.avgLatencyMs != null ? `${Math.round(a.avgLatencyMs)} ms` : "—";
      const sw = a.software.length ? a.software.join(", ") : "—";
      stats.innerHTML = `
        <div class="stat"><b>Connections:</b> ${a.miners}</div>
        <div class="stat"><b>Submitted:</b> ${fmtInt(a.submitted)}</div>
        <div class="stat"><b>Accepted:</b> ${fmtInt(a.accepted)}</div>
        <div class="stat"><b>Rejected:</b> ${fmtInt(a.rejected)}</div>
        <div class="stat"><b>Avg Share Lat:</b> ${lat}</div>
        <div class="stat"><b>Software:</b> ${escapeHtml(sw)}</div>
      `;
    }

    // redraw on window change while open
    if (winSel && !winSel.__wired){
      winSel.__wired = true;
      winSel.addEventListener("change", () => openWorkerChart(workerShort));
    }

    dlg.showModal();
  }


  function shortWorkerName(name){
    if (!name) return "—";
    const s = String(name);
    const i = s.indexOf('.');
    if (i === -1) return s;
    const suffix = s.slice(i + 1);
    return suffix || s;
  }

  // -----------------------------
  // Per-worker mini charts
  // -----------------------------
  // We build short sparklines client-side by sampling /miners on each refresh.
  // This keeps the backend simple while still giving an at-a-glance trend.
  //
  // Keyed by the *display* worker name (shortWorkerName).
  const workerSeries = new Map();

  function updateWorkerSeries(items){
    const now = Date.now();
    // Aggregate accepted shares per worker
    const agg = new Map();
    for (const m of (items || [])){
      const w = shortWorkerName(m.workerName);
      if (!w || w === "—") continue;
      const cur = agg.get(w) || 0;
      agg.set(w, cur + (Number(m.accepted) || 0));
    }

    for (const [w, accepted] of agg.entries()){
      const prev = workerSeries.get(w);
      if (!prev){
        workerSeries.set(w, { lastAccepted: accepted, lastTs: now, points: [] });
        continue;
      }
      const dtSec = Math.max(1, (now - prev.lastTs) / 1000);
      const delta = accepted - (prev.lastAccepted || 0);
      // Shares per minute as a simple trend metric
      const spm = Math.max(0, delta) * (60 / dtSec);
      prev.points.push({ t: now, v: spm });
        // Keep last 60 minutes of points (cap for safety)
      const cutoff = now - (60 * 60 * 1000);
      while (prev.points.length && prev.points[0].t < cutoff) prev.points.shift();
      if (prev.points.length > 720) prev.points.splice(0, prev.points.length - 720);
      prev.lastAccepted = accepted;
      prev.lastTs = now;
    }
  }

  function drawSpark(canvas, points){
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width || 90;
    const h = canvas.height || 18;
    ctx.clearRect(0, 0, w, h);

    const p = (points && points.length) ? points : [];
    if (p.length < 2){
      // draw a faint baseline
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, h-2, w, 1);
      ctx.globalAlpha = 1;
      return;
    }

    // scale
    const max = Math.max(1e-6, Math.max(...p));
    const min = 0;
    const dx = w / (p.length - 1);

    ctx.lineWidth = 1;
    // Use current text color (CSS) via strokeStyle = "currentColor" isn't supported on canvas.
    // Instead, approximate with a neutral light stroke; theme keeps background dark/light.
    ctx.strokeStyle = "rgba(120, 200, 255, 0.9)";
    ctx.beginPath();
    for (let i=0;i<p.length;i++){
      const v = p[i];
      const y = h - 2 - ((v - min) / (max - min)) * (h - 4);
      const x = i * dx;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // fill under curve lightly
    ctx.lineTo(w, h-2);
    ctx.lineTo(0, h-2);
    ctx.closePath();
    ctx.fillStyle = "rgba(120, 200, 255, 0.15)";
    ctx.fill();
  }

  // Classify miner type from the reported software string.
  // Used to color the Software pill in the Miners table.
  function classifyMinerType(software){
    const s = String(software || "").toLowerCase();

    // GPU miners (common)
    if (
      s.includes("teamredminer") || s.includes("trm") ||
      s.includes("lolminer") || s.includes("gminer") ||
      s.includes("nbminer") || s.includes("bzminer") ||
      s.includes("t-rex") || s.includes("trex") ||
      s.includes("phoenix") ||
      s.includes("srbminer") || s.includes("srb miner") ||
      s.includes("xmrig-nvidia") || s.includes("xmrig-amd")
    ) return "gpu";

    // CPU miners (common)
    if (
      s.includes("xmrig") || s.includes("cpuminer") ||
      s.includes("cpu") || s.includes("verushash")
    ) return "cpu";

    // ASIC / firmware-ish (rare for Verus, but safe)
    if (
      s.includes("asic") || s.includes("braiins") ||
      s.includes("bosminer") || s.includes("cgminer") ||
      s.includes("bfgminer")
    ) return "asics";

    return "unknown";
  }

  function setBadge(ok, msg){
    badge.textContent = msg;
    badge.classList.remove("good","bad");
    badge.classList.add(ok ? "good" : "bad");
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }
  async function fetchText(url){
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }

  function showView(name){
    $$(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
    window.location.hash = name;
  }

  let lastStatus = null;
  let lastAlerts = null;

  let seenActiveAlertKeys = new Set();

  function alertKey(a){
    if (!a) return "";
    return String(a.id || `${a.type||"alert"}:${a.key||a.minerKey||a.poolName||a.workerName||a.message||""}`);
  }

  function ensureToastContainer(){
    let c = document.getElementById("toastContainer");
    if (!c){
      c = document.createElement("div");
      c.id = "toastContainer";
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(a){
    const c = ensureToastContainer();
    const el = document.createElement("div");
    const lvl = (a && a.level) ? String(a.level) : "info";
    el.className = `toast ${lvl}`;
    const title = (a && a.title) ? a.title : (a && a.type) ? a.type : "Alert";
    const msg = (a && a.message) ? a.message : "";
    el.innerHTML = `
      <div class="toastHead">
        <div class="toastTitle">${escapeHtml(title)}</div>
        <button class="toastClose" aria-label="Close">×</button>
      </div>
      <div class="toastMsg">${escapeHtml(msg)}</div>
      <div class="toastMeta">${escapeHtml(lvl.toUpperCase())} • ${fmtAgo(a.updatedAt || a.createdAt || Date.now())}</div>
    `;
    el.querySelector(".toastClose").addEventListener("click", ()=> el.remove());
    c.appendChild(el);
    // auto-dismiss
    setTimeout(()=>{ if (el.isConnected) el.remove(); }, 7000);
  }

  function notifyNewActiveAlerts(alertsData){
    const active = (alertsData && Array.isArray(alertsData.alerts)) ? alertsData.alerts.filter(x=>x.active) : [];
    const nextKeys = new Set(active.map(alertKey));
    // pop new ones
    for (const a of active){
      const k = alertKey(a);
      if (k && !seenActiveAlertKeys.has(k)){
        showToast(a);
      }
    }
    seenActiveAlertKeys = nextKeys;
  }

  // ---------- Status ----------
  function renderStatus(data, alertsData){
    const totals = data?.totals || {};
    const workers = data?.workers || [];
    const activeAlerts = (alertsData && Array.isArray(alertsData.alerts))
      ? alertsData.alerts.filter(a=>a.active)
      : [];
    const pool = data?.poolState?.activePool;
    const poolLabel = pool ? `${pool.name || "pool"} (${pool.host}:${pool.port})` : "—";
    const kpis = [
      ["Version", data?.version ?? "—"],
      ["Uptime", fmtUptime(data?.uptimeSec ?? 0)],
      ["Threads", fmtInt(data?.threads ?? workers.length)],
      ["Connected Miners", fmtInt(totals?.miners)],
      ["Mining Workers", fmtInt(totals?.miningWorkers ?? data?.poolState?.miningWorkers ?? totals?.miningWorkers)],
      ["Active Pool", poolLabel],
      ["Submitted", fmtInt(totals?.submitted)],
      ["Accepted", fmtInt(totals?.accepted)],
      ["Rejected", fmtInt(totals?.rejected)],
      ["Avg submit latency", fmtMs(totals?.avgSubmitLatencyMs)],
    ];

    const kpiHtml = kpis.map(([label,value]) => `
      <div class="kpi">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
      </div>
    `).join("");


    // Pool switch controls (manual override)
    const pools = data?.poolState?.pools || [];
    let poolControlsHtml = "";
    if (Array.isArray(pools) && pools.length > 0) {
      const activeIdx = data?.poolState?.activePoolIndex ?? 0;
      const opts = pools.map((p, i) => {
        const label = `${p.name || `pool${i}`} (${p.host}:${p.port})`;
        const sel = (i === activeIdx) ? "selected" : "";
        const val = escapeAttr(p.name || String(i));
        return `<option value="${val}" ${sel}>${escapeHtml(label)}</option>`;
      }).join("");

      poolControlsHtml = `
        <div class="controls" style="margin-top:12px">
          <div class="muted small">Switch upstream pool:</div>
          <select id="poolSelect" class="select" style="min-width:340px">${opts}</select>
          <button id="poolSwitchBtn" class="btn">Switch pool</button>
          <span id="poolSwitchMsg" class="muted small"></span>
        </div>
      `;
    }

    const rows = workers.map(w => `
      <tr>
        <td><code>${w.pid}</code></td>
        <td>${fmtInt(w.miners)}</td>
        <td>${fmtInt(w.submitted)}</td>
        <td>${fmtInt(w.accepted)}</td>
        <td>${fmtInt(w.rejected)}</td>
        <td>${fmtMs(w.avgSubmitLatencyMs)}</td>
        <td class="muted small">${w.updatedAt ? new Date(w.updatedAt).toLocaleString() : "—"}</td>
      </tr>
    `).join("");

    views.status.innerHTML = `
      <div class="card">
        <h2>Overview</h2>
        ${activeAlerts.length ? `
<div class="card">
  <h2>Alerts</h2>
  <div class="alerts">
    ${activeAlerts.slice(0,5).map(a=>`<div class=\"alert ${a.level||"warn"}\"><div class=\"meta\"><div class=\"title\">${escapeHtml(a.message||a.type)}</div><div class=\"small\">${escapeHtml(a.type||"")}</div></div><div class=\"small\">${fmtAgo(a.updatedAt)}</div></div>`).join("")}
  </div>
</div>
` : ""}

<div class="grid">${kpiHtml}</div>
        ${poolControlsHtml || ""}
      </div>

      <div class="card">
        <h2>Threads</h2>
        <div class="tablewrap"><table class="table">
          <thead>
            <tr>
              <th>PID</th>
              <th>Miners</th>
              <th>Submitted</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Avg submit latency</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">No worker data yet</td></tr>'}</tbody>
        </table></div>
      </div>
    `;

    // Wire pool switch button
    const switchBtn = $("#poolSwitchBtn");
    if (switchBtn) {
      switchBtn.addEventListener("click", async () => {
        const sel = $("#poolSelect");
        const msg = $("#poolSwitchMsg");
        if (!sel || !msg) return;
        const val = sel.value;
        try {
          msg.textContent = "Switching...";
          const resp = await fetch(`/pool/switch?name=${encodeURIComponent(val)}`, { method: "POST" });
          const js = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            msg.textContent = js.error || `HTTP ${resp.status}`;
            return;
          }
          msg.textContent = "Done. Refreshing...";
          setTimeout(loadStatus, 600);
        } catch (e) {
          msg.textContent = e?.message || "Failed";
        }
      });
    }
  }

  
// ---------- Alerts ----------
async function loadAlerts(renderIfHidden=true){
  try{
    const data = await fetchJson("/alerts");
    lastAlerts = data;
    notifyNewActiveAlerts(data);
    const active = (data && data.alerts) ? data.alerts.filter(a=>a.active).length : 0;
    if (active > 0) {
      alertsNavBadge.textContent = String(active);
      alertsNavBadge.classList.remove("hidden");
    } else {
      alertsNavBadge.classList.add("hidden");
    }
    if (!views.alerts.classList.contains("hidden") || renderIfHidden===false){
      renderAlerts(data);
    }
  }catch(e){
    // keep quiet; UI should still work even if alerts endpoint is missing
  }
}

function renderAlerts(d){
  const list = (d && d.alerts) ? d.alerts.slice() : [];
  const active = list.filter(a=>a.active);
  const resolved = list.filter(a=>!a.active);
  const renderOne = (a) => `
    <div class="alert ${escapeHtml(a.level||"warn")}">
      <div class="meta">
        <div class="title">${escapeHtml(a.message || a.type || a.id)}</div>
        <div class="small">${escapeHtml(a.type || "")}${a.minerKey ? ` • ${escapeHtml(a.minerKey)}` : ""}</div>
      </div>
      <div class="small">${fmtAgo(a.updatedAt)}</div>
    </div>`;
  views.alerts.innerHTML = `
    <div class="card">
      <h2>Alerts</h2>
      <div class="muted small">Live alerts generated by vprox (failover, miner offline, high reject rate).</div>
    </div>
    <div class="card">
      <h3>Active (${active.length})</h3>
      <div class="alerts">${active.length ? active.map(renderOne).join("") : `<div class="muted">No active alerts.</div>`}</div>
    </div>
    <div class="card">
      <h3>Recently resolved (${resolved.length})</h3>
      <div class="alerts">${resolved.slice(0,10).length ? resolved.slice(0,10).map(renderOne).join("") : `<div class="muted">None.</div>`}</div>
    </div>
  `;
}

// ---------- Miners ----------
  const minerState = {
    page: 1,
    limit: 100,
    sort: "lastSeenAt",
    order: "desc",
    q: "",
    worker: "",
    lastData: null
  };

  function minerQuery(){
    const p = new URLSearchParams();
    p.set("page", minerState.page);
    p.set("limit", minerState.limit);
    p.set("sort", minerState.sort);
    p.set("order", minerState.order);
    if (minerState.q) p.set("q", minerState.q);
    if (minerState.worker) p.set("worker", minerState.worker);
    return "/miners?" + p.toString();
  }

  function renderMiners(data){
    minerState.lastData = data;
    const items = data?.items || data?.miners || [];

    // Update in-browser per-worker time series for mini charts.
    updateWorkerSeries(items);
    const meta = data?.meta || data?.pagination || data || {};
    const page = meta.page ?? minerState.page;
    const pages = meta.pages ?? meta.totalPages ?? 1;
    const total = meta.total ?? meta.count ?? items.length;

    const controls = `
      <div class="card">
        <h2>Miners</h2>
        <div class="controls">
          <input id="q" class="input" placeholder="Search (minerKey, worker, software…)" value="${escapeHtml(minerState.q)}" />
          <input id="worker" class="input" placeholder="Worker PID filter (optional)" value="${escapeHtml(minerState.worker)}" style="min-width:180px"/>
          <select id="limit" class="select">
            ${[25,50,100,200,500,1000].map(n => `<option value="${n}" ${n==minerState.limit?"selected":""}>${n}/page</option>`).join("")}
          </select>
          <button id="refreshMiners" class="btn">Refresh</button>
        </div>
        <div class="pager">
          <button id="prevPage" class="btn" ${page<=1?"disabled":""}>Prev</button>
          <div class="muted">Page <b>${page}</b> / ${pages} • Total <b>${fmtInt(total)}</b></div>
          <button id="nextPage" class="btn" ${page>=pages?"disabled":""}>Next</button>
        </div>
        <div class="muted small" style="margin-top:10px">Tip: click a column header to sort.</div>
      </div>
    `;

    // Note: We intentionally do NOT show the IP column in the UI (it is still available
    // in miner details and is searchable via `q=`). This keeps the table cleaner.
    const cols = [
      { key:"minerKey", label:"Miner" },
      { key:"workerName", label:"Worker" },
      { key:"software", label:"Software" },
      { key:"_trend", label:"Trend" },
      { key:"submitted", label:"Submitted" },
      { key:"accepted", label:"Accepted" },
      { key:"rejected", label:"Rejected" },
      { key:"avgSubmitLatencyMs", label:"Avg Share Lat" },
      { key:"lastSeenAt", label:"Last seen" },
      { key:"connectedAt", label:"Connected" }
    ];

    const ths = cols.map(c => {
      if (c.key === "_trend") return `<th>${c.label}</th>`;
      const arrow = (minerState.sort===c.key) ? (minerState.order==="asc" ? " ▲" : " ▼") : "";
      return `<th data-sort="${c.key}">${c.label}${arrow}</th>`;
    }).join("");

    const rows = items.map(m => `
      <tr data-minerkey="${escapeAttr(m.minerKey)}">
        <td><code>${escapeHtml(m.minerKey ?? m.minerId ?? "")}</code></td>
        <td class="muted workerCell" data-worker="${escapeAttr(shortWorkerName(m.workerName))}">${escapeHtml(shortWorkerName(m.workerName))}</td>
        <td>
          <span class="pill ${classifyMinerType(m.software)}" title="${escapeHtml(m.software ?? "—")}">${escapeHtml(m.software ?? "—")}</span>
        </td>
        <td>
          <canvas class="spark" width="90" height="18" data-worker="${escapeAttr(shortWorkerName(m.workerName))}"></canvas>
        </td>
        <td>${fmtInt(m.submitted)}</td>
        <td>${fmtInt(m.accepted)}</td>
        <td>${fmtInt(m.rejected)}</td>
        <td>${fmtMs(m.avgSubmitLatencyMs)}</td>
        <td class="muted">${fmtAgo(m.lastSeenAt)}</td>
        <td class="muted">${fmtAgo(m.connectedAt)}</td>
      </tr>
    `).join("");

    views.miners.innerHTML = controls + `
      <div class="card minersCard">
        <div class="tablewrap"><table class="table minersTable">
          <thead><tr>${ths}</tr></thead>
	          <tbody>${rows || '<tr><td colspan="' + cols.length + '" class="muted">No miners</td></tr>'}</tbody>
        </table></div>
      </div>
    `;

    // Ensure the miners table starts scrolled all the way left (prevents "centered" scroll state)
    setTimeout(() => {
      const tw = views.miners.querySelector('.tablewrap');
      if (tw) tw.scrollLeft = 0;
    }, 0);

    // Draw sparklines after DOM is in place
    setTimeout(() => {
      const canvases = views.miners.querySelectorAll('canvas.spark');
      canvases.forEach(cv => {
        const w = cv.dataset.worker;
        const series = workerSeries.get(w);
        drawSpark(cv, series ? series.points : []);
      });
    }, 0);

    // Click sparkline (or worker name) to open expanded worker chart
    setTimeout(() => {
      const nodes = views.miners.querySelectorAll('canvas.spark');
      nodes.forEach(cv => {
        cv.classList.add('trendClick');
        cv.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const w = cv.dataset.worker;
          if (w) openWorkerChart(w);
        });
      });
      const workerCells = views.miners.querySelectorAll('td.workerCell');
      workerCells.forEach(td => {
        td.classList.add('trendClick');
        td.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const w = td.dataset.worker;
          if (w) openWorkerChart(w);
        });
      });
    }, 0);

    // wire controls
    $("#q").addEventListener("change", (e) => { minerState.q = e.target.value.trim(); minerState.page = 1; loadMiners(); });
    $("#worker").addEventListener("change", (e) => { minerState.worker = e.target.value.trim(); minerState.page = 1; loadMiners(); });
    $("#limit").addEventListener("change", (e) => { minerState.limit = Number(e.target.value) || 100; minerState.page = 1; loadMiners(); });
    $("#refreshMiners").addEventListener("click", () => loadMiners());
    $("#prevPage").addEventListener("click", () => { minerState.page = Math.max(1, minerState.page-1); loadMiners(); });
    $("#nextPage").addEventListener("click", () => { minerState.page = minerState.page+1; loadMiners(); });

    // sort headers
    $$("#view-miners th[data-sort]").forEach(th => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (minerState.sort === key) minerState.order = (minerState.order === "asc" ? "desc" : "asc");
      else { minerState.sort = key; minerState.order = "desc"; }
      minerState.page = 1;
      loadMiners();
    }));

    // row click => miner details
    $$("#view-miners tbody tr").forEach(tr => tr.addEventListener("click", async () => {
      const key = tr.getAttribute("data-minerkey");
      if (!key) return;
      await openMiner(key);
    }));
  }

  async function openMiner(minerKey){
    try{
      setBadge(true, "connected");
      const data = await fetchJson(`/miners/${encodeURIComponent(minerKey)}?pretty=1`);
      dialogSub.textContent = minerKey;
      dialogBody.textContent = JSON.stringify(data, null, 2);
      dialog.showModal();
    }catch(e){
      dialogSub.textContent = minerKey;
      dialogBody.textContent = `Failed to load miner:\n${e.message}`;
      dialog.showModal();
    }
  }

  // ---------- Metrics ----------
  async function loadMetrics(){
    views.metrics.innerHTML = `
      <div class="card">
        <h2>Metrics</h2>
        <div class="muted">Prometheus format from <code>/metrics</code></div>
      </div>
      <div class="card"><pre class="prebox" id="metricsBox">Loading…</pre></div>
    `;
    try{
      const txt = await fetchText("/metrics");
      $("#metricsBox").textContent = txt;
    }catch(e){
      $("#metricsBox").textContent = `Failed to load metrics: ${e.message}`;
    }
  }

  async function loadStatus(){
    try{
      const data = await fetchJson("/status");
      lastStatus = data;
      setBadge(true, "connected");
      await loadAlerts(false);
      renderStatus(data, lastAlerts);
    }catch(e){
      setBadge(false, "offline");
      views.status.innerHTML = `
        <div class="card">
          <h2>Status</h2>
          <div class="muted">Failed to fetch <code>/status</code>: ${escapeHtml(e.message)}</div>
          <div style="margin-top:10px" class="muted small">Make sure vprox is running and statusPort is reachable.</div>
        </div>
      `;
    }
  }

  async function loadMiners(){
    try{
      const data = await fetchJson(minerQuery());
      setBadge(true, "connected");
      renderMiners(data);
    }catch(e){
      setBadge(false, "offline");
      views.miners.innerHTML = `
        <div class="card">
          <h2>Miners</h2>
          <div class="muted">Failed to fetch <code>/miners</code>: ${escapeHtml(e.message)}</div>
        </div>
      `;
    }
  }

  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
  function escapeAttr(s){
    return String(s ?? "").replace(/"/g, "&quot;");
  }

  function tickNow(){
    nowEl.textContent = new Date().toLocaleString();
  }

  // navigation
  $$(".navbtn").forEach(b => b.addEventListener("click", async () => {
    const name = b.dataset.view;
    showView(name);
    if (name === "status") await loadStatus();
    if (name === "miners") await loadMiners();
    if (name === "alerts") await loadAlerts(true);
    if (name === "metrics") await loadMetrics();
  }));

  // initial
  tickNow(); setInterval(tickNow, 1000);
  const initial = (window.location.hash || "#status").slice(1);
  showView(["status","miners","alerts","metrics"].includes(initial) ? initial : "status");

  // load initial view
  (async () => {
    await loadStatus();
    if (window.location.hash === "#miners") await loadMiners();
    if (window.location.hash === "#alerts") await loadAlerts(true);
    if (window.location.hash === "#metrics") await loadMetrics();
    // refresh status periodically
    setInterval(() => { if (!views.status.classList.contains("hidden")) loadStatus(); }, 3000);
  })();
})();
