const cluster = require("cluster");
const totalCPUs = require("os").cpus().length;
const minerListener = require('./lib/miner_listener.js');
const config = require('./config.json');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Web UI root (master sets this). Keeping it at module-scope avoids
// block-scope ReferenceErrors when serving /ui/*.
let WEB_ROOT = null;

config.version = "0.3.1";

function safeNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function promEscapeLabelValue(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function snapshotToMinersList(snapshot, pid) {
  const active = (snapshot && Array.isArray(snapshot.active)) ? snapshot.active : [];
  // Attach worker pid for provenance + a globally-unique key
  return active.map(m => ({
    workerPid: pid,
    minerKey: `${pid}:${m.minerId}`,
    ...m
  }));
}

if (cluster.isMaster) {
  console.log(`VerusProxy v${config.version} by Caint a fork of https://github.com/hellcatz/verusProxy`);

  // HTTP status endpoints (master only)
  const startedAt = Date.now();
  WEB_ROOT = path.join(__dirname, 'web');
  const workerStats = new Map(); // pid -> snapshot
  const alerts = new Map(); // id -> alert object

  // Defaults
  if (!config.alerts) config.alerts = {};
  if (!config.alerts.enabled && config.alerts.enabled !== false) config.alerts.enabled = true;
  if (!config.alerts.minerOfflineSeconds) config.alerts.minerOfflineSeconds = 120;
  if (!config.alerts.highRejectRate) config.alerts.highRejectRate = {};
  if (!config.alerts.highRejectRate.threshold) config.alerts.highRejectRate.threshold = 0.25; // 25%
  if (!config.alerts.highRejectRate.minShares) config.alerts.highRejectRate.minShares = 20;
  if (!config.alerts.retainResolvedSeconds) config.alerts.retainResolvedSeconds = 300;
  if (!config.statusPort) { config.statusPort = 8080; }
  if (!config.statusBind) { config.statusBind = "0.0.0.0"; }

  const aggregate = () => {
    const totals = { miners: 0, submitted: 0, accepted: 0, rejected: 0, avgSubmitLatencyMs: 0, miningWorkers: 0 };
    const workers = [];
    const miners = [];
    const workerNames = new Set();
    let latencySum = 0;
    let latencyCount = 0;
    let poolState = null;

    for (const [pid, snap] of workerStats.entries()) {
      // Flatten common fields for the UI while keeping raw snapshot available.
      let wSubmitted = 0, wAccepted = 0, wRejected = 0, wLatSum = 0, wLatCnt = 0;
      const active = (snap && snap.active) ? snap.active : [];
      for (const m of active) {
        wSubmitted += (m.submitted || 0);
        wAccepted += (m.accepted || 0);
        wRejected += (m.rejected || 0);
        if (m.submitLatencyCount && m.submitLatencyMsSum) {
          wLatSum += safeNumber(m.submitLatencyMsSum);
          wLatCnt += safeNumber(m.submitLatencyCount);
        }
      }
      const wAvg = wLatCnt > 0 ? Math.round(wLatSum / wLatCnt) : 0;

      workers.push({
        pid,
        miners: (snap && snap.total) ? snap.total : 0,
        submitted: wSubmitted,
        accepted: wAccepted,
        rejected: wRejected,
        avgSubmitLatencyMs: wAvg,
        updatedAt: (snap && snap.updatedAt) ? snap.updatedAt : null,
        snapshot: snap || null
      });
      if (!poolState && snap && snap.poolState) poolState = snap.poolState;
      try {
        const total = (snap && snap.total) ? snap.total : 0;
        totals.miners += total;

        for (const m of active) {
          totals.submitted += (m.submitted || 0);
          totals.accepted += (m.accepted || 0);
          totals.rejected += (m.rejected || 0);
          if (m.submitLatencyCount && m.submitLatencyMsSum) {
            latencySum += safeNumber(m.submitLatencyMsSum);
            latencyCount += safeNumber(m.submitLatencyCount);
          }
          if (m.workerName) workerNames.add(String(m.workerName));
        }

        miners.push(...snapshotToMinersList(snap, pid));
      } catch (e) { }
    }

    totals.avgSubmitLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
    totals.miningWorkers = workerNames.size;

    return { totals, workers, miners, poolState };
  };


const upsertAlert = (id, data) => {
  const now = Date.now();
  const prev = alerts.get(id);
  if (prev && prev.active) {
    const next = { ...prev, ...data, id, active: true, updatedAt: now };
    alerts.set(id, next);
    return next;
  }
  const createdAt = prev ? prev.createdAt : now;
  const next = { id, ...data, active: true, createdAt, updatedAt: now };
  alerts.set(id, next);
  return next;
};

const resolveAlert = (id) => {
  const prev = alerts.get(id);
  if (!prev || !prev.active) return;
  alerts.set(id, { ...prev, active: false, resolvedAt: Date.now(), updatedAt: Date.now() });
};

const pruneAlerts = () => {
  const retainMs = (config.alerts && config.alerts.retainResolvedSeconds ? config.alerts.retainResolvedSeconds : 300) * 1000;
  const now = Date.now();
  for (const [id, a] of alerts.entries()) {
    if (!a.active && a.resolvedAt && (now - a.resolvedAt) > retainMs) alerts.delete(id);
  }
};

const evaluateAlerts = (agg) => {
  if (!config.alerts || config.alerts.enabled === false) return;

  pruneAlerts();

  // Pool failover
  const ps = agg.poolState || null;
  const onBackup = ps && typeof ps.activePoolIndex === "number" ? (ps.activePoolIndex !== 0) : false;
  if (onBackup) {
    const name = ps && ps.activePool ? (ps.activePool.name || `#${ps.activePoolIndex}`) : "backup";
    upsertAlert("pool_failover", {
      type: "pool_failover",
      level: "warn",
      message: `Failover active: running on ${name}`
    });
  } else {
    resolveAlert("pool_failover");
  }

  // Per-miner alerts
  const offlineMs = (config.alerts.minerOfflineSeconds || 120) * 1000;
  const thr = (config.alerts.highRejectRate && config.alerts.highRejectRate.threshold) ? config.alerts.highRejectRate.threshold : 0.25;
  const minShares = (config.alerts.highRejectRate && config.alerts.highRejectRate.minShares) ? config.alerts.highRejectRate.minShares : 20;

  const now = Date.now();
  const seenHighReject = new Set();
  const seenOffline = new Set();

  for (const m of agg.miners || []) {
    const key = m.minerKey || `${m.workerPid}:${m.minerId || "?"}`;
    const submitted = (m.submitted || 0);
    const accepted = (m.accepted || 0);
    const rejected = (m.rejected || 0);
    const dec = accepted + rejected;
    const rejectRate = dec > 0 ? (rejected / dec) : 0;

    // Offline: not seen recently OR disconnected
    const lastSeen = m.lastSeenAt ? Number(m.lastSeenAt) : null;
    const isOffline = (m.connected === false) || (lastSeen && (now - lastSeen) > offlineMs);
    if (isOffline) {
      seenOffline.add(key);
      upsertAlert(`miner_offline:${key}`, {
        type: "miner_offline",
        level: "warn",
        minerKey: key,
        message: `Miner offline: ${key}`
      });
    }

    // High reject rate
    if (submitted >= minShares && dec >= minShares && rejectRate >= thr) {
      seenHighReject.add(key);
      upsertAlert(`high_reject:${key}`, {
        type: "high_reject",
        level: "warn",
        minerKey: key,
        rejectRate,
        message: `High reject rate (${Math.round(rejectRate*100)}%): ${key}`
      });
    }
  }

  // Resolve any miner alerts no longer present
  for (const [id, a] of alerts.entries()) {
    if (a.active && a.type === "miner_offline" && a.minerKey && !seenOffline.has(a.minerKey)) resolveAlert(id);
    if (a.active && a.type === "high_reject" && a.minerKey && !seenHighReject.has(a.minerKey)) resolveAlert(id);
  }
};

  const buildPrometheus = (agg, uptimeSec) => {
    const lines = [];

    // Basic
    lines.push('# HELP vprox_up Whether the proxy is running (always 1).');
    lines.push('# TYPE vprox_up gauge');
    lines.push(`vprox_up 1`);

    lines.push('# HELP vprox_uptime_seconds Uptime of the master process in seconds.');
    lines.push('# TYPE vprox_uptime_seconds gauge');
    lines.push(`vprox_uptime_seconds ${safeNumber(uptimeSec)}`);

    // Totals
    lines.push('# HELP vprox_miners_total Total connected miners (across workers).');
    lines.push('# TYPE vprox_miners_total gauge');
    lines.push(`vprox_miners_total ${safeNumber(agg.totals.miners)}`);

    lines.push('# HELP vprox_shares_submitted_total Total submitted shares (across workers).');
    lines.push('# TYPE vprox_shares_submitted_total counter');
    lines.push(`vprox_shares_submitted_total ${safeNumber(agg.totals.submitted)}`);

    lines.push('# HELP vprox_shares_accepted_total Total accepted shares (across workers).');
    lines.push('# TYPE vprox_shares_accepted_total counter');
    lines.push(`vprox_shares_accepted_total ${safeNumber(agg.totals.accepted)}`);

    lines.push('# HELP vprox_shares_rejected_total Total rejected shares (across workers).');
    lines.push('# TYPE vprox_shares_rejected_total counter');
    lines.push(`vprox_shares_rejected_total ${safeNumber(agg.totals.rejected)}`);

    lines.push('# HELP vprox_mining_workers_total Unique Stratum worker names observed via mining.authorize.');
    lines.push('# TYPE vprox_mining_workers_total gauge');
    lines.push(`vprox_mining_workers_total ${safeNumber(agg.totals.miningWorkers)}`);

    lines.push('# HELP vprox_pool_active_info Active upstream pool info (value is always 1).');
    lines.push('# TYPE vprox_pool_active_info gauge');
    if (agg.poolState && agg.poolState.activePool) {
      const ap = agg.poolState.activePool;
      const labels = `name="${promEscapeLabelValue(ap.name || '')}",host="${promEscapeLabelValue(ap.host || '')}",port="${promEscapeLabelValue(ap.port || '')}",index="${promEscapeLabelValue(agg.poolState.activePoolIndex ?? 0)}"`;
      lines.push(`vprox_pool_active_info{${labels}} 1`);
    }

    // Per-worker
    lines.push('# HELP vprox_worker_miners_total Connected miners per worker.');
    lines.push('# TYPE vprox_worker_miners_total gauge');
    for (const w of agg.workers) {
      const pid = w.pid;
      const total = (w.stats && w.stats.total) ? w.stats.total : 0;
      lines.push(`vprox_worker_miners_total{worker_pid="${promEscapeLabelValue(pid)}"} ${safeNumber(total)}`);
    }

    // Per-miner stats (can be a lot; keep it simple counters + avg latency)
    lines.push('# HELP vprox_miner_shares_submitted_total Submitted shares per miner.');
    lines.push('# TYPE vprox_miner_shares_submitted_total counter');
    lines.push('# HELP vprox_miner_shares_accepted_total Accepted shares per miner.');
    lines.push('# TYPE vprox_miner_shares_accepted_total counter');
    lines.push('# HELP vprox_miner_shares_rejected_total Rejected shares per miner.');
    lines.push('# TYPE vprox_miner_shares_rejected_total counter');
    lines.push('# HELP vprox_miner_submit_latency_ms_avg Average mining.submit response latency (ms) per miner.');
    lines.push('# TYPE vprox_miner_submit_latency_ms_avg gauge');

    for (const m of agg.miners) {
      const labels =
        `worker_pid="${promEscapeLabelValue(m.workerPid)}",miner_id="${promEscapeLabelValue(m.minerId)}",ip="${promEscapeLabelValue(m.ip)}"`;

      lines.push(`vprox_miner_shares_submitted_total{${labels}} ${safeNumber(m.submitted)}`);
      lines.push(`vprox_miner_shares_accepted_total{${labels}} ${safeNumber(m.accepted)}`);
      lines.push(`vprox_miner_shares_rejected_total{${labels}} ${safeNumber(m.rejected)}`);

      const avgLatency = (m.submitLatencyCount && m.submitLatencyCount > 0)
        ? (safeNumber(m.submitLatencyMsSum) / safeNumber(m.submitLatencyCount))
        : 0;

      lines.push(`vprox_miner_submit_latency_ms_avg{${labels}} ${safeNumber(avgLatency)}`);
    }

    return lines.join('\n') + '\n';
  };


  const parseIntParam = (v, def) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? n : def;
  };

  const sortMiners = (list, sortBy, order) => {
    const dir = (String(order).toLowerCase() === "asc") ? 1 : -1;
    const key = String(sortBy || "").trim();

    const getter = (m) => {
      switch (key) {
        case "minerId": return safeNumber(m.minerId);
        case "workerPid": return safeNumber(m.workerPid);
        case "connectedAt": return safeNumber(m.connectedAt);
        case "lastSeenAt": return safeNumber(m.lastSeenAt);
        case "uptimeSec": return safeNumber(m.uptimeSec);
        case "submitted": return safeNumber(m.submitted);
        case "accepted": return safeNumber(m.accepted);
        case "rejected": return safeNumber(m.rejected);
        case "avgSubmitLatencyMs": return safeNumber(m.avgSubmitLatencyMs);
        default: return safeNumber(m.lastSeenAt); // sensible default
      }
    };

    return list.sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // tie-breaker for deterministic ordering
      const ak = String(a.minerKey || "");
      const bk = String(b.minerKey || "");
      return ak.localeCompare(bk) * dir;
    });
  };

  const paginate = (list, page, limit) => {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const safePage = Math.max(page, 1);
    const total = list.length;
    const pages = Math.max(Math.ceil(total / safeLimit), 1);
    const p = Math.min(safePage, pages);
    const start = (p - 1) * safeLimit;
    const end = start + safeLimit;
    return { total, pages, page: p, limit: safeLimit, items: list.slice(start, end) };
  };

  const findMiner = (miners, id) => {
    const raw = String(id || "");
    // Supported formats:
    //  - minerKey: "<workerPid>:<minerId>"
    //  - workerPid-minerId: "<workerPid>-<minerId>"
    //  - minerId only (may be ambiguous across workers)
    let workerPid = null;
    let minerId = null;

    if (raw.includes(":")) {
      const [wp, mid] = raw.split(":");
      workerPid = wp;
      minerId = mid;
    } else if (raw.includes("-")) {
      const [wp, mid] = raw.split("-");
      workerPid = wp;
      minerId = mid;
    }

    if (workerPid !== null && minerId !== null) {
      const match = miners.find(m => String(m.workerPid) === String(workerPid) && String(m.minerId) === String(minerId));
      return { match, ambiguous: false, matches: match ? [match] : [] };
    }

    // minerId-only lookup
    const matches = miners.filter(m => String(m.minerId) === raw);
    if (matches.length === 1) return { match: matches[0], ambiguous: false, matches };
    if (matches.length > 1) return { match: null, ambiguous: true, matches };
    return { match: null, ambiguous: false, matches: [] };
  };

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

