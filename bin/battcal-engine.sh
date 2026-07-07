#!/bin/bash
# battcal-engine.sh - battery band cycler for Apple Silicon MacBooks.
#
# Runs as a user LaunchAgent (com.battcal.calibrate). Requires the batt daemon
# (https://github.com/charlie0129/batt) running with --always-allow-non-root-access.
#
# TWO MODES (switch anytime via the mode file, dashboard, or menu bar app):
#   longevity  (default) drain to 10% -> charge to 90% -> repeat. Never sits at
#              100%, never even reaches it. Kind to the cells.
#   calibration          drain to 5% -> charge to 100% + hold 1h -> repeat.
#              Full-range passes that re-train the gauge and powerd health.
#
# Cycling only runs while a charger is physically attached; unplug and the Mac
# behaves like a normal Mac until AC returns. The drain phase is gated on CPU load: it
# discharges in every light or idle case (whether you are here or away) and holds the
# adapter (full performance) only while a heavy job pegs the CPU past LOAD_THRESHOLD,
# the sole case where running on battery would actually throttle Apple Silicon.
#
# Mode file:  /var/tmp/battcal.mode   (longevity when absent)
# Pause:      touch /var/tmp/battcal.pause   (instant normal charging)
# Resume:     rm /var/tmp/battcal.pause
# Benchmark break (timed pause, auto-resumes): write a future unix epoch into the
#             pause file, e.g. echo $(( $(date +%s) + 1800 )) > /var/tmp/battcal.pause
#             (empty file = indefinite pause; a numeric epoch resumes once it passes)
# Off:        launchctl bootout gui/$(id -u)/com.battcal.calibrate ; batt adapter enable
# Watch:      tail -f ~/Library/Logs/battcal.log
# History:    ~/Library/Logs/battcal-history.csv (one row per cycle)
# Telemetry:  ~/Library/Logs/battcal-telemetry.csv (one row per poll, 15s)
#
# Config (optional): ~/.battcal/config may override POLL, HOLD_SECS,
# LONGEVITY_LOW, LONGEVITY_HIGH, CALIBRATION_LOW, BATT, LOAD_THRESHOLD.

BATT=/opt/homebrew/bin/batt
STATE_FILE=/var/tmp/battcal.state
PAUSE_FILE=/var/tmp/battcal.pause
MODE_FILE=/var/tmp/battcal.mode
HOLD_FILE=/var/tmp/battcal.holdstart
CYCLE_FILE=/var/tmp/battcal.cyclestart
CAFF_PID_FILE=/var/tmp/battcal.caffeinate.pid
# Home-only cycling gate, published by the menu bar app. These fixed paths are intentionally OUTSIDE
# the namespaced "/var/tmp/battcal." family (the app is a single binary, not namespace-transformed).
HOMEGATE_FLAG="$HOME/.battcal/homegate.on"   # exists => the "only cycle on home Wi-Fi" gate is ON
ATHOME_FILE=/var/tmp/battcal-athome          # app writes "1|0" + a unix ts; stale/missing => away
ATHOME_MAX_AGE=90                            # seconds; an older signal is treated as away (fail-safe)
LOG="$HOME/Library/Logs/battcal.log"
CSV="$HOME/Library/Logs/battcal-history.csv"
TELEMETRY="$HOME/Library/Logs/battcal-telemetry.csv"
POLL=15           # seconds between checks (short = fast full-power handback when you return)
HOLD_SECS=3600    # calibration only: hold at 100% this long
LONGEVITY_LOW=10  # longevity band
LONGEVITY_HIGH=90
CALIBRATION_LOW=5
LOAD_THRESHOLD=${LOAD_THRESHOLD:-8.0}   # 1-min load avg that counts as "CPU genuinely pegged"
                                        # (12-core box; idle baseline ~4.5, a real all-core job hits 12-20)
LOAD_RESUME=${LOAD_RESUME:-6.0}         # resume drain only after load falls BELOW this (deadband under THRESHOLD)
RESUME_DEBOUNCE=${RESUME_DEBOUNCE:-3}   # ...held for this many consecutive polls (~45s at the 15s poll)

# shellcheck source=/dev/null
[ -f "$HOME/.battcal/config" ] && . "$HOME/.battcal/config"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

