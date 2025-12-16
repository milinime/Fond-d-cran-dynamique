/* status-simple.js
   - CPU affiché en entier (0 décimale), borné 0–100
   - RAM affichée en GB avec 2 décimales
   - Essaie WebSocket /ws puis fallback polling /api/status toutes les 1s
*/
(function(){
  const STATUS_URL = '/api/status';
  const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
  const POLL_MS = 1000;
  const ids = { cpuText: 'cpuText', ramText: 'ramText', stamp: 'statusStamp' };
  function q(id){ return document.getElementById(id); }
  function fmtGB2(bytes){
    if (!Number.isFinite(bytes) || bytes === 0) return '0.00 GB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function applyStatus(json){
    if (!json || !json.ok || !json.parsed) return;
    const cpu = json.parsed.cpu;
    let avg = null;
    if (cpu) avg = cpu.avg ?? (Array.isArray(cpu.perCore) ? (cpu.perCore.reduce((s,c)=>s+(c.pct||0),0)/cpu.perCore.length) : null);
    const mem = json.parsed.memory || {};
    const total = Number(mem.total || 0);
    const used = Number(mem.used ?? (total - (mem.free || 0)));
    const cpuEl = q(ids.cpuText), ramEl = q(ids.ramText), stampEl = q(ids.stamp);
    if (cpuEl) {
      const raw = (avg !== null && !isNaN(avg)) ? Number(avg) : NaN;
      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : null;
      const cpuDisplay = clamped !== null ? clamped + '%' : '— %';
      cpuEl.textContent = 'Utilisation du CPU : ' + cpuDisplay;
    }
    if (ramEl) {
      const usedStr = Number.isFinite(used) ? fmtGB2(used) : '—';
      const totalStr = Number.isFinite(total) ? fmtGB2(total) : '—';
      ramEl.textContent = 'Utilisation de la RAM : ' + usedStr + ' / ' + totalStr;
    }
    if (stampEl) stampEl.textContent = new Date(json.ts || Date.now()).toLocaleTimeString();
  }
  // Polling fallback
  let pollTimer = null;
  async function fetchStatus(){
    try{
      const res = await fetch(STATUS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      applyStatus(json);
    }catch(err){
      console.debug('status fetch failed', err.message);
    }
  }
  // WebSocket attempt
  let ws = null;
  function startWebSocket(){
    try{
      ws = new WebSocket(WS_URL);
      ws.addEventListener('open', () => {
        try{ ws.send(JSON.stringify({ interval: 1000 })); }catch(e){}
        if (pollTimer){ clearInterval(pollTimer); pollTimer = null; }
      });
      ws.addEventListener('message', ev => {
        try{ const json = JSON.parse(ev.data); applyStatus(json); }catch(e){}
      });
      ws.addEventListener('close', () => {
        ws = null;
        setTimeout(() => { if (!ws && !pollTimer) pollTimer = setInterval(fetchStatus, POLL_MS); }, 1000);
      });
      ws.addEventListener('error', () => {});
    }catch(e){
      // fallback to polling
    }
  }
  function init(){
    startWebSocket();
    if (!pollTimer){ fetchStatus(); pollTimer = setInterval(fetchStatus, POLL_MS); }
  }
  // expose for debugging
  window.__simpleStatus = { init, fetchStatus, startWebSocket };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();