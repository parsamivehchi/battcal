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
# Schedule:   ~/.battcal/schedule with DAYS=12345 START=0800 END=1800 cycles only
#             inside that window (off hours = normal Apple charging to 100%).
#             Manual pause/resume/mode actions win until the next boundary.
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
RESTART_MARKER=/var/tmp/battcal.managed-restart   # deploy.sh touches this right before its kickstart
# Home-only cycling gate, published by the menu bar app. These fixed paths are intentionally OUTSIDE
# the namespaced "/var/tmp/battcal." family (the app is a single binary, not namespace-transformed).
HOMEGATE_FLAG="$HOME/.battcal/homegate.on"   # exists => the "only cycle on home Wi-Fi" gate is ON
ATHOME_FILE=/var/tmp/battcal-athome          # app writes "1|0" + a unix ts; stale/missing => away
ATHOME_MAX_AGE=90                            # seconds; an older signal is treated as away (fail-safe)
# Work-schedule gate. ~/.battcal/schedule (shared, like config) holds DAYS=12345 START=0800 END=1800;
# file present + valid => cycle only inside the window, off hours = normal Apple charging. The engine
# enforces it by writing the next window-start epoch into the pause file ("<epoch> schedule"), so the
# existing timed-pause logic does the resuming. See schedule_check() below.
SCHEDULE_FILE="$HOME/.battcal/schedule"
SCHED_PHASE_FILE=/var/tmp/battcal.schedule-phase       # last observed phase (in|out); detects boundary crossings
SCHED_OVERRIDE_FILE=/var/tmp/battcal.schedule-override # touched by the server on manual actions; suspends steady-state enforcement until the next boundary
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
  ioreg -rn AppleSmartBattery 2>/dev/null | sed -n 's/^ *"FullyCharged" = \(.*\)$/\1/p'
}

is_charging() { pmset -g batt | grep -q '; charging;'; }

# Physically plugged in? ExternalConnected reads No while batt has the adapter
# software-cut, but AdapterDetails keeps the real charger info (Watts>0) either way.
plugged() {
  ioreg -rn AppleSmartBattery 2>/dev/null | grep '"AdapterDetails"' | grep -qE '"Watts"=[1-9]'
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

# --- Work-schedule gate -------------------------------------------------------
# Parse ~/.battcal/schedule (never sourced - defensively extracted), cached on CONTENT
# (mtime has 1s resolution, so two rapid UI edits in the same second would stick the
# engine on the first; the file is 3 lines, re-reading every poll is free). Valid file
# => SCHED_VALID=1 with SCHED_DAYS (ISO weekday digits, 1=Mon..7=Sun) and
# SCHED_START/SCHED_END (HHMM, start < end). Invalid => logged once, schedule ignored
# (fail-safe: behaves exactly like no schedule). NOTE: HHMM values keep leading zeros;
# compare them only with [ -ge/-lt ] (decimal), never $(( )) (octal trap).
SCHED_RAW="unread" SCHED_DAYS="" SCHED_START="" SCHED_END="" SCHED_VALID=0
parse_schedule() {
  local raw
  raw=$(cat "$SCHEDULE_FILE" 2>/dev/null)
  if [ -z "$raw" ]; then   # missing (or empty) file = schedule off, silently
    SCHED_VALID=0; SCHED_RAW=""; return
  fi
  [ "$raw" = "$SCHED_RAW" ] && return
  SCHED_RAW=$raw
  SCHED_DAYS=$(printf '%s\n' "$raw" | sed -n 's/^DAYS=\([1-7]\{1,7\}\).*/\1/p' | head -1)
  SCHED_START=$(printf '%s\n' "$raw" | sed -n 's/^START=\([0-9]\{4\}\).*/\1/p' | head -1)
  SCHED_END=$(printf '%s\n' "$raw" | sed -n 's/^END=\([0-9]\{4\}\).*/\1/p' | head -1)
  if [ -n "$SCHED_DAYS" ] && [ -n "$SCHED_START" ] && [ -n "$SCHED_END" ] \
     && [ "$SCHED_START" -lt "$SCHED_END" ] 2>/dev/null; then
    SCHED_VALID=1
    log "schedule loaded: days=$SCHED_DAYS window=$SCHED_START-$SCHED_END"
  else
    SCHED_VALID=0
    log "schedule file invalid - ignored (need DAYS=<1-7 digits>, START/END=HHMM, START<END)"
  fi
}

# Current schedule phase: "in" (cycling window) or "out" (off hours).
schedule_phase() {
  local dow now
  dow=$(date +%u); now=$(date +%H%M)
  case "$SCHED_DAYS" in *"$dow"*)
    if [ "$now" -ge "$SCHED_START" ] && [ "$now" -lt "$SCHED_END" ]; then echo in; return; fi ;;
  esac
  echo out
}