// Web UI
if (url.pathname === "/" || url.pathname === "/ui") {
  res.writeHead(302, { Location: "/ui/" });
  return res.end();
}
if (url.pathname.startsWith("/ui/")) {
  return serveStaticUi(url.pathname, res);
}


      // Ask workers for fresh stats (best-effort) on every request to status/miners/metrics
      const wantsWorkerRefresh = (url.pathname === "/status" || url.pathname.startsWith("/miners") || url.pathname === "/metrics");
      if (wantsWorkerRefresh) {
        for (const id in cluster.workers) {
          const w = cluster.workers[id];
          if (w && w.isConnected()) {
            w.send({ type: "stats_request" });
          }
        }
      }

      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("ok");
      
      if (url.pathname === "/pool/switch") {
        // Manual pool switch: POST /pool/switch?name=primary OR ?index=0
        const name = url.searchParams.get("name");
        const index = url.searchParams.get("index");
        const target = {
          name: name != null ? name : undefined,
          index: index != null ? parseInt(index, 10) : undefined,
          reason: "manual-ui"
        };
        for (const id in cluster.workers) {
          const w = cluster.workers[id];
          if (w && w.isConnected()) {
            try { w.send({ type: "pool_switch", target }); } catch(e) {}
          }
        }
        res.writeHead(200, { "content-type": "application/json" });
        const pretty = url.searchParams.get("pretty") === "1";
        return res.end(JSON.stringify({ ok: true, requested: target }, null, pretty ? 2 : 0));
      }

}

      if (url.pathname === "/status") {
        const agg = aggregate();
        evaluateAlerts(agg);
        const payload = {
          name: "vprox",
          version: config.version,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          threads: agg.workers.length,
          poolState: agg.poolState || null,
          totals: agg.totals,
          workers: agg.workers
        };
        const pretty = url.searchParams.get("pretty") === "1";
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(payload, null, pretty ? 2 : 0));
      }


