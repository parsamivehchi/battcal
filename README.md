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
menu bar:   ⇣ 27%          draining (calibration active)
            ⇡ 78%          charging back to 100%
            ✓ 100%         holding at full
            ⏸ 55%          paused - normal charging
            🔌⌛ 45%        unplugged - calibration idle
```

One click on **⚡ Charge Now** pauses everything and charges at full speed. One click on
**▶ Resume Calibration** picks the cycle back up. Every completed cycle appends a row to
a CSV so you can watch the numbers converge:

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
- A tiny **LaunchAgent state machine** (`battcal-engine.sh`, ~180 lines of bash) does
  drain -> charge -> hold -> repeat, with `caffeinate -i` holding the Mac awake during
  drains so they actually progress.
- **Plugged-in-only:** the engine detects the physical charger via `AdapterDetails` in
  the SMC (which survives the software cut, unlike `ExternalConnected`). Unplug and it
  instantly restores normal charging behavior and stops blocking sleep until AC returns.
- A **native SwiftUI menu bar app** (`menubar/`, macOS 14+) shows a live battery glyph plus a configurable readout (time-to-target, watts, percent, or true health), a 3h sparkline, mode switcher, and one-click pause/off. Build: `cd menubar && xcodegen && xcodebuild -project BattCalBar.xcodeproj -scheme BattCalBar -configuration Release -derivedDataPath build build`, then copy `BattCalBar.app` to /Applications. A lighter **SwiftBar plugin** (`swiftbar/`) remains for anyone who prefers it; run one or the other, not both.
- A **web dashboard** (`dashboard/` + `server/`) with live charts: battery %, power flow, temperature, and health-per-cycle, band shading, cycle table, event log, mode/pause controls, and an Auto/Light/Dark theme that follows the system appearance.
- Survives reboots. Pause state is a file (`/var/tmp/battcal.pause`), so anything can
  toggle it: the menu bar, a Shortcut, cron, or you.

## Install

Requirements: Apple Silicon Mac, [Homebrew](https://brew.sh).

```sh
git clone https://github.com/parsamivehchi/battcal.git
cd battcal
./install.sh --swiftbar     # or plain ./install.sh for no menu bar plugin
```

The installer asks for your password once (the batt daemon is a system service).
**BattCal installs paused**: nothing about your charging changes until you click
**Resume Calibration** in the menu bar (or `rm /var/tmp/battcal.pause`).

## Controls

| Action | Menu bar | Terminal |
|---|---|---|
| Pause + charge at full speed now | ⚡ Charge Now | `touch /var/tmp/battcal.pause` |
| Resume cycling | ▶ Resume Calibration | `rm /var/tmp/battcal.pause` |
| Watch live | Open live log | `tail -f ~/Library/Logs/battcal.log` |
| Per-cycle history | Open cycle history | `open ~/Library/Logs/battcal-history.csv` |
| Stop everything | Advanced -> Stop Permanently | `./uninstall.sh` |

Config overrides live in `~/.battcal/config` (sourced by the engine):

```sh
LOW=10          # drain floor, percent (default 5)
HOLD_SECS=7200  # hold at 100% (default 3600)
POLL=15         # check interval seconds (default 30)
```

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

## Credits and license

- Engine, installer, and SwiftBar plugin: MIT (c) 2026 Parsa Mivehchi.
- Charging control by [batt](https://github.com/charlie0129/batt) (GPL-2.0), invoked as
  an external binary; it is installed via Homebrew, not bundled here.
- Menu bar rendering by [SwiftBar](https://github.com/swiftbar/SwiftBar) (MIT), optional.

*BattCal manipulates charging behavior. It is provided as-is; read the ~180 lines of
bash before trusting it, which is the whole point of it being this small.*
