
## [0.3.2] - 2026-01-01
### Added
- Clickable worker trend sparkline opens an expanded modal chart (last 30/60 minutes) on the Miners page.
# Changelog

All notable changes to this project will be documented in this file.

## [0.3.1] - 2025-12-31
### Added
- Per-worker mini charts (sparklines) on the Miners page (Trend column). Charts are computed client-side from successive `/miners` refreshes (shares-per-minute trend).

## [0.2.9] - 2025-12-31
### Added
- `CHANGELOG.md`.

### Changed
- Documentation refresh.

## [0.2.8] - 2025-12-31
### Added
- UI toast popups for new alerts.

### Fixed
- UI error: `activeAlerts` reference could break `/status` rendering.

## [0.2.7] - 2025-12-31
### Added
- Light/Dark theme toggle (persisted in browser).

### Changed
- Slightly bolder UI typography for readability.

## [0.2.6] - 2025-12-31
### Added
- Alerts engine + `/alerts` endpoint.
- UI Alerts page + sidebar badge.
- Alert types: pool failover, miner offline, high reject rate.

## [0.2.5] - 2025-12-31
### Added
- Colored software badges by miner type (CPU/GPU/ASIC/Unknown).

## [0.2.4] - 2025-12-31
### Changed
- Uptime formatting: auto-switch to `Xd HH:MM:SS` after 1 day (otherwise `HH:MM:SS`).
- Miners column header: `Avg Share Lat`.

## [0.2.3] - 2025-12-31
### Added
- Miner worker name shown on Miners page.

## [0.2.2] - 2025-12-31
### Added
- Manual pool switch control from the dashboard.

### Fixed
- Miners table layout improvements for wide datasets.

## [0.2.1] - 2025-12-31
### Added
- Multi-pool support + failover with auto-return to primary.
- Mining worker tracking (unique `wallet.worker`).

## [0.2.0] - 2025-12-31
### Added
- Web dashboard (`/ui/`).
- `/status`, `/miners`, `/metrics`, `/health` endpoints.
