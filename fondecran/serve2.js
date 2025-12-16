// server.js
// Usage: npm install ws
// node server.js
// Expects certificate/key paths via env SSL_KEY and SSL_CERT or ./cert/key.pem ./cert/cert.pem
// Reads OpenWeatherMap key from ./Openweatherkey/openkey
// Serves static files from ./public
// Watches project files and restarts the process on modification

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const url = require('url');
const { exec, spawn } = require('child_process');
const { WebSocketServer } = require('ws');

// Configuration
const PORT = process.env.PORT || 3000;
const SSL_KEY = process.env.SSL_KEY || path.join(__dirname, 'cert', 'key.pem');
const SSL_CERT = process.env.SSL_CERT || path.join(__dirname, 'cert', 'cert.pem');
const DEFAULT_PUSH_MS = 1000;
const SAMPLE_MS = 200;
const EXEC_TIMEOUT_MS = 15_000;
const THROUGHPUT_TICK_MS = 1000;
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const PUBLIC_DIR = path.join(__dirname, 'public');
const WATCH_PATHS = [__dirname, PUBLIC_DIR]; // paths to watch for changes
const WATCH_POLL_MS = 1000; // polling interval for watcher

// Ensure cache dir exists
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}

// ---------------- OpenWeather key from file ----------------
const OPENWEATHER_KEY_FILE = path.join(__dirname, 'Openweatherkey', 'openkey');
let OPENWEATHER_KEY = '';
try {
  if (fs.existsSync(OPENWEATHER_KEY_FILE)) {
    OPENWEATHER_KEY = fs.readFileSync(OPENWEATHER_KEY_FILE, 'utf8').trim();
    if (!OPENWEATHER_KEY) {
      console.warn('OpenWeather key file found but empty:', OPENWEATHER_KEY_FILE);
    } else {
      console.log('OpenWeather key loaded from', OPENWEATHER_KEY_FILE);
    }
  } else {
    console.warn('OpenWeather key file not found at', OPENWEATHER_KEY_FILE);
  }
} catch (e) {
  console.warn('Failed to read OpenWeather key file', OPENWEATHER_KEY_FILE, e.message);
  OPENWEATHER_KEY = '';
}

// ---------------- utilitaires ----------------
function execPromise(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return resolve({ error: err.message, stdout: stdout || '', stderr: stderr || '' });
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk.toString());
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------- CPU / MEM ----------------
function cpuTimes() {
  const cpus = os.cpus();
  return cpus.map((c, idx) => {
    const t = c.times;
    return { core: idx, idle: t.idle, total: Object.values(t).reduce((s, v) => s + v, 0) };
  });
}

function cpuPercentBetween(prev, next) {
  if (!prev || !next || prev.length !== next.length) return null;
  const perCore = next.map((n, i) => {
    const p = prev[i];
    const idleDiff = n.idle - p.idle;
    const totalDiff = n.total - p.total;
    const pct = totalDiff > 0 ? ((1 - idleDiff / totalDiff) * 100) : 0;
    return { core: n.core, pct: Number(pct) };
  });
  const avg = perCore.reduce((s, c) => s + (c.pct || 0), 0) / perCore.length;
  return { perCore, avg };
}

function sampleCpuOnce(ms) {
  return new Promise((resolve) => {
    const t0 = cpuTimes();
    setTimeout(() => {
      const t1 = cpuTimes();
      resolve(cpuPercentBetween(t0, t1));
    }, ms);
  });
}

function readMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usagePercent = total > 0 ? (used / total * 100) : 0;
  return { total, free, used, usagePercent: Number(usagePercent) };
}

async function buildStatus() {
  const cpu = await sampleCpuOnce(SAMPLE_MS);
  const memory = readMemory();
  if (cpu && Array.isArray(cpu.perCore)) {
    cpu.perCore = cpu.perCore.map(c => ({ core: c.core, pct: Math.max(0, Math.min(100, Number(c.pct))) }));
    cpu.avg = Math.max(0, Math.min(100, Number(cpu.avg ?? (cpu.perCore.reduce((s,c)=>s+(c.pct||0),0)/cpu.perCore.length))));
  }
  return { ok: true, ts: Date.now(), parsed: { cpu, memory } };
}

