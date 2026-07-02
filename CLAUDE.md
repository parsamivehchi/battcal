# battcal

Battery band cycler for Apple Silicon MacBooks. Cycles the battery inside a band
(longevity 10-90% default, calibration 5-100% on demand) while plugged in, so the
cells never park at 100%. Ships an engine (bash LaunchAgent), a zero-dependency
Node dashboard server + Vite/React dashboard, a native SwiftUI menu bar app, and
a SwiftBar plugin alternative. Public repo (MIT): https://github.com/parsamivehchi/battcal

## Layout

| Path | What |
|---|---|
| `bin/battcal-engine.sh` | The state machine (drain/charge/hold, modes, MagSafe LED scheme, telemetry) |
| `server/server.mjs` | Zero-dep Node server: JSON API + serves `dashboard/dist` (port 4437) |
| `dashboard/` | Vite 7 + React 19 + Recharts SPA (charts, mode/pause controls, explainer) |
| `menubar/` | BattCalBar: SwiftUI MenuBarExtra app, XcodeGen project, icon generator script |
| `swiftbar/` | Lightweight SwiftBar plugin alternative to the native app |
| `install.sh` / `uninstall.sh` | Installer (installs PAUSED) / clean removal |

## Build & run

```sh
cd dashboard && npm install && npm run build   # tsc -b && vite build
node server/server.mjs                          # dashboard at localhost:4437
bash -n bin/battcal-engine.sh                   # engine syntax gate
cd menubar && xcodegen && xcodebuild -project BattCalBar.xcodeproj \
  -scheme BattCalBar -configuration Release -derivedDataPath build build
```

## Hard-won constraints (do not regress)

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
- Engines exist twice on the dev machine (repo + deployed personal copy with
  `battery-calibrate` paths); keep both in sync when editing (see the `battcal`
  global skill for the machine-specific recipes).

## Conventions

Dashboard colors are the dataviz-skill validated palette (light + dark steps in
`dashboard/src/index.css`); axis helpers in `dashboard/src/chartUtils.ts` (round
wall-clock time ticks, padded stepped Y scales). Theme: Auto (system) / Light / Dark.
No em dashes anywhere. Named local URL: https://battcal.localhost (portless alias -> 4437).
