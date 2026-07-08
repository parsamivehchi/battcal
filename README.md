# BattCal

**Battery band cycling for Apple Silicon MacBooks: longevity 10-90% by default, full-range calibration on demand. Native menu bar app + live web dashboard.**

## Modes

| Mode | Band | What it does |
|---|---|---|
| **Longevity** (default) | 10-90% | Cycles the battery inside the band while plugged in. Never reaches 100%, never sits at full. Lithium cells age fastest parked at high charge; this keeps yours moving in the healthy middle. |
| **Calibration** (on demand) | 5-100% + 1h hold | Full-range passes that feed the gauge and macOS the data their health estimates re-learn from. Run it for a few days when the health numbers look stale, then switch back. |
| **Paused / Off** | - | The software cut lifts instantly; the Mac charges to 100% like a normal Mac. Unplugging also auto-suspends cycling until AC returns. |

Switch modes from the menu bar app, the dashboard, or `echo longevity > /var/tmp/battcal.mode`.

macOS shows you a battery health number ("Maximum Capacity") that is a heavily smoothed
estimate computed by `powerd`. The battery's own gas gauge often disagrees, sometimes by
10+ points, because months of shallow, plugged-in charging starve both estimators of the
full-range discharge data they calibrate against.

BattCal automates the fix: it cycles your battery through complete, controlled
calibration cycles (drain to 5% -> charge to 100% -> hold -> repeat) while the charger
stays plugged in, so both the gauge and macOS re-learn the battery's true capacity.

## What it looks like

```
menu bar (icon-only by default, so it stays clean):
   [band glyph]    idle / holding - a battery-block mark, no redundant %
   ⚡ +38W · 1:12   charging - watts + time to full
   ⇣ -22W          draining in calibration
   ⏸               paused - normal charging
   ⚠               server unreachable
```

Left-click opens the popover; right-click the menu bar item cycles the readout
(icon only -> time left -> watts -> true health -> watts + time). Icon only is the
default, and macOS already shows the charge %, so BattCal never repeats it.

One click on **Normal charging** in the popover pauses everything and charges at full
speed; one click on **Longevity** or **Calibration** picks the cycle back up. Every
completed cycle appends a row to a CSV so you can watch the numbers converge:

```csv
date,cycle_count,raw_mAh,nominal_mAh,apple_health
2026-07-01 20:34,352,4888,5038,89%
```

## Why the numbers disagree (the 30-second version)

For a 2023 MacBook Pro 14" that read **89%** in System Settings, the gauge itself said:

| Source (read from the bq40z651 gauge) | Value | % of design |
|---|---|---|
| AppleRawMaxCapacity (what coconutBattery shows) | 4,700 mAh | 77.4% |
| NominalChargeCapacity | 4,850 mAh | 79.8% |
| Apple's smoothed "Maximum Capacity" | | **89%** |

Neither number is a lie: the raw value is the gauge's live usable-capacity estimate
(which goes stale low under shallow usage), and Apple's number is a long-window filtered
metric (which goes stale high). Full-range cycles give both estimators real data. After
one BattCal cycle on that same machine, the raw estimate re-learned from 77.4% to 80.6%.
Calibration converges on the truth, in whichever direction the truth lies.

## How it works

