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
    cycles: join(HOME, 'Library/Logs/battery-calibrate-history.csv'),
    log: join(HOME, 'Library/Logs/battery-calibrate.log'),
  },
  {
    state: '/var/tmp/battcal.state',
    pause: '/var/tmp/battcal.pause',
    cycles: join(HOME, 'Library/Logs/battcal-history.csv'),
    log: join(HOME, 'Library/Logs/battcal.log'),
  },
];
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
  return {
    state: paused ? 'paused' : state,
    paused,
    pct,
    charging,
    plugged: adapter !== null && Number(adapter[1]) > 0,
    adapterW: adapter ? Number(adapter[1]) : 0,
    batteryW: voltage !== null && amperage !== null ? +(voltage * amperage / 1e6).toFixed(1) : null,
    tempC: temp !== null ? +(temp / 100).toFixed(1) : null,
    rawMah: rawMax,
    nominalMah: nominal,
    designMah: design,
    rawHealthPct: rawMax && design ? +(100 * rawMax / design).toFixed(1) : null,
    nominalHealthPct: nominal && design ? +(100 * nominal / design).toFixed(1) : null,
    cycles: cycleMatch ? Number(cycleMatch[1]) : null,
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
    if (p === '/api/pause' && req.method === 'POST') { writeFileSync(ns().pause, ''); return json(res, 200, { paused: true }); }
    if (p === '/api/resume' && req.method === 'POST') { try { unlinkSync(ns().pause); } catch {} return json(res, 200, { paused: false }); }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(req, res);
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) });
  }
}).listen(PORT, () => {
  console.log(`battcal dashboard: http://localhost:${PORT}`);
});
