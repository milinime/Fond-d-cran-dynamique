const testUrl = 'http://127.0.0.1:8081/server.key';
const display = document.getElementById('network-speed');

let lastValidSpeed = null;
let lastSuccessTime = Date.now();

async function measureSpeed() {
  const start = performance.now();
  try {
    const response = await fetch(testUrl, { cache: 'no-store'});
    const blob = await response.blob();
    const end = performance.now();

    const duration = (end - start) / 1000;
    const sizeMB = blob.size / (1024 * 1024);
    const speedMbps = (sizeMB * 8) / duration;

    lastValidSpeed = speedMbps;
    lastSuccessTime = Date.now();
    display.textContent = `${speedMbps.toFixed(2)} Mbps`;
} catch (error) {
    const now = Date.now();
    const elapsed = (now - lastSuccessTime) / 1000;

    if (lastValidSpeed!== null && elapsed < 600) {
      // Affiche la dernière valeur pendant 10 minutes
      display.textContent = `${lastValidSpeed.toFixed(2)} Mbps`;
} else {
      // Plus de succès depuis 10 minutes → reset
      display.textContent = `0 Mbps`;
      lastValidSpeed = null;
}
}
}

setInterval(measureSpeed, 1000);