if (url.pathname === "/alerts") {
  const agg = aggregate();
  evaluateAlerts(agg);
  const all = url.searchParams.get("all") === "1";
  const pretty = url.searchParams.get("pretty") === "1";
  const list = [];
  for (const a of alerts.values()) {
    if (!all && !a.active) continue;
    list.push(a);
  }
  list.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  const payload = { active: list.filter(a=>a.active).length, total: list.length, alerts: list };
  res.writeHead(200, { "content-type": "application/json" });
  return res.end(JSON.stringify(payload, null, pretty ? 2 : 0));
}


      // Single miner details: /miners/:id
      // id formats supported:
      //   - minerKey: "<workerPid>:<minerId>" (recommended)
      //   - legacy:   "<workerPid>-<minerId>"
      //   - minerId only (may be ambiguous across workers)
      if (url.pathname.startsWith("/miners/")) {
        const id = decodeURIComponent(url.pathname.slice("/miners/".length));
        const agg = aggregate();
        const found = findMiner(agg.miners, id);

        if (found.ambiguous) {
          res.writeHead(409, { "content-type": "application/json" });
          return res.end(JSON.stringify({
            error: "ambiguous_miner_id",
            message: "Miner ID matches multiple workers. Use minerKey format '<workerPid>:<minerId>'.",
            matches: found.matches.map(m => ({
              minerKey: m.minerKey,
              workerPid: m.workerPid,
              minerId: m.minerId,
              ip: m.ip
            }))
          }));
        }

        if (!found.match) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "miner_not_found" }));
        }

        const pretty = url.searchParams.get("pretty") === "1";
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          name: "vprox",
          version: config.version,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          miner: found.match
        }, null, pretty ? 2 : 0));
      }

      if (url.pathname === "/miners") {
        const agg = aggregate();
        let list = agg.miners;

        // Optional filter: /miners?worker=PID
        const workerFilter = url.searchParams.get("worker");
        if (workerFilter) {
          list = list.filter(m => String(m.workerPid) === String(workerFilter));
        }

        // Optional search: /miners?q=... (matches minerKey, minerId, ip, software)
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        if (q) {
          list = list.filter(m => {
            const hay = `${m.minerKey || ""} ${m.minerId || ""} ${m.ip || ""} ${m.workerName || ""} ${m.software || ""}`.toLowerCase();
            return hay.includes(q);
          });
        }

        // Sort & paginate
        const sortBy = url.searchParams.get("sort") || url.searchParams.get("sortBy") || "lastSeenAt";
        const order = url.searchParams.get("order") || url.searchParams.get("dir") || "desc";
        sortMiners(list, sortBy, order);

        const page = parseIntParam(url.searchParams.get("page"), 1);
        const limit = parseIntParam(url.searchParams.get("limit") || url.searchParams.get("pageSize"), 100);
        const pg = paginate(list, page, limit);

        const payload = {
          name: "vprox",
          version: config.version,
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          total: pg.total,
          page: pg.page,
          pages: pg.pages,
          limit: pg.limit,
          sortBy: String(sortBy),
          order: String(order),
          miners: pg.items
        };
        const pretty = url.searchParams.get("pretty") === "1";
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(payload, null, pretty ? 2 : 0));
      }


