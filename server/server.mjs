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
  let amperage = num(ior, 'Amperage');
  if (amperage !== null && amperage > 9e18) amperage -= 2 ** 64;
  const temp = num(ior, 'Temperature');
  const cycleMatch = ior.match(/^ {6}"CycleCount" = (\d+)$/m);
  let state = 'stopped';
  try { state = readFileSync(n.state, 'utf8').trim(); } catch {}
  const paused = existsSync(n.pause);
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
  const pts = rows.map((r) => ({ v: Number(r.voltage_mV), i: Number(r.amperage_mA) }))
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.i) && p.v > 0);
  let resistanceMohm = null;
  if (pts.length > 20) {
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

  // Unexpected shutdowns: telemetry gaps > 10 min while charge was healthy (>15%) and not paused.
  const shutdowns = [];
  for (let k = 1; k < rows.length; k++) {
    const prevT = new Date(rows[k - 1].ts).getTime();
    const curT = new Date(rows[k].ts).getTime();
    const gapMin = (curT - prevT) / 60000;
    if (gapMin > 10 && Number(rows[k - 1].pct) > 15 && rows[k - 1].state !== 'paused') {
      shutdowns.push({ at: rows[k - 1].ts, pct: Number(rows[k - 1].pct), gapMin: Math.round(gapMin) });
    }
  }

  // Temperature ranges.
  const temps = rows.map((r) => Number(r.temp_C)).filter(Number.isFinite);
  const tRange = temps.length ? { min: Math.min(...temps), max: Math.max(...temps) } : null;

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