- **[batt](https://github.com/charlie0129/batt)** (open source) provides the one
  superpower this needs: software-cutting the power adapter so the Mac runs on battery
  while physically plugged in.
- A tiny **LaunchAgent state machine** (`battcal-engine.sh`, ~400 lines of bash) does
  drain -> charge -> hold -> repeat, with `caffeinate -i` holding the Mac awake during
  drains so they actually progress.
- **Plugged-in-only:** the engine detects the physical charger via `AdapterDetails` in
  the SMC (which survives the software cut, unlike `ExternalConnected`). Unplug and it
  instantly restores normal charging behavior and stops blocking sleep until AC returns.
- A **native SwiftUI menu bar app** (`menubar/`, macOS 14+) shows a state-aware battery-block glyph plus an optional readout you right-click to cycle (icon only, watts + time, time-left, watts, or true health), a 3h sparkline, mode switcher, and one-click pause/off. Get it prebuilt from [Releases](https://github.com/parsamivehchi/battcal/releases) (no Xcode needed), or build it: `cd menubar && xcodegen && xcodebuild -project BattCalBar.xcodeproj -scheme BattCalBar -configuration Release -derivedDataPath build build`, then copy `BattCalBar.app` to /Applications. A lighter **SwiftBar plugin** (`swiftbar/`) remains for anyone who prefers it; run one or the other, not both.
- A **web dashboard** (`dashboard/` + `server/`) with live charts: battery %, power flow, temperature, and health-per-cycle, band shading, cycle table, event log, mode/pause controls, and an Auto/Light/Dark theme that follows the system appearance.
- Survives reboots. Pause state is a file (`/var/tmp/battcal.pause`), so anything can
  toggle it: the menu bar, a Shortcut, cron, or you.

## Install

Requirements: Apple Silicon Mac, [Homebrew](https://brew.sh).

```sh
git clone https://github.com/parsamivehchi/battcal.git
cd battcal
./install.sh                # engine + dashboard backend; add --swiftbar only if you
                            # prefer the SwiftBar plugin over the native app below
```

The installer asks for your password once (the batt daemon is a system service).
**BattCal installs paused**: nothing about your charging changes until you click
**Resume Calibration** in the menu bar (or `rm /var/tmp/battcal.pause`).

### Prebuilt menu bar app (no Xcode)

Prefer not to build the Swift app? Download `BattCalBar.app` from the
[latest release](https://github.com/parsamivehchi/battcal/releases/latest), unzip it, and
move it to `/Applications`. It is ad-hoc signed (not notarized), so clear the download
quarantine once: `xattr -dr com.apple.quarantine /Applications/BattCalBar.app` (or
right-click the app, Open, Open). The app is the front-end for the engine + dashboard, so
run `./install.sh` above for the backend either way.

Maintainer: `./deploy.sh release vX.Y.Z` builds, ad-hoc signs, zips, and publishes the
release (`--dry-run` previews the artifact without publishing).

## Controls

| Action | Menu bar app | Terminal |
|---|---|---|
| Pause + charge at full speed now | select **Normal charging** | `touch /var/tmp/battcal.pause` |
| Resume cycling | select **Longevity** or **Calibration** | `rm /var/tmp/battcal.pause` |
| Timed full-speed break (auto-resumes) | banner button during a drain | `echo $(($(date +%s)+1800)) > /var/tmp/battcal.pause` |
| Watch live | Open dashboard (event log) | `tail -f ~/Library/Logs/battcal.log` |
| Per-cycle history | Open dashboard (cycle table) | `open ~/Library/Logs/battcal-history.csv` |
| Stop everything | Quit, then uninstall | `./uninstall.sh` |

Config overrides live in `~/.battcal/config` (sourced by the engine). Only the
variables the engine actually reads apply; these are their real names and defaults:

```sh
LONGEVITY_LOW=10    # longevity band floor, percent
LONGEVITY_HIGH=90   # longevity band ceiling, percent
CALIBRATION_LOW=5   # calibration drain floor, percent
HOLD_SECS=3600      # calibration: hold at 100% this long, seconds
POLL=15             # check interval, seconds
LOAD_THRESHOLD=8.0  # 1-min load average that counts as "CPU genuinely pegged"
LOAD_RESUME=6.0     # resume draining only after load falls below this...
RESUME_DEBOUNCE=3   # ...for this many consecutive polls
LED_SCHEME=battcal  # battcal | truthful | off (see the LED table below)
BATT=/opt/homebrew/bin/batt
```

## Home-only cycling (Wi-Fi gate)

The menu bar app can gate cycling on your Wi-Fi network, so BattCal drains only at
home or the office and a plugged-in Mac in a cafe or meeting room charges like a
normal Mac. Configure it in **Settings > Home Cycling**: toggle the gate and add your
network names. The list ships empty; until you add a network, gated cycling stays off
everywhere (fail-safe: BattCal never drains anywhere it has not been told is home).

How it works: the app reads the current SSID (macOS requires Location permission for
that - grant it once when prompted) and publishes an at-home signal to
`/var/tmp/battcal-athome`. The engine treats a missing or stale (>90 s) signal as
away, so quitting the app, revoking Location, or any glitch fails safe to normal
charging. Turning the gate off cycles on every network, matching the pre-gate behavior.

## Genius Bar prep & evidence report

The dashboard has a collapsible "Genius Bar prep" card that turns BattCal's telemetry
into an honest, printable AppleCare evidence one-pager. It leads with the macOS
"Maximum Capacity" number and Condition flag (what Apple actually decides on), then
documents real behavioral evidence computed from telemetry: estimated runtime,
internal resistance (pack voltage vs current slope), any unexpected shutdowns
(telemetry gaps at healthy charge), temperature ranges, and the degradation-vs-cycles
projection. If the data shows no symptoms, it says so plainly and states the honest
odds. "Start prep cycle" runs a full 5-100% calibration pass the evening before an
appointment so macOS re-estimates capacity (it nudges the real number, it does not
fake it). "Print / Save PDF" isolates the report for printing.

The engine also fires a one-time macOS notification if the battery Condition ever
changes to "Service Recommended" (the moment to book a visit).

This is deliberately honest: it never fabricates symptoms and never suggests claiming
the battery was drained to game the 80% threshold. Raw-gauge numbers are shown only as
secondary "for your records" data, because Apple dismisses third-party readings.

## The charger light is the status light

BattCal drives the MagSafe LED so the connector itself tells you what is happening
(the hardware has only amber and green diodes; no other colors are physically
possible, so BattCal uses *states* instead):

| LED (while plugged in) | Meaning |
|---|---|
| **Dark** | Draining in longevity mode. A normal Mac never shows a dark connector, so dark = BattCal is working. |
| **Slow green pulse** | Calibration-mode drain (heartbeat, ~30s). |
| **Amber** | Actually charging. |
| **Green** | At target / full, not charging. |
| Normal Apple behavior | Paused or off. |

Opt out with `LED_SCHEME=truthful` (LED always reflects charging) or
`LED_SCHEME=off` (never touch the LED) in `~/.battcal/config`.

## Honesty and safety notes

- **Calibration reveals the truth; it does not manufacture a number.** If you are hoping
  to push a battery below a warranty threshold, know that the corrected reading can go
  *up* (it did on the machine this was built on). What you get is accuracy.
- Cycling adds normal wear (a 5-100% cycle is one cycle count). The engine never
  discharges below 5% and macOS's own emergency hibernation remains the backstop.
- During drain phases the Mac stays awake (idle sleep blocked). Lid-close sleep still
  works and simply slows the drain to near zero until you reopen it.
- `batt status` is broken on some macOS 26 firmware ("key has no data", upstream
  [#91](https://github.com/charlie0129/batt/issues/91)); BattCal does not use it. Adapter
  control, the only thing it needs, works.

## Uninstall

```sh
./uninstall.sh            # remove engine + plugin, restore normal charging
./uninstall.sh --daemon   # also remove the batt system daemon
```

## Development

After editing the source, `./deploy.sh` rebuilds and redeploys every live surface
(engine, dashboard server + SPA, menu bar app), verifies each, and never changes your
charging. It auto-detects your install and derives all paths, so there is nothing to
configure.

```sh
./deploy.sh                 # build + deploy + verify everything
./deploy.sh [engine|server|dashboard|menubar|verify|release vX.Y.Z]
./deploy.sh --dry-run       # show what it would do, run nothing
./scripts/check.sh          # the quality gate deploy.sh runs first (read-only)
```

The deployed engine is generated from `bin/battcal-engine.sh` (the single source);
edit that file, not the deployed copy.

## Credits and license

- Engine, installer, and SwiftBar plugin: MIT (c) 2026 Parsa Mivehchi.
- Charging control by [batt](https://github.com/charlie0129/batt) (GPL-2.0), invoked as
  an external binary; it is installed via Homebrew, not bundled here.
- Menu bar rendering by [SwiftBar](https://github.com/swiftbar/SwiftBar) (MIT), optional.

*BattCal manipulates charging behavior. It is provided as-is; read the ~400 lines of
bash before trusting it, which is the whole point of it being this small.*