mode() {
  local m
  m=$(cat "$MODE_FILE" 2>/dev/null)
  case "$m" in calibration) echo calibration ;; *) echo longevity ;; esac
}

pct() { pmset -g batt | grep -Eo '[0-9]+%' | head -1 | tr -d '%'; }

LAST_CONDITION=""
# Watch macOS "Condition" (Normal / Service Recommended). When it flips to
# Service Recommended, notify once - that is the moment to go to the Genius Bar.
check_condition() {
  local c
  c=$(system_profiler SPPowerDataType 2>/dev/null | sed -n 's/.*Condition: *//p' | head -1)
  [ -z "$c" ] && return
  # Alert when the Condition is (or becomes) a "service" flag. Fire on the first non-empty read too,
  # not only on a change, so a battery already flagged when the engine starts is not missed.
  if [ "$c" != "$LAST_CONDITION" ]; then
    [ -n "$LAST_CONDITION" ] && log "battery Condition changed: $LAST_CONDITION -> $c"
    if echo "$c" | grep -qi 'service'; then
      osascript -e "display notification \"macOS now flags this battery: $c. Book a Genius Bar visit.\" with title \"BattCal\" sound name \"Glass\"" >/dev/null 2>&1
    fi
  fi
  LAST_CONDITION=$c
}

fully_charged() {
  ioreg -rn AppleSmartBattery | sed -n 's/^ *"FullyCharged" = \(.*\)$/\1/p'
}

is_charging() { pmset -g batt | grep -q '; charging;'; }

# Physically plugged in? ExternalConnected reads No while batt has the adapter
# software-cut, but AdapterDetails keeps the real charger info (Watts>0) either way.
plugged() {
  ioreg -rn AppleSmartBattery | grep '"AdapterDetails"' | grep -qE '"Watts"=[1-9]'
}

# Home-only cycling gate. Cycling is allowed when the gate is OFF, or ON and the menu bar app has
# RECENTLY confirmed we are on a home Wi-Fi network. A missing or stale signal counts as AWAY
# (fail-safe: never drain in public). Plug state is enforced separately by plugged().
home_ok() {
  [ -f "$HOMEGATE_FLAG" ] || return 0            # gate off => cycle anywhere
  [ -f "$ATHOME_FILE" ] || return 1              # gate on, no signal yet => away
  local mtime age
  mtime=$(stat -f %m "$ATHOME_FILE" 2>/dev/null || echo 0)
  age=$(( $(date +%s) - mtime ))
  [ "$age" -le "$ATHOME_MAX_AGE" ] || return 1   # stale signal => away
  [ "$(head -1 "$ATHOME_FILE" 2>/dev/null)" = "1" ]
}

# Hold the adapter (full plugged-in performance) ONLY when the CPU is genuinely pegged by
# a heavy sustained job - the sole case where running on battery would actually throttle
# you on Apple Silicon. Every lighter case (idle, light work, whether you are here or
# away) drains, to cycle the battery as much as safely possible for the AppleCare goal.
user_busy() {
  local load
  load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'); load=${load:-0}
  awk "BEGIN{exit !($load+0 >= $LOAD_THRESHOLD)}"
}

start_caffeinate() {
  if [ -f "$CAFF_PID_FILE" ] && kill -0 "$(cat "$CAFF_PID_FILE")" 2>/dev/null; then return; fi
  /usr/bin/caffeinate -i &
  echo $! > "$CAFF_PID_FILE"
  log "caffeinate -i started (pid $!) - idle sleep blocked for drain phase"
}

stop_caffeinate() {
  if [ -f "$CAFF_PID_FILE" ]; then
    kill "$(cat "$CAFF_PID_FILE")" 2>/dev/null
    rm -f "$CAFF_PID_FILE"
  fi
}

# MagSafe LED scheme (hardware has amber+green+off only; no other colors exist):
#   dark = BattCal draining (longevity) | slow green pulse = calibration drain
#   amber = actually charging | green = at target | normal Apple behavior = paused/off
# LED_SCHEME: battcal (default) | truthful (always reflect charging) | off (never touch)
LED_SCHEME=${LED_SCHEME:-battcal}
LED_STATE=""
led() {
  case "$LED_SCHEME" in
    off) return ;;
    truthful) set -- enable ;;
  esac
  [ "$1" = "$LED_STATE" ] && return
  LED_STATE=$1
  "$BATT" magsafe-led "$1" >>"$LOG" 2>&1
}

