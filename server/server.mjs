#!/usr/bin/env node
// BattCal dashboard server: zero-dependency Node HTTP server.
// Serves the built SPA from dashboard/dist and a small JSON API over the
// engine's state files, telemetry CSV, cycle-history CSV, and log.
// Works with both namespaces: the published battcal install (battcal.*) and
// a legacy/personal install (battery-calibrate.*), detected at request time.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.BATTCAL_DASH_PORT || 4437);
const HOME = homedir();
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dashboard', 'dist');

const NAMESPACES = [
  {
    // Personal deployment (LaunchAgent com.parsa.battery-calibrate).
    agentLabel: 'com.parsa.battery-calibrate',
    state: '/var/tmp/battery-calibrate.state',
    pause: '/var/tmp/battery-calibrate.pause',
    mode: '/var/tmp/battery-calibrate.mode',
    prep: '/var/tmp/battery-calibrate.prep',
    cycles: join(HOME, 'Library/Logs/battery-calibrate-history.csv'),
    log: join(HOME, 'Library/Logs/battery-calibrate.log'),
    onBatteryStart: '/var/tmp/battery-calibrate.onbatterystart',
  },
  {
    // Published install (install.sh AGENT_LABEL=com.battcal.calibrate).
    agentLabel: 'com.battcal.calibrate',
    state: '/var/tmp/battcal.state',
    pause: '/var/tmp/battcal.pause',
    mode: '/var/tmp/battcal.mode',
    prep: '/var/tmp/battcal.prep',
    cycles: join(HOME, 'Library/Logs/battcal-history.csv'),
    log: join(HOME, 'Library/Logs/battcal.log'),
    onBatteryStart: '/var/tmp/battcal.onbatterystart',
  },
];
const MODES = ['longevity', 'calibration'];
const BANDS = { longevity: { low: 10, high: 90 }, calibration: { low: 5, high: 100 } };

function readMode(n) {
  try {
    const m = readFileSync(n.mode, 'utf8').trim();
    return MODES.includes(m) ? m : 'longevity';
  } catch {
    return 'longevity';
  }
}
const TELEMETRY = join(HOME, 'Library/Logs/battcal-telemetry.csv');

// First namespace whose state file exists wins (personal before published), so a stale
// leftover install can silently receive the controls. Deterministic but surprising:
// status() exposes namespaceConflict when BOTH exist so the UIs can surface it.
const ns = () => NAMESPACES.find((n) => existsSync(n.state)) || NAMESPACES[1];
const namespaceConflict = () => NAMESPACES.every((n) => existsSync(n.state));