if (url.pathname === "/alerts") {
  const agg = aggregate();
  evaluateAlerts(agg);
  const all = url.searchParams.get("all") === "1";
  const pretty = url.searchParams.get("pretty") === "1";
  const list = [];
  for (const a of alerts.values()) {
    if (!all && !a.active) continue;
    list.push(a);
  }
  list.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  const payload = { active: list.filter(a=>a.active).length, total: list.length, alerts: list };
  res.writeHead(200, { "content-type": "application/json" });
  return res.end(JSON.stringify(payload, null, pretty ? 2 : 0));
}

      if (url.pathname === "/metrics") {
        const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
        const agg = aggregate();
        const body = buildPrometheus(agg, uptimeSec);
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        return res.end(body);
      }

      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not_found" }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  });

  server.listen(config.statusPort, config.statusBind, () => {
    console.log(`HTTP status listening on http://${config.statusBind}:${config.statusPort}`);
    console.log(`  GET /health`);
    console.log(`  GET /status`);
    console.log(`  GET /miners`);
    console.log(`  GET /miners/:id`);
    console.log(`  GET /metrics`);
  });

  let my_fork = function () {
    let worker = cluster.fork();
    worker.on('message', function (msg) {
      if (msg && msg.type === 'stats_update') {
        try { workerStats.set(worker.process.pid, msg.snapshot || null); } catch (e) { }
        return;
      }
      if (msg && msg.type === 'pool_switch_ack') {
        // optional: could log or store last ack
        return;
      }

      console.log('from worker:', msg);
    });
    return worker;
  };

  let numThreads = 1;
  if (config.threads && typeof config.threads === 'string') {
    if (config.threads.toLowerCase() === 'auto') {
      numThreads = totalCPUs;
    } else if (!isNaN(config.threads)) {
      numThreads = Math.min(Math.max(parseInt(config.threads, 10), 1), totalCPUs);
    }
  } else if (config.threads && typeof config.threads === 'number') {
    numThreads = Math.min(Math.max(config.threads, 1), totalCPUs);
  }

  console.log(`Using ${numThreads} out of ${totalCPUs} total threads`);

  for (let i = 0; i < numThreads; i++) {
    my_fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died, forking again`);
    try { workerStats.delete(worker.process.pid); } catch (e) { }
    my_fork();
  });

} else {
  // Worker: respond to stats requests and periodically push updates
  const sendSnapshot = () => {
    try {
      const snap = minerListener.getMinerStatsSnapshot();
      if (process && process.send) {
        process.send({ type: "stats_update", snapshot: snap });
      }
    } catch (e) { }
  };

  process.on('message', function (msg) {
    if (msg && msg.type === "stats_request") {
      sendSnapshot();
      return;
    }
    if (msg && msg.type === "pool_switch") {
      try {
        const r = minerListener.manualSwitchPool(msg.target || {});
        // Push updated stats quickly so UI reflects new pool
        sendSnapshot();
        if (process && process.send) {
          process.send({ type: "pool_switch_ack", result: r });
        }
      } catch(e) {}
      return;
    }
    // keep minimal noise
    // console.log('from master:', msg);
  });

  // default interval to keep master fresh (also supports on-demand via stats_request)
  if (!config.statusUpdateIntervalMs) config.statusUpdateIntervalMs = 2000;
  if (config.statusUpdateIntervalMs > 0) {
    setInterval(sendSnapshot, config.statusUpdateIntervalMs);
  }

  if (!config.notifyTimeoutMs) {
    config.notifyTimeoutMs = 30000;
  }

  minerListener.createMiningListener(config);
}
function serveStaticUi(urlPath, res) {
  // Serve files from ./web at /ui/*
  const webRoot = WEB_ROOT || path.join(__dirname, 'web');
  let rel = urlPath.replace(/^\/ui\//, "");
  if (!rel || rel.endsWith("/")) rel += "index.html";

  // Basic path traversal protection
  const safeRel = rel.replace(/\\/g, "/");
  const filePath = path.normalize(path.join(webRoot, safeRel));
  if (!filePath.startsWith(webRoot)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("forbidden");
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".html" ? "text/html; charset=utf-8" :
      ext === ".css"  ? "text/css; charset=utf-8" :
      ext === ".js"   ? "application/javascript; charset=utf-8" :
      ext === ".json" ? "application/json; charset=utf-8" :
      ext === ".svg"  ? "image/svg+xml" :
      ext === ".png"  ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(buf);
  });
}