# One detailed row per poll: what the battery is doing right now.
log_telemetry() {
  local ior state chg pct rawcur rawmax mv ma temp aw watts
  ior=$(ioreg -rn AppleSmartBattery)
  state=$1; pct=$2
  chg=no; pmset -g batt | grep -q '; charging;' && chg=yes
  rawcur=$(echo "$ior" | sed -n 's/^ *"AppleRawCurrentCapacity" = \([0-9]*\)$/\1/p')
  rawmax=$(echo "$ior" | sed -n 's/^ *"AppleRawMaxCapacity" = \([0-9]*\)$/\1/p')
  mv=$(echo "$ior" | sed -n 's/^ *"Voltage" = \([0-9]*\)$/\1/p')
  ma=$(echo "$ior" | sed -n 's/^ *"Amperage" = \([0-9]*\)$/\1/p')
  # Amperage is unsigned 64-bit two's-complement in ioreg; a discharge reads as ~2^64-x.
  # Reinterpret the exact bits as signed via perl pack/unpack. Parsing the ~20-digit value
  # as a float first (awk, or $((...)) overflow) rounds to the nearest ~2048 near 2^64 and
  # quantizes every discharge reading, so keep the conversion in integer space.
  ma=$(perl -e 'print unpack("q", pack("Q", $ARGV[0] || 0))' "$ma" 2>/dev/null); ma=${ma:-0}
  temp=$(echo "$ior" | sed -n 's/^ *"Temperature" = \([0-9]*\)$/\1/p')
  temp=$(awk "BEGIN{printf \"%.1f\", ${temp:-0}/100}")
  aw=$(echo "$ior" | grep '"AdapterDetails"' | sed -n 's/.*"Watts"=\([0-9]*\).*/\1/p'); aw=${aw:-0}
  watts=$(awk "BEGIN{printf \"%.1f\", ${mv:-0}*${ma:-0}/1000000}")
  [ -f "$TELEMETRY" ] || echo "ts,state,pct,charging,raw_current_mAh,raw_max_mAh,voltage_mV,amperage_mA,battery_W,adapter_W,temp_C" > "$TELEMETRY"
  echo "$(date '+%Y-%m-%dT%H:%M:%S'),$state,$pct,$chg,$rawcur,$rawmax,$mv,$ma,$watts,$aw,$temp" >> "$TELEMETRY"
}

snapshot_csv() {
  local ior raw nom cyc apple cs dur
  ior=$(ioreg -rn AppleSmartBattery)
  raw=$(echo "$ior" | sed -n 's/^ *"AppleRawMaxCapacity" = \([0-9]*\)$/\1/p')
  nom=$(echo "$ior" | sed -n 's/^ *"NominalChargeCapacity" = \([0-9]*\)$/\1/p')
  cyc=$(echo "$ior" | sed -n 's/^ *"CycleCount" = \([0-9]*\)$/\1/p')
  apple=$(system_profiler SPPowerDataType 2>/dev/null | sed -n 's/.*Maximum Capacity: //p')
  cs=$(cat "$CYCLE_FILE" 2>/dev/null || echo 0)
  dur=""
  [ "$cs" -gt 0 ] 2>/dev/null && dur=$(( ($(date +%s) - cs) / 60 ))
  [ -f "$CSV" ] || echo "date,cycle_count,raw_mAh,nominal_mAh,apple_health,mode,band_low,band_high,duration_min" > "$CSV"
  echo "$(date '+%Y-%m-%d %H:%M'),$cyc,$raw,$nom,$apple,$MODE,$LOW,$HIGH,$dur" >> "$CSV"
}

begin_cycle() { date +%s > "$CYCLE_FILE"; }

trap 'stop_caffeinate; "$BATT" magsafe-led enable >/dev/null 2>&1' EXIT TERM INT

# v2.1: history CSV gained mode/band/duration columns; park legacy files aside.
if [ -f "$CSV" ] && ! head -1 "$CSV" | grep -q ',mode,'; then
  mv "$CSV" "${CSV%.csv}-v1.csv"