// ---------------- interface bytes sampling ----------------
function readIfStatsSys(iface) {
  try {
    const base = `/sys/class/net/${iface}/statistics`;
    const rx = Number(fs.readFileSync(path.join(base, 'rx_bytes'), 'utf8').trim());
    const tx = Number(fs.readFileSync(path.join(base, 'tx_bytes'), 'utf8').trim());
    return { rx, tx };
  } catch (e) {
    return null;
  }
}

async function sampleInterfacesBytes() {
  const isWin = process.platform === 'win32';
  const result = {};
  if (!isWin) {
    try {
      const ifaces = fs.readdirSync('/sys/class/net');
      for (const ifn of ifaces) {
        const s = readIfStatsSys(ifn);
        if (s) result[ifn] = s;
      }
      if (Object.keys(result).length > 0) return result;
    } catch (e) {}
    try {
      const raw = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = raw.split('\n').slice(2);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 17) {
          const name = parts[0].replace(':', '');
          const rx = Number(parts[1]);
          const tx = Number(parts[9]);
          result[name] = { rx, tx };
        }
      }
      if (Object.keys(result).length > 0) return result;
    } catch (e) {}
  } else {
    try {
      const cmd = 'powershell -NoProfile -Command "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json"';
      const out = await execPromise(cmd, { timeout: 5000 });
      const parsed = JSON.parse(out.stdout || out);
      if (Array.isArray(parsed)) {
        for (const p of parsed) result[p.Name] = { rx: Number(p.ReceivedBytes || 0), tx: Number(p.SentBytes || 0) };
      } else if (parsed && parsed.Name) {
        result[parsed.Name] = { rx: Number(parsed.ReceivedBytes || 0), tx: Number(parsed.SentBytes || 0) };
      }
      if (Object.keys(result).length > 0) return result;
    } catch (e) {}
  }
  return result;
}

// ---------------- throughput ticker (global) ----------------
let lastInterfaceSample = null;
let lastInterfaceTs = 0;
let cachedThroughput = { ts: 0, interval_ms: THROUGHPUT_TICK_MS, throughput: { perInterface: {}, total: { rx_kbps: 0, tx_kbps: 0 } } };

async function computeThroughputFromSamples(prev, next, ms) {
  const out = { perInterface: {}, total: { rx_kbps: 0, tx_kbps: 0 } };
  for (const ifn of Object.keys(next)) {
    const a = prev[ifn] || { rx: 0, tx: 0 };
    const b = next[ifn];
    const rxDiff = Math.max(0, b.rx - a.rx);
    const txDiff = Math.max(0, b.tx - a.tx);
    const rx_kbps = (rxDiff / ms) * 1000 / 1024;
    const tx_kbps = (txDiff / ms) * 1000 / 1024;
    out.perInterface[ifn] = { rx_kbps: Number(rx_kbps.toFixed(2)), tx_kbps: Number(tx_kbps.toFixed(2)) };
    out.total.rx_kbps += rx_kbps;
    out.total.tx_kbps += tx_kbps;
  }
  out.total.rx_kbps = Number(out.total.rx_kbps.toFixed(2));
  out.total.tx_kbps = Number(out.total.tx_kbps.toFixed(2));
  return out;
}

async function throughputTicker() {
  try {
    const now = Date.now();
    const sample = await sampleInterfacesBytes();
    if (!lastInterfaceSample) {
      lastInterfaceSample = sample;
      lastInterfaceTs = now;
      return;
    }
    const ms = Math.max(1, now - lastInterfaceTs);
    const computed = await computeThroughputFromSamples(lastInterfaceSample, sample, ms);
    cachedThroughput = { ts: now, interval_ms: ms, throughput: computed };
    lastInterfaceSample = sample;
    lastInterfaceTs = now;
  } catch (e) {}
}

setInterval(throughputTicker, THROUGHPUT_TICK_MS);
throughputTicker();

