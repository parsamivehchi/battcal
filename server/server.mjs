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
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.BATTCAL_DASH_PORT || 4437);
const HOME = homedir();
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dashboard', 'dist');

const NAMESPACES = [
  {
    state: '/var/tmp/battery-calibrate.state',
    pause: '/var/tmp/battery-calibrate.pause',
    mode: '/var/tmp/battery-calibrate.mode',
    prep: '/var/tmp/battery-calibrate.prep',
    cycles: join(HOME, 'Library/Logs/battery-calibrate-history.csv'),
    log: join(HOME, 'Library/Logs/battery-calibrate.log'),
  },
  {
    state: '/var/tmp/battcal.state',
    pause: '/var/tmp/battcal.pause',
    mode: '/var/tmp/battcal.mode',
    prep: '/var/tmp/battcal.prep',
    cycles: join(HOME, 'Library/Logs/battcal-history.csv'),
    log: join(HOME, 'Library/Logs/battcal.log'),
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

const ns = () => NAMESPACES.find((n) => existsSync(n.state)) || NAMESPACES[1];

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
  let condition = null;
  try {
    const sp = execFileSync('/usr/sbin/system_profiler', ['SPPowerDataType'], { encoding: 'utf8' });
    const cm = sp.match(/Condition:\s*(.+)/);
    condition = cm ? cm[1].trim() : null;
  } catch {}
  let prep = null;
  try {
    if (existsSync(n.prep)) prep = { active: true, startedAt: Number(readFileSync(n.prep, 'utf8').trim()) || null };
  } catch {}
  return {
    state: paused ? 'paused' : state,
    paused,
    breakUntil,
    mode,
    band: BANDS[mode],
    condition,
    prep,
    pct,
    charging,
    plugged: adapter !== null && Number(adapter[1]) > 0,
    adapterW: adapter ? Number(adapter[1]) : 0,
    batteryW: voltage !== null && amperage !== null ? +(voltage * amperage / 1e6).toFixed(1) : null,
    amperageMa: amperage,
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
  const nomV = st.rawMah && st.designMah ? 11.4 : 11.4; // MBP14 3S pack nominal ~11.4V

  // Discharge segments: median battery watts while draining, -> runtime estimate.
  const drain = rows.filter((r) => r.state === 'drain' && Number(r.battery_W) < 0);
  const drainW = drain.map((r) => Math.abs(Number(r.battery_W))).filter((w) => w > 0.5).sort((a, b) => a - b);
  const medW = drainW.length ? drainW[Math.floor(drainW.length / 2)] : null;
  // Use CURRENT usable capacity (raw full-charge mAh), not design, for honest runtime.
  const usableWh = st.rawMah ? (st.rawMah / 1000) * nomV : (design ? (design / 1000) * nomV : null);
  const runtimeHrs = medW && usableWh ? +(usableWh / medW).toFixed(1) : null;

  // Internal resistance: slope of pack voltage (mV) vs current (mA) via least squares.
  // Fit pack voltage vs current on DISCHARGE rows only. Mixing charge + drain across the
  // SoC sweep makes the slope track OCV-vs-SoC (current sign correlates with charge level),
  // not the true I*R term, which can fabricate an "elevated resistance". A near-constant
  // current then makes the denominator ~0 and yields null (an honest "cannot tell").
  const pts = rows.filter((r) => r.state === 'drain')
    .map((r) => ({ v: Number(r.voltage_mV), i: Number(r.amperage_mA) }))
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.i) && p.v > 0 && p.i < 0);
  // A resistance fit needs many DISTINCT current levels: coarse or quantized current (only a
  // few levels, e.g. legacy telemetry rounded to ~2048 mA) yields a slope dominated by noise,
  // not I*R, so report null rather than a fabricated "elevated" number.
  const levels = new Set(pts.map((p) => Math.round(p.i)));
  let resistanceMohm = null;
  if (pts.length > 20 && levels.size >= 8) {
    const n2 = pts.length;
    const sx = pts.reduce((a, p) => a + p.i, 0);
    const sy = pts.reduce((a, p) => a + p.v, 0);
    const sxx = pts.reduce((a, p) => a + p.i * p.i, 0);
    const sxy = pts.reduce((a, p) => a + p.i * p.v, 0);
    const denom = n2 * sxx - sx * sx;
    if (Math.abs(denom) > 1e-6) {
      // slope mV per mA = ohms; *1000 = mOhm. Positive: V rises with (signed) current.
      const slope = (n2 * sxy - sx * sy) / denom;
      resistanceMohm = +(Math.abs(slope) * 1000).toFixed(1);
    }
  }
  const resistanceElevated = resistanceMohm !== null && resistanceMohm > 250; // conservative

  // Unexpected shutdowns: a telemetry gap is only evidence of one if the machine LOST charge
  // while the adapter was supposed to be ON (state charge/hold). A plugged Mac should hold or
  // gain charge, so an unmonitored drop there is anomalous. Gaps during BattCal's own drain
  // (on battery by design) or while paused are expected and never counted, which is what made
  // the old heuristic misread ordinary sleeps as shutdowns.
  const shutdowns = [];
  for (let k = 1; k < rows.length; k++) {
    const prev = rows[k - 1], cur = rows[k];
    const gapMin = (new Date(cur.ts).getTime() - new Date(prev.ts).getTime()) / 60000;
    const dropPct = Number(prev.pct) - Number(cur.pct);
    const adapterOn = prev.state === 'charge' || prev.state === 'hold';
    if (gapMin > 10 && adapterOn && Number(prev.pct) > 15 && dropPct > 5) {
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
    const atDesign = +(100 - perCycle * designCycles).toFixed(0);
    projection = { lostPct: +lostPct.toFixed(1), cyclesNow, perCycle: +perCycle.toFixed(3), designCycles, projectedAtDesign: atDesign };
  }

  const symptomsFound = shutdowns.length > 0 || resistanceElevated;
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
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
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

const json = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (p === '/api/health') return json(res, 200, { ok: true });
    if (p === '/api/status') return json(res, 200, status());
    if (p === '/api/telemetry') return json(res, 200, telemetry(Number(url.searchParams.get('hours') || 24)));
    if (p === '/api/cycles') return json(res, 200, readCsv(ns().cycles));
    if (p === '/api/log') return json(res, 200, logTail(Number(url.searchParams.get('lines') || 120)));
    if (p === '/api/evidence') return json(res, 200, evidence());
    if (p === '/api/prep' && req.method === 'POST') {
      const n = ns();
      writeFileSync(n.mode, 'calibration\n');
      try { unlinkSync(n.pause); } catch {}
      writeFileSync(n.prep, String(Math.floor(Date.now() / 1000)) + '\n');
      return json(res, 200, { prep: true, mode: 'calibration' });
    }
    if (p === '/api/prep' && req.method === 'DELETE') {
      const n = ns();
      try { unlinkSync(n.prep); } catch {}
      writeFileSync(n.mode, 'longevity\n');
      return json(res, 200, { prep: false, mode: 'longevity' });
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
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let m = url.searchParams.get('mode');
        try { m = JSON.parse(body).mode || m; } catch {}
        if (!MODES.includes(m)) return json(res, 400, { error: `mode must be one of: ${MODES.join(', ')}` });
        writeFileSync(ns().mode, m + '\n');
        return json(res, 200, { mode: m, band: BANDS[m] });
      });
      return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) });
  }
}).listen(PORT, () => {
  console.log(`battcal dashboard: http://localhost:${PORT}`);
});