# Epoch of the next window start (today if before START, else the next scheduled day).
next_start_epoch() {
  local i d dow now
  dow=$(date +%u); now=$(date +%H%M)
  for i in 0 1 2 3 4 5 6 7; do
    d=$(( (dow - 1 + i) % 7 + 1 ))
    case "$SCHED_DAYS" in *"$d"*) ;; *) continue ;; esac
    if [ "$i" -eq 0 ] && [ "$now" -ge "$SCHED_START" ]; then continue; fi
    date -j -v+"${i}"d -f "%H%M%S" "${SCHED_START}00" +%s 2>/dev/null
    return
  done
}

# Write the schedule pause: a timed pause until the next window start, tagged "schedule"
# so the server can label it off-hours (tr -dc '0-9' in the pause reader ignores the tag).
schedule_pause() {
  local until
  until=$(next_start_epoch)
  if [ -z "$until" ]; then
    log "schedule: could not compute next window start - leaving state untouched"
    return
  fi
  log "schedule: off hours - normal charging until $(date -r "$until" '+%a %H:%M' 2>/dev/null)"
  echo "$until schedule" > "$PAUSE_FILE"
}

# Called at the top of every poll, BEFORE the pause check. Boundary transitions clear the
# manual override and assert the schedule (out => timed pause, in => resume). Steady-state:
# off hours with no pause and no override => re-assert the pause (covers restarts and
# sleeping through the boundary). Inside the window nothing is forced, so a manual pause
# during work hours is respected until the next boundary.
schedule_check() {
  parse_schedule
  if [ "$SCHED_VALID" -ne 1 ]; then
    rm -f "$SCHED_PHASE_FILE" "$SCHED_OVERRIDE_FILE"
    return
  fi
  local phase prev
  phase=$(schedule_phase)
  prev=$(cat "$SCHED_PHASE_FILE" 2>/dev/null)
  echo "$phase" > "$SCHED_PHASE_FILE"
  if [ -n "$prev" ] && [ "$prev" != "$phase" ]; then
    rm -f "$SCHED_OVERRIDE_FILE"
    if [ "$phase" = "out" ]; then
      schedule_pause
    else
      log "schedule: work hours started - resuming cycling"
      rm -f "$PAUSE_FILE"
    fi
    return
  fi
  if [ "$phase" = "out" ] && [ ! -f "$PAUSE_FILE" ] && [ ! -f "$SCHED_OVERRIDE_FILE" ]; then
    schedule_pause
  fi
}
# --- end work-schedule gate ----------------------------------------------------

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
  ior=$(ioreg -rn AppleSmartBattery 2>/dev/null)
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
  ior=$(ioreg -rn AppleSmartBattery 2>/dev/null)
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

# On an UNMANAGED death, never leave a plugged Mac stranded on a software-cut adapter:
# re-enable it on the way out. deploy.sh touches RESTART_MARKER right before its
# kickstart, so a deploy skips the re-enable and the in-flight drain phase carries
# straight through the relaunch (the startup reassert above restores the cut).
# launchd's KeepAlive covers the SIGKILL/panic case this trap can never see.
exit_adapter_guard() {
  local m
  m=$(stat -f %m "$RESTART_MARKER" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - m )) -gt 30 ]; then
    "$BATT" adapter enable >/dev/null 2>&1
  fi
}
trap 'stop_caffeinate; exit_adapter_guard; "$BATT" magsafe-led enable >/dev/null 2>&1' EXIT TERM INT