// ---------------- bluetooth info & throughput ----------------
async function getBluetoothInfo() {
  const isWin = process.platform === 'win32';
  const info = { available: false, interfaces: [], devices: [] };
  try {
    const ifaces = Object.keys(os.networkInterfaces());
    for (const n of ifaces) {
      const low = n.toLowerCase();
      if (low.includes('bluetooth') || low.includes('bnep') || low.includes('bt')) info.interfaces.push(n);
    }
  } catch (e) {}
  if (!isWin) {
    try {
      const out = await execPromise('bluetoothctl devices', { timeout: 4000 });
      const lines = (out.stdout || out).split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        const m = l.match(/^Device\s+([0-9A-F:]+)\s+(.+)$/i);
        if (m) info.devices.push({ address: m[1], name: m[2] });
      }
      if (info.devices.length > 0) info.available = true;
    } catch (e) {}
  } else {
    try {
      const cmd = 'powershell -NoProfile -Command "Get-PnpDevice -Class Bluetooth | Select-Object Status,InstanceId,FriendlyName | ConvertTo-Json"';
      const out = await execPromise(cmd, { timeout: 4000 });
      const parsed = JSON.parse(out.stdout || out);
      if (Array.isArray(parsed)) {
        for (const p of parsed) info.devices.push({ name: p.FriendlyName || null, status: p.Status || null, id: p.InstanceId || null });
      } else if (parsed && parsed.FriendlyName) {
        info.devices.push({ name: parsed.FriendlyName, status: parsed.Status, id: parsed.InstanceId });
      }
      if (info.devices.length > 0) info.available = true;
    } catch (e) {}
  }
  if (info.interfaces.length > 0) info.available = true;
  return info;
}

async function measureBluetoothThroughputFromSamples(prev, next, ms, btIfaces) {
  const out = { perInterface: {}, total: { rx_kbps: 0, tx_kbps: 0 } };
  for (const ifn of btIfaces) {
    const a = prev[ifn] || { rx: 0, tx: 0 };
    const b = next[ifn] || { rx: 0, tx: 0 };
    const rxDiff = Math.max(0, b.rx - a.rx);
    const txDiff = Math.max(0, b.tx - a.tx);
    const rx_kbps = (rxDiff / ms) * 1000 / 1024;
    const tx_kbps = (txDiff / ms) * 1000 / 1024;
    out.perInterface[ifn] = { rx_kbps: Number(rx_kbps.toFixed(2)), tx_kbps: Number(tx_kbps.toFixed(2)) };
    out.total.rx_kbps += rx_kbps;
    out.total.tx_kbps += tx_kbps;
  }
  out.total.rx_kbps = Number(out.total.rx_kbps.toFixed(2));
  out.total.tx_kbps = Number(out.total.tx_kbps.toFixed(2));
  return out;
}

let cachedBluetoothThroughput = { ts: 0, interval_ms: THROUGHPUT_TICK_MS, throughput: { perInterface: {}, total: { rx_kbps: 0, tx_kbps: 0 } }, detectedInterfaces: [] };

async function bluetoothTicker() {
  try {
    const info = await getBluetoothInfo();
    const btIfaces = info.interfaces.length ? info.interfaces.slice() : [];
    if (btIfaces.length === 0) {
      const allIfaces = Object.keys(os.networkInterfaces());
      for (const n of allIfaces) {
        const low = n.toLowerCase();
        if (low.includes('bt') || low.includes('bnep') || low.includes('bluetooth')) btIfaces.push(n);
      }
    }
    const now = Date.now();
    const sample = await sampleInterfacesBytes();
    if (!lastInterfaceSample) {
      lastInterfaceSample = sample;
      lastInterfaceTs = now;
      cachedBluetoothThroughput = { ts: now, interval_ms: THROUGHPUT_TICK_MS, throughput: { perInterface: {}, total: { rx_kbps: 0, tx_kbps: 0 } }, detectedInterfaces: btIfaces };
      return;
    }
    const ms = Math.max(1, now - lastInterfaceTs);
    const computed = await measureBluetoothThroughputFromSamples(lastInterfaceSample, sample, ms, btIfaces);
    cachedBluetoothThroughput = { ts: now, interval_ms: ms, throughput: computed, detectedInterfaces: btIfaces };
  } catch (e) {}
}

setInterval(bluetoothTicker, THROUGHPUT_TICK_MS);
bluetoothTicker();

// ---------------- cache helpers for proxies ----------------
function cacheFileFor(name) {
  return path.join(CACHE_DIR, `${name}.json`);
}

