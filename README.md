# vprox — Verus Stratum Proxy & Web Dashboard

vprox is a Stratum proxy for Verus-style pools with a built-in web UI, multi-pool failover, miner tracking, Prometheus metrics, and alerts.

## Quick start

```bash
npm install
node proxy.js
```

Dashboard: `http://<host>:<statusPort>/ui/` (defaults to `http://localhost:8080/ui/`).

## Endpoints
- `GET /health` -> `ok`
- `GET /status` -> aggregated stats + pool state
- `GET /miners` -> miners list (search/sort/pagination)
- `GET /miners/:id` -> single miner details
- `GET /alerts` -> active + recent resolved alerts
- `GET /metrics` -> Prometheus-style metrics

## UI highlights
- Light/Dark theme toggle (saved in browser)
- Alerts page + toast popups for new alerts
- Manual pool switch from Status page
- Miners table: worker name, software badges, avg share latency, per-worker mini trend charts

## Version
See `CHANGELOG.md`.