# Enter the drain state, cutting the adapter ONLY if the drain gates pass right now;
# otherwise start drain in the held state (adapter untouched, DRAIN_PAUSED=1) and let
# the loop's gate logic decide. Cutting unconditionally used to buy one 15 s drain and
# an LED flap per turnaround whenever the Mac was away, unplugged, or CPU-pegged.
enter_drain() {
  begin_cycle
  echo drain > "$STATE_FILE"
  FULL_SINCE=""
  if plugged && home_ok && ! user_busy; then
    "$BATT" adapter disable >>"$LOG" 2>&1
    DRAIN_PAUSED=0
  else
    log "entering DRAIN held (adapter untouched - unplugged, away, or CPU busy)"
    DRAIN_PAUSED=1
  fi
}

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
  # Work schedule (if ~/.battcal/schedule exists): assert cycling inside the window,
  # normal Apple charging outside it, before the pause switch reads the result.
  schedule_check

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
    # Resume = a fresh cycle BY DESIGN (even mid-charge: the user asked to cycle, so cycle
    # from wherever the battery sits). The adapter is only cut if the gates pass right now.
    log "RESUMED - entering drain"
    enter_drain; STATE=drain
  fi

  MODE=$(mode)
  if [ "$MODE" != "$LAST_MODE" ]; then
    log "mode switched: $LAST_MODE -> $MODE"
    LAST_MODE=$MODE
    # Leaving calibration while parked at 100% (hold): start draining now.
    if [ "$MODE" = "longevity" ] && [ "$STATE" = "hold" ]; then
      log "longevity mode does not hold at full - switching to DRAIN"
      enter_drain; STATE=drain
    fi
  fi
  if [ "$MODE" = "longevity" ]; then LOW=$LONGEVITY_LOW; HIGH=$LONGEVITY_HIGH; else LOW=$CALIBRATION_LOW; HIGH=100; fi

  P=$(pct)
  if [ -z "$P" ]; then sleep "$POLL"; continue; fi

  # A transient empty ioreg read (IOKit lookup during wake) would write a polluted
  # telemetry row (blank capacity/mV/mA, 0.0 watts/temp) and make plugged() read
  # unplugged for one poll - skip the whole iteration instead.
  if [ -z "$(ioreg -rn AppleSmartBattery 2>/dev/null)" ]; then
    log "ioreg returned nothing (transient wake glitch) - skipping this poll"
    sleep "$POLL"; continue
  fi

  # Rotate runaway logs (~150 KB/day each; the server reparses the telemetry CSV per
  # request) at startup and then hourly. One prior generation is kept; log_telemetry
  # rewrites a fresh header, so a mid-file duplicate header can never appear.
  if [ "${ROT_TICK:-0}" -eq 0 ]; then
    for f in "$TELEMETRY" "$LOG"; do
      sz=$(stat -f %z "$f" 2>/dev/null || echo 0)
      if [ "$sz" -gt 5242880 ]; then mv "$f" "$f.1" && log "rotated $f ($sz bytes) -> $f.1"; fi
    done
  fi
  ROT_TICK=$(( (${ROT_TICK:-0} + 1) % 240 ))

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
          enter_drain
        fi
      else
        if [ "$P" -ge 99 ] && [ "$(fully_charged)" = "Yes" ]; then
          log "fully charged at ${P}% - holding $((HOLD_SECS/60)) min (calibration)"
          date +%s > "$HOLD_FILE"
          echo hold > "$STATE_FILE"
          FULL_SINCE=""
        elif [ "$P" -ge 100 ]; then
          # Fallback for a pack that never reports FullyCharged=Yes: 30 min parked at
          # 100% counts as full. Without this the engine would sit at 100% with the
          # adapter on indefinitely - the exact state BattCal exists to avoid.
          FULL_SINCE=${FULL_SINCE:-$(date +%s)}
          if [ $(( $(date +%s) - FULL_SINCE )) -ge 1800 ]; then
            log "at 100% for 30 min without FullyCharged=Yes - counting as full, holding"
            date +%s > "$HOLD_FILE"
            echo hold > "$STATE_FILE"
            FULL_SINCE=""
          fi
        else
          FULL_SINCE=""
        fi
      fi
      ;;
    hold)
      led enable
      # Hold only exists in calibration mode; in longevity, leave full immediately.
      if [ "$MODE" = "longevity" ]; then
        snapshot_csv
        log "longevity mode does not hold at full - switching to DRAIN"
        enter_drain
        sleep "$POLL"; continue
      fi
      HS=$(cat "$HOLD_FILE" 2>/dev/null || echo 0)
      if [ $(( $(date +%s) - HS )) -ge "$HOLD_SECS" ]; then
        snapshot_csv
        log "hold complete - snapshot logged, switching to DRAIN"
        enter_drain
      fi
      ;;
  esac

  sleep "$POLL"
done