function loadCache(name) {
  const file = cacheFileFor(name);
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function saveCache(name, obj) {
  const file = cacheFileFor(name);
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {}
}

function isFresh(entry) {
  if (!entry || !entry.ts) return false;
  return (Date.now() - entry.ts) <= CACHE_TTL_MS;
}

// ---------------- simple https/http fetch helper ----------------
function httpsFetchJson(targetUrl, timeout = 10000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(targetUrl);
      const lib = u.protocol === 'http:' ? http : https;
      const opts = { method: 'GET', headers: { 'User-Agent': 'node-server-proxy' }, timeout };
      const req = lib.request(u, opts, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode, body: parsed, raw: data });
          } catch (e) {
            resolve({ statusCode: res.statusCode, body: data, raw: data });
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ---------------- OpenWeatherMap proxy & cache ----------------
async function handleOpenWeatherProxy(uQuery) {
  const endpoint = String(uQuery.endpoint || 'weather');
  const params = Object.assign({}, uQuery);
  delete params.endpoint;

  // inject server key if client didn't provide appid
  if (!params.appid && OPENWEATHER_KEY) params.appid = OPENWEATHER_KEY;

  const qs = new URLSearchParams(params).toString();
  const target = `https://api.openweathermap.org/data/2.5/${endpoint}?${qs}`;
  const cacheName = 'openweathermap';
  const cache = loadCache(cacheName);
  const key = target;

  if (cache[key] && isFresh(cache[key])) {
    (async () => {
      try {
        const fetched = await httpsFetchJson(target);
        if (fetched && fetched.body) {
          cache[key] = { ts: Date.now(), data: fetched.body };
          saveCache(cacheName, cache);
        }
      } catch (e) {}
    })();
    return { cached: true, ts: cache[key].ts, data: cache[key].data };
  }

  try {
    const fetched = await httpsFetchJson(target);
    if (fetched && fetched.body) {
      cache[key] = { ts: Date.now(), data: fetched.body };
      saveCache(cacheName, cache);
      return { cached: false, ts: cache[key].ts, data: cache[key].data };
    }
    if (cache[key]) return { cached: true, ts: cache[key].ts, data: cache[key].data, note: 'fetched non-json or empty' };
    return { error: 'no data', fetched };
  } catch (e) {
    if (cache[key]) return { cached: true, ts: cache[key].ts, data: cache[key].data, note: 'fetch failed, served cached' };
    return { error: 'fetch failed', message: e.message };
  }
}

// ---------------- taux.live proxy & cache ----------------
async function handleTauxProxy(uQuery) {
  const pathParam = String(uQuery.path || '').replace(/^\//, '');
  const params = Object.assign({}, uQuery);
  delete params.path;
  const qs = new URLSearchParams(params).toString();
  const target = `https://taux.live/${pathParam}${qs ? ('?' + qs) : ''}`;
  const cacheName = 'taux_live';
  const cache = loadCache(cacheName);
  const key = target;
  if (cache[key] && isFresh(cache[key])) {
    (async () => {
      try {
        const fetched = await httpsFetchJson(target);
        if (fetched && fetched.body) {
          cache[key] = { ts: Date.now(), data: fetched.body };
          saveCache(cacheName, cache);
        }
      } catch (e) {}
    })();
    return { cached: true, ts: cache[key].ts, data: cache[key].data };
  }
  try {
    const fetched = await httpsFetchJson(target);
    if (fetched && fetched.body) {
      cache[key] = { ts: Date.now(), data: fetched.body };
      saveCache(cacheName, cache);
      return { cached: false, ts: cache[key].ts, data: cache[key].data };
    }
    if (cache[key]) return { cached: true, ts: cache[key].ts, data: cache[key].data, note: 'fetched non-json or empty' };
    return { error: 'no data', fetched };
  } catch (e) {
    if (cache[key]) return { cached: true, ts: cache[key].ts, data: cache[key].data, note: 'fetch failed, served cached' };
    return { error: 'fetch failed', message: e.message };
  }
}

// ---------------- Static file serving from ./public ----------------
function getMimeType(ext) {
  const m = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.map': 'application/json; charset=utf-8'
  };
  return m[ext.toLowerCase()] || 'application/octet-stream';
}

async function tryServePublic(req, res, pathname) {
  try {
    let rel = decodeURIComponent(pathname || '/');
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.startsWith('/public/')) rel = rel.slice('/public'.length);
    if (rel.includes('..')) return false;
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR)) return false;
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) { stat = null; }
    let finalPath = filePath;
    if (stat && stat.isDirectory()) {
      finalPath = path.join(filePath, 'index.html');
      try { stat = fs.statSync(finalPath); } catch (e) { stat = null; }
    }
    if (!stat || !stat.isFile()) return false;
    const ext = path.extname(finalPath);
    const mime = getMimeType(ext);
    const stream = fs.createReadStream(finalPath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    stream.pipe(res);
    stream.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'file read error' }));
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------- HTTP(S) server creation ----------------
let server;
try {
  const key = fs.readFileSync(SSL_KEY);
  const cert = fs.readFileSync(SSL_CERT);
  const options = { key, cert };
  server = https.createServer(options, requestHandler);
  console.log('Starting HTTPS server');
} catch (e) {
  console.warn('SSL key/cert not found or unreadable. Falling back to HTTP. To enable HTTPS set SSL_KEY and SSL_CERT or place certs in ./cert/', e.message);
  server = http.createServer(requestHandler);
}

