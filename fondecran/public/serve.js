// server-json-only.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const { exec: _exec } = require('child_process');
const exec = util.promisify(_exec);
const WebSocket = require('ws');
// Certificats SSL (remplace par tes chemins)
const options = {
  key: fs.readFileSync('server (2).key'),
  cert: fs.readFileSync('server (2).crt')
};
// Utilitaires d'envoi JSON uniforme
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj, null, 2));
}
// ----- Parsers utilitaires ----- //
function parseWmicCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    const obj = {};
    header.forEach((h, i) => obj[h || `col${i}`] = cols[i] || '');
    return obj;
  });
}
function parseTasklistCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  return lines.map(line => {
    const cols = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cols.push(cur); cur=''; continue; }
      cur += ch;
    }
    if (cur !== '') cols.push(cur);
    return cols;
  }).map(cols => ({
    imageName: cols[0] || '',
    pid: cols[1] || '',
    sessionName: cols[2] || '',
    sessionNumber: cols[3] || '',
    memUsage: cols[4] || ''
  }));
}
function parseScQuery(output) {
  const blocks = output.split(/\r?\n\r?\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const obj = {};
    block.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (m) obj[m[1].trim()] = m[2].trim();
    });
    return obj;
  });
}
function parseWevtutil(output) {
  return output.split(/\r?\n\r?\n/).map(s => s.trim()).filter(Boolean);
}
function secondsToMs(n) { return Math.round(n * 1000); }
// ----- Endpoint list (single source of truth) ----- //
const ENDPOINTS = [
  '/api/endpoints',
  '/api/system',
  '/api/interfaces',
  '/api/internet',
  '/api/status',
  '/api/cpu',
  '/api/memory',
  '/api/disk',
  '/api/processes',
  '/api/services',
  '/api/eventlogs',
  '/api/registry?key=HKLM\\\\SOFTWARE\\\\...',
  '/api/network/wifi',
  '/api/network/routes',
  '/ws (WebSocket for cpu/memory push)'
];
// ----- Handlers ----- //
async function handleApiInternet() {
  const { stdout } = await exec(process.platform === 'win32' ? 'route print' : 'ip route');
  const lines = stdout.split(/\r?\n/);
  let interfaceIP = null, ifaceName = null;
  if (process.platform === 'win32') {
    const defaultLine = lines.find(l => l.includes('0.0.0.0'));
    if (!defaultLine) return { ok: false, error: 'Pas de route par défaut trouvée', raw: stdout };
    const parts = defaultLine.trim().split(/\s+/);
    interfaceIP = parts[3] || null;
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (addrs.some(a => a.address === interfaceIP)) { ifaceName = name; break; }
    }
  } else {
    const defaultLine = lines.find(l => l.startsWith('default') || l.includes('default'));
    if (!defaultLine) return { ok: false, error: 'Pas de route par défaut trouvée', raw: stdout };
    const match = defaultLine.match(/dev\s+(\S+)/);
    ifaceName = match ? match[1] : null;
    if (ifaceName) {
      const addrs = os.networkInterfaces()[ifaceName] || [];
      const v4 = addrs.find(a => a.family === 'IPv4');
      interfaceIP = v4 ? v4.address : null;
    }
  }
  return { ok: true, parsed: { interface: ifaceName || 'Inconnue', ip: interfaceIP }, raw: stdout };
}
async function handleDisk() {
  const stdout = process.platform === 'win32' ?
    (await exec('wmic logicaldisk get caption,freespace,size /format:csv')).stdout :
    (await exec('df -P -B1')).stdout;
  if (process.platform === 'win32') {
    const parsed = parseWmicCsv(stdout);
    return { ok: true, parsed, raw: stdout };
  } else {
    const lines = stdout.trim().split(/\r?\n/);
    const disks = lines.slice(1).map(l => {
      const cols = l.split(/\s+/);
      return {
        filesystem: cols[0],
        size: Number(cols[1]),
        used: Number(cols[2]),
        avail: Number(cols[3]),
        usePercent: cols[4],
        mountpoint: cols[5]
      };
    });
    return { ok: true, parsed: disks, raw: stdout };
  }
}
async function handleProcesses() {
  if (process.platform === 'win32') {
    const stdout = (await exec('tasklist /FO CSV /NH')).stdout;
    const parsed = parseTasklistCsv(stdout);
    return { ok: true, parsed, raw: stdout };
  } else {
    const stdout = (await exec('ps -eo pid,user,pcpu,pmem,comm --no-headers')).stdout;
    const procs = stdout.trim().split(/\r?\n/).filter(Boolean).map(l => {
      const m = l.trim().split(/\s+/, 5);
      return { pid: m[0], user: m[1], cpu: m[2], mem: m[3], command: m[4] };
    });
    return { ok: true, parsed: procs, raw: stdout };
  }
}
async function handleServices() {
  if (process.platform !== 'win32') return { ok: false, error: 'Service listing only on Windows' };
  const stdout = (await exec('sc query state= all')).stdout;
  const parsed = parseScQuery(stdout);
  return { ok: true, parsed, raw: stdout };
}
async function handleEventLogs() {
  if (process.platform !== 'win32') return { ok: false, error: 'Event logs only on Windows' };
  const stdout = (await exec('wevtutil qe System /c:100 /f:text')).stdout;
  const parsed = parseWevtutil(stdout);
  return { ok: true, parsed, raw: stdout };
}
async function handleRegistry(urlObj) {
  if (process.platform !== 'win32') return { ok: false, error: 'Registry access only on Windows' };
  const key = urlObj.searchParams.get('key');
  if (!key) return { ok: false, error: 'Param key required' };
  const stdout = (await exec(`reg query "${key}"`)).stdout;
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const out = {};
  lines.forEach(line => {
    const m = line.match(/^\s*([^ ]+)\s+([A-Z0-9_]+)\s+(.+)$/);
    if (m) out[m[1]] = { type: m[2], data: m[3].trim() };
  });
  return { ok: true, parsed: out, raw: stdout };
}
async function handleWifi() {
  if (process.platform !== 'win32') return { ok: false, error: 'Wifi info implemented for Windows only' };
  const stdout = (await exec('netsh wlan show interfaces')).stdout;
  const obj = {};
  stdout.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (m) obj[m[1].trim()] = m[2].trim();
  });
  return { ok: true, parsed: obj, raw: stdout };
}
async function handleRoutes() {
  const stdout = (await exec(process.platform === 'win32' ? 'route print' : 'ip route')).stdout;
  if (process.platform === 'win32') {
    const defaults = stdout.split(/\r?\n/).filter(l => l.includes('0.0.0.0')).map(l => l.trim());
    return { ok: true, parsed: { defaults }, raw: stdout };
  } else {
    const defaults = stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const m = line.match(/^default via (\S+) dev (\S+)/);
      if (m) return { gateway: m[1], dev: m[2] };
      return { raw: line };
    });
    return { ok: true, parsed: { routes: defaults }, raw: stdout };
  }
}
// CPU sampling helper
function sampleCpuPercent(intervalMs = 200) {
  return new Promise(resolve => {
    const start = os.cpus();
    setTimeout(() => {
      const end = os.cpus();
      const usage = start.map((s, i) => {
        const e = end[i].times;
        const sTimes = s.times;
        const busyStart = sTimes.user + sTimes.nice + sTimes.sys + sTimes.irq;
        const busyEnd = e.user + e.nice + e.sys + e.irq;
        const idleStart = sTimes.idle;
        const idleEnd = e.idle;
        const busy = busyEnd - busyStart;
        const idle = idleEnd - idleStart;
        const total = busy + idle;
        const pct = total > 0 ? ((busy / total) * 100).toFixed(2) : '0.00';
        return { core: i, pct: Number(pct) };
      });
      const avg = (usage.reduce((s, c) => s + c.pct, 0) / usage.length).toFixed(2);
      resolve({ perCore: usage, avg: Number(avg) });
    }, intervalMs);
  });
}
// ----- Create HTTPS server ----- //
const server = https.createServer(options, async (req, res) => {
  try {
    const urlObj = new URL(req.url, `https://${req.headers.host}`);
    const pathname = urlObj.pathname;
    // /api/endpoints
    if (pathname === '/api/endpoints') {
      return sendJson(res, { ok: true, parsed: ENDPOINTS });
    }
    // /api/system
    if (pathname === '/api/system') {
      return sendJson(res, {
        ok: true,
        parsed: {
          platform: os.platform(),
          release: os.release(),
          uptimeMs: secondsToMs(os.uptime()),
          hostname: os.hostname(),
          user: os.userInfo()
        }
      });
    }
    // /api/interfaces
    if (pathname === '/api/interfaces') {
      return sendJson(res, { ok: true, parsed: os.networkInterfaces() });
    }
    // /api/internet
    if (pathname === '/api/internet') {
      const out = await handleApiInternet();
      return sendJson(res, out, out.ok ? 200 : 500);
    }
    // /api/cpu
    if (pathname === '/api/cpu') {
      const sample = await sampleCpuPercent(200);
      return sendJson(res, { ok: true, parsed: sample });
    }
    // /api/memory
    if (pathname === '/api/memory') {
      const total = os.totalmem(), free = os.freemem(), used = total - free;
      return sendJson(res, { ok: true, parsed: { total, free, used, usagePercent: Number(((used / total) * 100).toFixed(2)) } });
    }
    // /api/disk
    if (pathname === '/api/disk') {
      const out = await handleDisk();
      return sendJson(res, out, out.ok ? 200 : 500);
    }
    // /api/processes
    if (pathname === '/api/processes') {
      const out = await handleProcesses();
      return sendJson(res, out, out.ok ? 200 : 500);
    }
    // /api/services
    if (pathname === '/api/services') {
      const out = await handleServices();
      return sendJson(res, out, out.ok ? 200 : 400);
    }
    // /api/eventlogs
    if (pathname === '/api/eventlogs') {
      const out = await handleEventLogs();
      return sendJson(res, out, out.ok ? 200 : 400);
    }
    // /api/registry
    if (pathname === '/api/registry') {
      const out = await handleRegistry(urlObj);
      return sendJson(res, out, out.ok ? 200 : 400);
    }
    // /api/network/wifi
    if (pathname === '/api/network/wifi') {
      const out = await handleWifi();
      return sendJson(res, out, out.ok ? 200 : 400);
    }
    // /api/network/routes
    if (pathname === '/api/network/routes') {
      const out = await handleRoutes();
      return sendJson(res, out, out.ok ? 200 : 500);
    }
    // /api/status (cpu + memory)
    if (pathname === '/api/status') {
      const cpuSample = await sampleCpuPercent(200);
      const total = os.totalmem(), free = os.freemem(), used = total - free;
      return sendJson(res, {
        ok: true,
        parsed: {
          cpu: cpuSample,
          memory: { total, free, used, usagePercent: Number(((used / total) * 100).toFixed(2)) }
        }
      });
    }
    // Static files: keep serving but only for assets; not considered API — still return JSON for 404/errors
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    const ext = path.extname(filePath);
    const contentType = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : ext === '.json' ? 'application/json' : 'text/html';
    fs.readFile(filePath, (err, content) => {
      if (err) return sendJson(res, { ok: false, error: 'Fichier non trouvé' }, 404);
      // Serve file raw; clients expect correct Content-Type for assets — but keep non-API responses as files
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  } catch (err) {
    sendJson(res, { ok: false, error: err.message }, 500);
  }
});
// ----- WebSocket server for pushing cpu/ram (JSON) ----- //
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', ws => {
  let interval = 1000;
  let timer = null;
  async function pushStatus() {
    const cpu = await sampleCpuPercent(200);
    const total = os.totalmem(), free = os.freemem(), used = total - free;
    const payload = {
      ok: true,
      ts: Date.now(),
      parsed: {
        cpu,
        memory: { total, free, used, usagePercent: Number(((used / total) * 100).toFixed(2)) }
      }
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(pushStatus, interval);
  }
  ws.on('message', msg => {
    try {
      const obj = JSON.parse(msg.toString());
      if (obj.interval && Number(obj.interval) >= 200) {
        interval = Number(obj.interval);
        start();
        ws.send(JSON.stringify({ ok: true, interval }));
      }
    } catch (e) { /* ignore */ }
  });
  ws.on('close', () => { if (timer) clearInterval(timer); });
  start();
});
// Upgrade HTTP -> WebSocket only on /ws
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `https://${request.headers.host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});
// ----- Launch ----- //
const PORT = 443;
server.listen(PORT, () => {
  console.log(`✅ Serveur HTTPS lancé sur https://localhost:${PORT} Les API liant Node.js au système sont lancées : visitez https://localhost/api/endpoints pour en savoir plus`);
  console.log('WebSocket endpoint: wss://localhost/ws  (send {"interval":1000} to change push rate)');
});