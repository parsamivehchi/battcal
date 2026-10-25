# Engine and server contracts

## Moved from CLAUDE.md (2026-10-22)

Verbatim from the previous CLAUDE.md "Hard-won constraints" section. CLAUDE.md keeps one-line rules; the full explanations live here.


- `batt status` is broken on macOS 26 ("key has no data"); use only
  `batt adapter enable|disable` and `batt magsafe-led ...`. Never parse batt status.
- Physical-charger detection: `AdapterDetails "Watts">0` via ioreg. `ExternalConnected`
  reads No while the adapter is software-cut.
- launchd agents hang silently (TCC) running scripts from ~/Desktop or ~/Documents;
  installers must deploy to `~/.battcal/` or `~/Library/`.
- Codesign rejects bundles with `com.apple.provenance` xattrs: build, then
  `ditto --norsrc --noextattr --noacl` to a clean path, then `codesign --force --deep --sign -`.
- MagSafe LED hardware is amber+green only. The LED scheme signals with states
  (dark = draining, pulse = calibration); custom colors are impossible.
- Installer must default to PAUSED; never change a user's charging on install.
- The engine runs from a deployed copy (personal `battery-calibrate` paths). It is
  GENERATED from `bin/battcal-engine.sh` (the single source) by `./deploy.sh` via a
  surgical namespace transform that leaves the shared `battcal-telemetry.csv` and
  `~/.battcal/config` untouched. Edit ONLY `bin/battcal-engine.sh`, then `./deploy.sh`.
- The server binds 127.0.0.1 and every POST/DELETE requires the `x-battcal: 1` header
  (403 without): `curl -X POST -H "x-battcal: 1" http://localhost:4437/api/...`. No CORS
  headers on purpose. GET stays open.
- `/api/status` `adapterCut` (plugged && ExternalConnected=No) is the ground truth for
  "BattCal cut the adapter"; UIs must key every "draining (adapter cut)" claim on it,
  never on negative battery watts alone (a paused Mac under load briefly supplements a
  maxed adapter).
- The engine's EXIT trap re-enables the adapter on an UNMANAGED death; deploy.sh touches
  `/var/tmp/<ns>.managed-restart` before its kickstart so deploys keep the drain phase.
- The compiled-in home-SSID default is EMPTY (privacy). The owner's networks live in
  `defaults read com.parsa.battcalbar homeSSIDs`; blanking or losing that key silently
  turns gated cycling off at home (fail-safe away).
- `scripts/check.sh` is the quality gate (bash -n all scripts, node --check, tsc,
  swiftc -parse on menubar sources, read-only status smoke); `deploy.sh` runs it
  first and fails closed.
- The engine judges `/var/tmp/battcal-athome` freshness by file MTIME with
  ATHOME_MAX_AGE=90s (stale = AWAY, fail-safe). The menu bar rewrites it on value
  change OR mtime age > 60s; never make that write purely change-driven or home
  cycling silently stops. The `battcal-wifi.ssid` breadcrumb has no freshness
  contract and writes only on change.
- Work schedule: `~/.battcal/schedule` (DAYS=12345 START=0800 END=1800, shared across
  namespaces like config) gates cycling to a weekly window. The engine enforces it by
  writing `<epoch> schedule` into the pause file (a timed pause until the next window
  start); `/var/tmp/<ns>.schedule-phase` detects boundary crossings, and
  `/var/tmp/<ns>.schedule-override` (touched by the server on every manual
  pause/resume/break/mode/prep POST) suspends steady-state enforcement until the next
  boundary ("manual wins until the boundary"). UIs must key "Off hours" on
  `pausedBy === 'schedule'`, never on breakUntil alone - a schedule pause carries a
  breakUntil epoch but is Normal charging, not a benchmark break.