// requestHandler
async function requestHandler(req, res) {
  const u = url.parse(req.url, true);

  // Serve static files first
  if (req.method === 'GET') {
    const pathname = u.pathname || '/';
    const served = await tryServePublic(req, res, pathname);
    if (served) return;
  }

  // GET /api/status
  if (u.pathname === '/api/status' && req.method === 'GET') {
    try {
      const status = await buildStatus();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(status));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // POST /api/exec
  if (u.pathname === '/api/exec' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const j = JSON.parse(body || '{}');
      const cmd = String(j.cmd || '');
      if (!cmd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing cmd' }));
        return;
      }
      const out = await execPromise(cmd, { timeout: EXEC_TIMEOUT_MS });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cmd, result: out }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // GET /api/bluetooth
  if (u.pathname === '/api/bluetooth' && req.method === 'GET') {
    try {
      const info = await getBluetoothInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ts: Date.now(), bluetooth: info }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // GET /api/bluetooth/throughput
  if (u.pathname === '/api/bluetooth/throughput' && req.method === 'GET') {
    try {
      const ms = Number(u.query && u.query.ms ? u.query.ms : 0);
      if (ms > 0) {
        const t0 = await sampleInterfacesBytes();
        await new Promise(r => setTimeout(r, ms));
        const t1 = await sampleInterfacesBytes();
        const info = await getBluetoothInfo();
        const btIfaces = info.interfaces.length ? info.interfaces.slice() : [];
        if (btIfaces.length === 0) {
          const allIfaces = Object.keys(os.networkInterfaces());
          for (const n of allIfaces) {
            const low = n.toLowerCase();
            if (low.includes('bt') || low.includes('bnep') || low.includes('bluetooth')) btIfaces.push(n);
          }
        }
        const computed = await measureBluetoothThroughputFromSamples(t0, t1, ms, btIfaces);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ts: Date.now(), ms, throughput: computed, detectedInterfaces: btIfaces }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cached: true, ts: cachedBluetoothThroughput.ts, ms: cachedBluetoothThroughput.interval_ms, throughput: cachedBluetoothThroughput.throughput, detectedInterfaces: cachedBluetoothThroughput.detectedInterfaces }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // GET /api/net/throughput
  if (u.pathname === '/api/net/throughput' && req.method === 'GET') {
    try {
      const ms = Number(u.query && u.query.ms ? u.query.ms : 0);
      if (ms > 0) {
        const t0 = await sampleInterfacesBytes();
        await new Promise(r => setTimeout(r, ms));
        const t1 = await sampleInterfacesBytes();
        const computed = await computeThroughputFromSamples(t0, t1, ms);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ts: Date.now(), ms, throughput: computed }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cached: true, ts: cachedThroughput.ts, ms: cachedThroughput.interval_ms, throughput: cachedThroughput.throughput }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // GET /api/proxy/openweathermap
  if (u.pathname === '/api/proxy/openweathermap' && req.method === 'GET') {
    try {
      const result = await handleOpenWeatherProxy(u.query || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({ ok: true }, result)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // GET /api/proxy/taux
  if (u.pathname === '/api/proxy/taux' && req.method === 'GET') {
    try {
      const result = await handleTauxProxy(u.query || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({ ok: true }, result)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // GET /api/endpoints -> liste des endpoints exposés
  if (u.pathname === '/api/endpoints' && req.method === 'GET') {
    try {
      const endpoints = [
        { method: 'GET', path: '/api/status', desc: 'CPU & mémoire instantanés (JSON)' },
        { method: 'WS',  path: '/ws', desc: 'WebSocket push périodique du même JSON (client peut envoyer { \"interval\": ms })' },
        { method: 'POST', path: '/api/exec', desc: 'Exécute une commande système; corps JSON { cmd }' },
        { method: 'GET', path: '/api/bluetooth', desc: 'Infos Bluetooth (interfaces, devices)' },
        { method: 'GET', path: '/api/bluetooth/throughput', desc: 'Débit Bluetooth (KB/s, 2 décimales); ?ms= pour mesure ponctuelle' },
        { method: 'GET', path: '/api/net/throughput', desc: 'Débit réseau global (KB/s, 2 décimales); ?ms= pour mesure ponctuelle; sinon renvoie cache' },
        { method: 'GET', path: '/api/proxy/openweathermap', desc: 'Proxy+cache OpenWeatherMap (7 jours); server injecte clé depuis Openweatherkey/openkey si absent' },
        { method: 'GET', path: '/api/proxy/taux', desc: 'Proxy+cache pour taux.live (7 jours)' },
        { method: 'GET', path: '/', desc: 'Fichiers statiques depuis ./public (index.html si /)' }
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ts: Date.now(), endpoints }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : 'error' }));
    }
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
}

// ---------------- WebSocket server ----------------
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  let intervalMs = DEFAULT_PUSH_MS;
  let timer = null;

  async function sendStatus() {
    try {
      const s = await buildStatus();
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(s));
    } catch (e) {}
  }

  function startTicker() {
    if (timer) clearInterval(timer);
    timer = setInterval(sendStatus, intervalMs);
    sendStatus();
  }

  ws.on('message', (msg) => {
    try {
      const j = JSON.parse(msg.toString());
      if (j && typeof j.interval === 'number') {
        const requested = Math.max(200, Math.floor(j.interval));
        intervalMs = requested;
        startTicker();
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (timer) clearInterval(timer);
    timer = null;
  });

  ws.on('error', () => {});

  startTicker();
});

server.on('upgrade', (req, socket, head) => {
  const u = url.parse(req.url || '');
  if (u.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (${server instanceof https.Server ? 'HTTPS' : 'HTTP'})`);
  console.log(`GET /api/status    -> JSON`);
  console.log(`WebSocket ws(s)://host:${PORT}/ws   -> push JSON`);
  console.log(`POST /api/exec     -> execute command`);
  console.log(`GET  /api/bluetooth -> bluetooth info`);
  console.log(`GET  /api/bluetooth/throughput -> bluetooth throughput (KB/s)`);
  console.log(`GET  /api/net/throughput -> network throughput (KB/s)`);
  console.log(`GET  /api/proxy/openweathermap -> proxy+cache for OpenWeatherMap`);
  console.log(`GET  /api/proxy/taux -> proxy+cache for taux.live`);
  console.log(`GET  /api/endpoints -> list available endpoints`);
});

// ---------------- File watcher and self-restart ----------------
// Build a map of mtimes for files under WATCH_PATHS (excluding node_modules, cache)
function walkFiles(base, map) {
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      const name = e.name;
      if (name === 'node_modules' || name === 'cache' || name === '.git') continue;
      const full = path.join(base, name);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) walkFiles(full, map);
        else if (st.isFile()) map[full] = st.mtimeMs;
      } catch (e) {}
    }
  } catch (e) {}
}

let lastMtimes = {};
function snapshotMtimes() {
  const map = {};
  for (const p of WATCH_PATHS) {
    if (fs.existsSync(p)) walkFiles(p, map);
  }
  return map;
}

function detectChanges(prev, curr) {
  // return true if any file added/removed/modified
  const prevKeys = new Set(Object.keys(prev));
  const currKeys = new Set(Object.keys(curr));
  if (prevKeys.size !== currKeys.size) return true;
  for (const k of currKeys) {
    if (!prevKeys.has(k)) return true;
    if (Math.abs((prev[k] || 0) - (curr[k] || 0)) > 1) return true;
  }
  return false;
}

function restartSelf() {
  try {
    console.log('Change detected — restarting server...');
    const node = process.argv[0];
    const args = process.argv.slice(1);
    const child = spawn(node, args, {
      detached: true,
      stdio: 'inherit'
    });
    child.unref();
    // give child a moment then exit
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    console.error('Failed to restart:', e && e.message ? e.message : e);
  }
}

// initialize snapshot
lastMtimes = snapshotMtimes();
setInterval(() => {
  try {
    const snap = snapshotMtimes();
    if (detectChanges(lastMtimes, snap)) {
      // update snapshot then restart
      lastMtimes = snap;
      restartSelf();
    }
  } catch (e) {}
}, WATCH_POLL_MS);

// ---------------- expose internals for debugging ----------------
module.exports = {
  cachedThroughput,
  cachedBluetoothThroughput,
  loadCache,
  saveCache
};