function ioregBattery() {
  try {
    return execFileSync('/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}
const num = (src, key) => {
  const m = src.match(new RegExp(`^ *"${key}" = (\\d+)$`, 'm'));
  return m ? Number(m[1]) : null;
};
// Amperage/current fields are unsigned 64-bit two's-complement in ioreg: a discharge
// reads as ~2^64 - x. Recover the exact signed value in BigInt space; parsing via Number()
// first (as num() does) rounds to the nearest ~2048 near 2^64 and quantizes the reading.
const signedNum = (src, key) => {
  const m = src.match(new RegExp(`^ *"${key}" = (\\d+)$`, 'm'));
  if (!m) return null;
  let v = BigInt(m[1]);
  if (v >= 1n << 63n) v -= 1n << 64n;
  return Number(v);
};

// Time on battery: track when the CURRENT discharge run started, from the live battery watts
// on each poll. This works whether BattCal is cycling, paused, or off (unlike the telemetry
// CSV, which the engine stops writing while paused). The start epoch is mirrored to a marker
// file so the count survives a server restart (the dominant cause being ./deploy.sh, which
// kickstarts this agent). See readFreshOnBatteryStart for the staleness guard that keeps a
// restart from adopting a PRIOR run's start.
const ON_BATTERY_STALE_MS = 90_000; // reject a persisted start whose marker mtime is older than
                                    // this: it means a prior discharge run or a reboot, not the
                                    // current one. The always-on menu bar polls /api/status every
                                    // 15s and refreshes the marker each discharge poll, so a fresh
                                    // marker means the SAME run, briefly interrupted by a restart.
let onBatterySince = null;
function trackOnBattery(batteryW, markerPath) {
  if (batteryW != null && batteryW < -0.5) {
    if (onBatterySince == null) {
      // Adopt a persisted start ONLY if its marker is fresh (same run, server just restarted);
      // a stale/absent marker means this is a new run.
      const persisted = readFreshOnBatteryStart(markerPath);
      onBatterySince = persisted != null ? persisted : Date.now();
    }
    // Refresh the marker every discharge poll: mtime = liveness, content = true start (ms),
    // so even a multi-hour run survives a restart.
    try { writeFileSync(markerPath, String(onBatterySince) + '\n'); } catch {}
  } else if (onBatterySince != null) {
    // Discharge just ended: reset and clean up. (A stale marker left by a crash is cleaned
    // lazily by readFreshOnBatteryStart on the next discharge.)
    onBatterySince = null;
    try { if (existsSync(markerPath)) unlinkSync(markerPath); } catch {}
  }
  return onBatterySince == null ? null : +((Date.now() - onBatterySince) / 60000).toFixed(1);
}

function readFreshOnBatteryStart(markerPath) {
  try {
    if (!existsSync(markerPath)) return null;
    if (Date.now() - statSync(markerPath).mtimeMs > ON_BATTERY_STALE_MS) {
      try { unlinkSync(markerPath); } catch {} // stale: prior run / reboot
      return null;
    }
    const v = Number(readFileSync(markerPath, 'utf8').trim());
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

// macOS battery Condition, cached: system_profiler takes 1-2 s and the menu bar polls
// /api/status every 15 s, so an uncached read spawns that subprocess 4x/min forever
// (the engine throttles the very same call to ~60 s).
let condCache = { at: 0, condition: null };
function readCondition() {
  if (Date.now() - condCache.at > 60_000) {
    let condition = null;
    try {
      const sp = execFileSync('/usr/sbin/system_profiler', ['SPPowerDataType'], { encoding: 'utf8' });
      const cm = sp.match(/Condition:\s*(.+)/);
      condition = cm ? cm[1].trim() : null;
    } catch {}
    condCache = { at: Date.now(), condition };
  }
  return condCache.condition;
}

function status() {
  const n = ns();
  const ior = ioregBattery();
  let pct = null, charging = false;
  try {
    const pm = execFileSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8' });
    const m = pm.match(/(\d+)%/);
    pct = m ? Number(m[1]) : null;
    charging = /; charging;/.test(pm);
  } catch {}
  const adapter = ior.match(/"AdapterDetails" = \{.*?"Watts"=(\d+)/);
  // ExternalConnected reads No while batt has the adapter software-cut, but AdapterDetails
  // Watts stays >0 for a physically present charger. plugged && !ExternalConnected is
  // therefore the ground truth for "BattCal cut the adapter" - unlike inferring it from
  // engine state files, it is also correct during activity holds and while paused.
  const extConnected = /"ExternalConnected" = Yes/.test(ior);
  const rawMax = num(ior, 'AppleRawMaxCapacity');
  const design = num(ior, 'DesignCapacity');
  const nominal = num(ior, 'NominalChargeCapacity');
  const voltage = num(ior, 'Voltage');
  const amperage = signedNum(ior, 'Amperage');
  const temp = num(ior, 'Temperature');
  const cycleMatch = ior.match(/^ {6}"CycleCount" = (\d+)$/m);
  let state = 'stopped';
  try { state = readFileSync(n.state, 'utf8').trim(); } catch {}
  const paused = existsSync(n.pause);
  // A numeric epoch in the pause file = a timed "benchmark break" (auto-resumes);
  // an empty pause file = an indefinite Normal-charging pause.
  let breakUntil = null;
  if (paused) {
    try {
      const t = Number(readFileSync(n.pause, 'utf8').trim());
      if (Number.isFinite(t) && t > 0) breakUntil = t;
    } catch {}
  }
  const cyclesRows = readCsv(n.cycles);
  const lastCycle = cyclesRows.at(-1) || null;
  const mode = readMode(n);
  const condition = readCondition();
  let prep = null;
  try {
    // Prep file: "<epoch> [prevMode]" - the mode to restore when prep ends (older files
    // carry the epoch alone; DELETE then falls back to longevity).
    if (existsSync(n.prep)) prep = { active: true, startedAt: Number(readFileSync(n.prep, 'utf8').trim().split(/\s+/)[0]) || null };
  } catch {}
  const bW = voltage !== null && amperage !== null ? +(voltage * amperage / 1e6).toFixed(1) : null;
  return {
    state: paused ? 'paused' : state,
    paused,
    breakUntil,
    namespace: n.agentLabel, // launchctl agent label, so the menu bar controls the right one on any install
    namespaceConflict: namespaceConflict(), // both installs' state files exist; controls target the first (personal) one
    mode,
    band: BANDS[mode],
    condition,
    prep,
    pct,
    charging,
    plugged: adapter !== null && Number(adapter[1]) > 0,
    adapterCut: adapter !== null && Number(adapter[1]) > 0 && !extConnected,
    adapterW: adapter ? Number(adapter[1]) : 0,
    batteryW: bW,
    amperageMa: amperage,
    onBatteryMin: trackOnBattery(bW, n.onBatteryStart), // minutes in the current on-battery (discharge) run, null if not on battery
    rawCurrentMah: num(ior, 'AppleRawCurrentCapacity'),
    tempC: temp !== null ? +(temp / 100).toFixed(1) : null,
    rawMah: rawMax,
    nominalMah: nominal,
    designMah: design,
    rawHealthPct: rawMax && design ? +(100 * rawMax / design).toFixed(1) : null,
    nominalHealthPct: nominal && design ? +(100 * nominal / design).toFixed(1) : null,
    cycles: cycleMatch ? Number(cycleMatch[1]) : null,
    designCycles: num(ior, 'DesignCycleCount9C') || 1000,
    appleHealth: lastCycle ? lastCycle.apple_health : null,
    updatedAt: new Date().toISOString(),
  };
}

function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const row = {};
    head.forEach((h, i) => {
      const v = cells[i];
      row[h] = v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
    });
    return row;
  });
}

function telemetry(hours) {
  let rows = readCsv(TELEMETRY);
  if (hours > 0) {
    const cutoff = Date.now() - hours * 3600e3;
    rows = rows.filter((r) => new Date(r.ts).getTime() >= cutoff);
  }
  const MAX = 1500; // downsample by stride so charts stay light
  if (rows.length > MAX) {
    const stride = Math.ceil(rows.length / MAX);
    rows = rows.filter((_, i) => i % stride === 0 || i === rows.length - 1);
  }
  return rows;
}

function logTail(lines) {
  const n = ns();
  if (!existsSync(n.log)) return [];
  const all = readFileSync(n.log, 'utf8').trim().split('\n');
  // Engine lines start with a date; keep those plus batt daemon responses out.
  return all.filter((l) => /^\d{4}-\d{2}-\d{2} /.test(l)).slice(-lines);
}

// Honest evidence for a Genius Bar visit, computed from real telemetry + history.
// Behavioral symptoms are the operative lever; macOS-reported numbers lead. If the
// data shows nothing wrong, this reports exactly that.
function evidence() {
  const n = ns();
  const rows = readCsv(TELEMETRY).filter((r) => typeof r.ts === 'string');
  const st = status();
  const design = st.designMah;
  const nomV = 11.4; // MBP14 3S pack nominal ~11.4V

  // Discharge segments: median battery watts while draining, -> runtime estimate.
  const drain = rows.filter((r) => r.state === 'drain' && Number(r.battery_W) < 0);
  const drainW = drain.map((r) => Math.abs(Number(r.battery_W))).filter((w) => w > 0.5).sort((a, b) => a - b);
  const medW = drainW.length ? drainW[Math.floor(drainW.length / 2)] : null;
  // Use CURRENT usable capacity (raw full-charge mAh), not design, for honest runtime.
  const usableWh = st.rawMah ? (st.rawMah / 1000) * nomV : (design ? (design / 1000) * nomV : null);
  const runtimeHrs = medW && usableWh ? +(usableWh / medW).toFixed(1) : null;

  // Internal resistance via LOCAL step pairs at near-constant charge level.
  // Terminal voltage V = OCV(SoC) + I*R (I signed, negative on discharge; R > 0). Across a full
  // discharge OCV swings ~2.5 V with SoC and DWARFS the I*R term, so ANY whole-sweep V-vs-I fit
  // (even drain-only) tracks OCV(SoC), not resistance: it fabricated ~296 mOhm on a Condition-Normal
  // pack (a healthy MBP14 3S pack is ~50-150 mOhm). To isolate I*R, only compare samples at the SAME
  // charge level, where OCV is ~constant, so dV/dI is the resistance. Take consecutive drain samples
  // with unchanged pct but a real current step, keep the plausible per-pair slopes, and MEDIAN them.
  // If the data cannot support a trustworthy estimate, report null ("cannot tell"), never a fabricated
  // number: BattCal's rule is to never invent a symptom.
  const rPairs = [];
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1], b = rows[k];
    if (a.state !== 'drain' || b.state !== 'drain') continue;
    if (Number(a.pct) !== Number(b.pct)) continue;                 // same charge level => OCV ~ constant
    const dt = (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / 1000;
    if (!(dt > 0 && dt <= 60)) continue;                           // adjacent samples: OCV drift negligible
    const v1 = Number(a.voltage_mV), v2 = Number(b.voltage_mV);
    const i1 = Number(a.amperage_mA), i2 = Number(b.amperage_mA);
    if (![v1, v2, i1, i2].every(Number.isFinite)) continue;
    const di = i2 - i1;
    if (Math.abs(di) < 150) continue;                              // need a real current step, not noise
    const r = ((v2 - v1) / di) * 1000;                             // mV/mA = ohms; *1000 = mOhm
    if (r > 10 && r < 1000) rPairs.push(r);                        // physically plausible pack range only
  }
  let resistanceMohm = null;
  if (rPairs.length >= 8) {
    rPairs.sort((x, y) => x - y);
    resistanceMohm = +rPairs[Math.floor(rPairs.length / 2)].toFixed(1);
  }
  const resistanceElevated = resistanceMohm !== null && resistanceMohm > 400; // conservative; healthy pack ~50-150 mOhm

  // Unexpected shutdowns: a telemetry gap is only evidence of one if the machine LOST charge
  // while the adapter was supposed to be ON (state charge/hold). A plugged Mac should hold or
  // gain charge, so an unmonitored drop there is anomalous. Gaps during BattCal's own drain
  // (on battery by design) or while paused are expected and never counted, which is what made
  // the old heuristic misread ordinary sleeps as shutdowns.
  // A telemetry gap only HINTS at an unexpected shutdown; it can never prove one. Require the engine to
  // be in a charge/hold state at BOTH ends of the gap (adapter delivering before and after), which
  // excludes the common false positive: unplugging and running on battery through a sleep. Even so this
  // stays a POSSIBLE drop, not an asserted symptom (see symptomsFound below).
  // The engine never checks plugged() inside charge/hold, so an unplug mid-charge leaves
  // state=charge while the Mac is really on battery; require the measured adapter_W column
  // to agree, or an ordinary sleep-on-battery gap becomes a phantom shutdown row.
  const adapterOn = (r) => (r.state === 'charge' || r.state === 'hold') && Number(r.adapter_W) > 0;
  const shutdowns = [];
  for (let k = 1; k < rows.length; k++) {
    const prev = rows[k - 1], cur = rows[k];
    const gapMin = (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 60000;
    const dropPct = Number(prev.pct) - Number(cur.pct);
    if (gapMin > 10 && adapterOn(prev) && adapterOn(cur) && Number(prev.pct) > 15 && dropPct > 5) {
      shutdowns.push({ at: prev.ts, pct: Number(prev.pct), gapMin: Math.round(gapMin), dropPct });
    }
  }

  // Temperature ranges.
  // Physical pack temperature is never 0; the engine writes 0.0 on a failed ioreg read, so
  // drop those. reduce (not Math.min(...spread)) so a long telemetry file cannot overflow the
  // call-argument limit and throw RangeError, permanently 500-ing this endpoint.
  const temps = rows.map((r) => Number(r.temp_C)).filter((t) => Number.isFinite(t) && t > 0);
  const tRange = temps.length
    ? { min: temps.reduce((a, b) => Math.min(a, b), Infinity), max: temps.reduce((a, b) => Math.max(a, b), -Infinity) }
    : null;

  // Degradation projection from history (macOS + raw).
  const hist = readCsv(n.cycles).filter((r) => typeof r.date === 'string');
  const first = hist[0];
  const rawNow = st.rawHealthPct;
  const cyclesNow = st.cycles;
  const designCycles = st.designCycles;
  let projection = null;
  if (rawNow != null && cyclesNow) {
    const lostPct = 100 - rawNow;
    const perCycle = cyclesNow > 0 ? lostPct / cyclesNow : 0;
    // Report only the MEASURED rate. A linear extrapolation to design cycles is deliberately omitted:
    // lithium fade is nonlinear (fast early, then it flattens), so projecting the early rate straight
    // out fabricates a scary "~X% at 1000 cycles" that overstates real loss. Facts to date only.
    projection = { lostPct: +lostPct.toFixed(1), cyclesNow, perCycle: +perCycle.toFixed(3), designCycles };
  }

  // symptomsFound gates the report's "Real symptoms, lead with these" verdict, so it must reflect only
  // MEASURED evidence. Elevated internal resistance is measured; the telemetry-gap drops above are
  // inferred and ambiguous (could be sleeping on battery), so they are shown as possible drops but never
  // flip this on their own. BattCal's hard rule: never assert a symptom the data cannot prove.
  const symptomsFound = resistanceElevated;
  return {
    macos: { capacity: st.appleHealth, condition: st.condition },
    raw: { pct: st.rawHealthPct, mah: st.rawMah, designMah: st.designMah, note: 'For your records only. Apple decides on the macOS number above, not this.' },
    cycles: cyclesNow,
    runtime: runtimeHrs ? { hours: runtimeHrs, atWatts: medW, note: 'Estimated from the load measured during cycling (near-idle), not a stress test.' } : null,
    resistanceMohm,
    resistanceElevated,
    shutdowns,
    tempRange: tRange,
    projection,
    symptomsFound,
    startedTracking: first ? first.date : (rows[0] ? rows[0].ts : null),
    generatedAt: new Date().toISOString(),
  };
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
  '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(req, res) {
  let path = new URL(req.url, 'http://x').pathname;
  if (path === '/') path = '/index.html';
  const file = normalize(join(DIST, path));
  if (!(file === DIST || file.startsWith(DIST + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback
    const index = join(DIST, 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'content-type': 'text/html' });
      createReadStream(index).pipe(res);
    } else {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Dashboard not built yet. Run: cd dashboard && npm install && npm run build');
    }
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

// No CORS headers on purpose: every legitimate client is either same-origin (the SPA's
// relative fetches, both direct on :4437 and through the portless proxy) or not CORS-bound
// at all (the menu bar's URLSession). Granting cross-origin reads would let any web page
// the user visits read battery state off loopback.
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(code === 204 ? undefined : JSON.stringify(body)); // 204 must carry no body
};

// Parse a query param as a finite number in [0, max], else fall back to def. Guards NaN
// (e.g. Number('abc')) from silently disabling a downstream filter and returning the whole file.
const numParam = (v, def, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {}); // no allow-* headers: every cross-origin preflight fails
    // The charging control plane is state-changing, so every POST/DELETE must carry the
    // x-battcal header. A custom header cannot be set by HTML forms and forces a CORS
    // preflight on cross-origin fetch (which the bare OPTIONS above never approves), so a
    // drive-by page cannot un-pause the engine or flip it to calibration. GET stays open
    // for the SPA and read-only tooling.
    if ((req.method === 'POST' || req.method === 'DELETE') && req.headers['x-battcal'] !== '1') {
      return json(res, 403, { error: 'missing x-battcal header' });
    }
    if (p === '/api/health') return json(res, 200, { ok: true });
    if (p === '/api/status') return json(res, 200, status());
    if (p === '/api/telemetry') return json(res, 200, telemetry(numParam(url.searchParams.get('hours'), 24, 24 * 90)));
    if (p === '/api/cycles') return json(res, 200, readCsv(ns().cycles));
    if (p === '/api/log') return json(res, 200, logTail(numParam(url.searchParams.get('lines'), 120, 5000)));
    if (p === '/api/evidence') return json(res, 200, evidence());
    if (p === '/api/prep' && req.method === 'POST') {
      const n = ns();
      const prevMode = readMode(n); // remember what the user was in, restored when prep ends
      writeFileSync(n.mode, 'calibration\n');
      try { unlinkSync(n.pause); } catch {}
      writeFileSync(n.prep, `${Math.floor(Date.now() / 1000)} ${prevMode}\n`);
      return json(res, 200, { prep: true, mode: 'calibration' });
    }
    if (p === '/api/prep' && req.method === 'DELETE') {
      const n = ns();
      // Restore the mode prep replaced (second token of the prep file); a legacy
      // epoch-only prep file falls back to longevity, same as before.
      let prevMode = 'longevity';
      try {
        const tok = readFileSync(n.prep, 'utf8').trim().split(/\s+/)[1];
        if (MODES.includes(tok)) prevMode = tok;
      } catch {}
      try { unlinkSync(n.prep); } catch {}
      writeFileSync(n.mode, prevMode + '\n');
      return json(res, 200, { prep: false, mode: prevMode });
    }
    if (p === '/api/pause' && req.method === 'POST') { writeFileSync(ns().pause, ''); return json(res, 200, { paused: true }); }
    if (p === '/api/resume' && req.method === 'POST') { try { unlinkSync(ns().pause); } catch {} return json(res, 200, { paused: false }); }
    if (p === '/api/break' && req.method === 'POST') {
      // Timed benchmark break: pause now, auto-resume after N minutes. The engine
      // honors the epoch, so the break ends even with every UI closed.
      const mins = Math.max(1, Math.min(240, Math.round(Number(url.searchParams.get('minutes')) || 30)));
      const until = Math.floor(Date.now() / 1000) + mins * 60;
      writeFileSync(ns().pause, String(until) + '\n');
      return json(res, 200, { paused: true, breakUntil: until, minutes: mins });
    }
    if (p === '/api/mode' && req.method === 'POST') {
      let body = '';
      // Cap the body: mode payloads are tiny, so an unbounded stream is only an attack surface.
      req.on('data', (c) => { if (body.length < 1e6) body += c; });
      // The 'end' callback runs AFTER the outer try/catch has already returned, so an unguarded throw
      // here (e.g. writeFileSync failing on /var/tmp) would be an UNCAUGHT exception that crashes the
      // whole server for every endpoint. Guard the body with its own try/catch.
      req.on('end', () => {
        try {
          let m = url.searchParams.get('mode');
          try { m = JSON.parse(body).mode || m; } catch {}
          if (!MODES.includes(m)) return json(res, 400, { error: `mode must be one of: ${MODES.join(', ')}` });
          writeFileSync(ns().mode, m + '\n');
          return json(res, 200, { mode: m, band: BANDS[m] });
        } catch (e) {
          return json(res, 500, { error: String(e?.message || e) });
        }
      });
      return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) });
  }
// IPv4 loopback bind on purpose (see localhost-urls.md): the charging control plane must
// never be LAN-reachable, and the portless root proxy reaches local services over IPv4.
}).listen(PORT, '127.0.0.1', () => {
  console.log(`battcal dashboard: http://localhost:${PORT}`);
});