fi

[ -f "$STATE_FILE" ] || { echo drain > "$STATE_FILE"; date +%s > "$CYCLE_FILE"; }
STATE=$(cat "$STATE_FILE")
LAST_MODE=$(mode)
log "=== battcal engine started (state=$STATE, mode=$LAST_MODE, battery $(pct)%) ==="

# Reassert adapter mode for the state we woke up in (unless paused)
if [ ! -f "$PAUSE_FILE" ]; then
  case "$STATE" in
    # In drain, re-cut the adapter only if plugged AND the CPU is not pegged: unplugged there is
    # nothing to cut, and a restart during a heavy job would otherwise drain (and throttle) for one
    # poll until the loop re-checks load.
    drain)        if plugged && home_ok && ! user_busy; then "$BATT" adapter disable >>"$LOG" 2>&1; fi ;;
    charge|hold)  "$BATT" adapter enable  >>"$LOG" 2>&1 ;;
  esac
fi

DRAIN_PAUSED=0   # 1 while we hand power back mid-drain (user active or charger unplugged)
IDLE_STREAK=0    # consecutive low-load polls while paused; drives the resume debounce

while true; do
  # User pause switch. Empty file = indefinite pause (normal charging). A numeric
  # future epoch = timed "benchmark break": auto-resume once now passes it, so a
  # full-speed benchmark window closes itself even if every UI is shut.
  if [ -f "$PAUSE_FILE" ]; then
    BREAK_UNTIL=$(tr -dc '0-9' < "$PAUSE_FILE" 2>/dev/null)
    if [ -n "$BREAK_UNTIL" ] && [ "$(date +%s)" -ge "$BREAK_UNTIL" ]; then
      log "benchmark break elapsed - auto-resuming"
      rm -f "$PAUSE_FILE"          # fall through; the paused->drain block below re-cuts the adapter
    else
      if [ "$(cat "$STATE_FILE")" != "paused" ]; then
        log "PAUSED by user - adapter re-enabled, normal charging"
        "$BATT" adapter enable >>"$LOG" 2>&1
        led enable
        stop_caffeinate
        echo paused > "$STATE_FILE"
      fi
      sleep "$POLL"; continue
    fi
  fi

  STATE=$(cat "$STATE_FILE")
  if [ "$STATE" = "paused" ]; then
    log "RESUMED - entering drain"
    begin_cycle
    echo drain > "$STATE_FILE"; STATE=drain
    "$BATT" adapter disable >>"$LOG" 2>&1
  fi

  MODE=$(mode)
  if [ "$MODE" != "$LAST_MODE" ]; then
    log "mode switched: $LAST_MODE -> $MODE"
    LAST_MODE=$MODE
    # Leaving calibration while parked at 100% (hold): start draining now.
    if [ "$MODE" = "longevity" ] && [ "$STATE" = "hold" ]; then
      log "longevity mode does not hold at full - switching to DRAIN"
      "$BATT" adapter disable >>"$LOG" 2>&1
      begin_cycle
      echo drain > "$STATE_FILE"; STATE=drain
    fi
  fi
  if [ "$MODE" = "longevity" ]; then LOW=$LONGEVITY_LOW; HIGH=$LONGEVITY_HIGH; else LOW=$CALIBRATION_LOW; HIGH=100; fi

  P=$(pct)
  if [ -z "$P" ]; then sleep "$POLL"; continue; fi

  log_telemetry "$STATE" "$P"
  # check_condition spawns system_profiler (~1-2s), so throttle it to ~every 60s rather
  # than every poll now that the poll is a snappy 15s (activity response stays fast).
  TICK=$(( (${TICK:-0} + 1) % 4 ))
  [ "$TICK" -eq 0 ] && check_condition

  case "$STATE" in
    drain)
      if [ "$P" -le "$LOW" ]; then
        log "reached ${P}% - switching to CHARGE (mode=$MODE, target ${HIGH}%)"
        "$BATT" adapter enable >>"$LOG" 2>&1
        stop_caffeinate
        DRAIN_PAUSED=0
        echo charge > "$STATE_FILE"
      else
        # Only discharge when plugged in AND the user is idle AND the CPU is not
        # busy, so active work and heavy compute always run on full plugged-in
        # performance (the adapter stays enabled). Discharge resumes once idle.
        # Load hysteresis: pause FAST (user_busy: load >= THRESHOLD), resume SLOW - only
        # after load falls below LOAD_RESUME for RESUME_DEBOUNCE consecutive polls. The
        # deadband + debounce stop the adapter/LED from flapping when load straddles the
        # threshold during bursty work. The protective (pause) side stays one-poll immediate.
        if [ "$DRAIN_PAUSED" -eq 1 ]; then
          load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'); load=${load:-0}
          if awk "BEGIN{exit !($load+0 < $LOAD_RESUME)}"; then IDLE_STREAK=$(( IDLE_STREAK + 1 ))
          else IDLE_STREAK=0; fi
          [ "$IDLE_STREAK" -ge "$RESUME_DEBOUNCE" ] && load_hold=0 || load_hold=1
        else
          IDLE_STREAK=0
          if user_busy; then load_hold=1; else load_hold=0; fi
        fi
        reason=""
        if ! plugged; then reason="charger unplugged"
        elif ! home_ok; then reason="away from home"
        elif [ "$load_hold" -eq 1 ]; then reason="CPU pegged (heavy job)"
        fi
        if [ -n "$reason" ]; then
          # Not allowed to drain: hand power back (full performance), hold the drain.
          if [ "$DRAIN_PAUSED" -eq 0 ]; then
            log "drain paused at ${P}% ($reason) - adapter enabled, full performance"
            "$BATT" adapter enable >>"$LOG" 2>&1
            led enable
            stop_caffeinate
            DRAIN_PAUSED=1
          fi
        else
          # Allowed to drain: cut the adapter and discharge.
          if [ "$DRAIN_PAUSED" -eq 1 ]; then
            log "idle again at ${P}% - resuming drain (adapter cut)"
            "$BATT" adapter disable >>"$LOG" 2>&1
            DRAIN_PAUSED=0
          fi
          start_caffeinate
          if [ "$MODE" = "longevity" ]; then
            led always-off
          else
            # calibration heartbeat: alternate dark/green once per poll
            if [ "${LED_PULSE:-0}" -eq 0 ]; then led always-off; LED_PULSE=1; else led enable; LED_PULSE=0; fi
          fi
          # If something re-enabled charging (batt daemon restart etc.), reassert the cut
          if is_charging; then
            log "charging detected during drain at ${P}% - reasserting adapter disable"
            "$BATT" adapter disable >>"$LOG" 2>&1
          fi
        fi
      fi
      ;;
    charge)
      led enable
      if [ "$MODE" = "longevity" ]; then
        if [ "$P" -ge "$HIGH" ]; then
          snapshot_csv
          log "reached ${P}% - longevity turnaround (never charging to 100%), switching to DRAIN"
          "$BATT" adapter disable >>"$LOG" 2>&1
          begin_cycle
          echo drain > "$STATE_FILE"
        fi
      else
        if [ "$P" -ge 99 ] && [ "$(fully_charged)" = "Yes" ]; then
          log "fully charged at ${P}% - holding $((HOLD_SECS/60)) min (calibration)"
          date +%s > "$HOLD_FILE"
          echo hold > "$STATE_FILE"
        fi
      fi
      ;;
    hold)
      led enable
      # Hold only exists in calibration mode; in longevity, leave full immediately.
      if [ "$MODE" = "longevity" ]; then
        snapshot_csv
        log "longevity mode does not hold at full - switching to DRAIN"
        "$BATT" adapter disable >>"$LOG" 2>&1
        begin_cycle
        echo drain > "$STATE_FILE"
        sleep "$POLL"; continue
      fi
      HS=$(cat "$HOLD_FILE" 2>/dev/null || echo 0)
      if [ $(( $(date +%s) - HS )) -ge "$HOLD_SECS" ]; then
        snapshot_csv
        log "hold complete - snapshot logged, switching to DRAIN"
        "$BATT" adapter disable >>"$LOG" 2>&1
        begin_cycle
        echo drain > "$STATE_FILE"
      fi
      ;;
  esac

  sleep "$POLL"
done
