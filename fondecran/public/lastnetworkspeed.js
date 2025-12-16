const testUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/50px-PNG_transparency_demonstration_1.png';; // ~1.2 Ko
const display = document.getElementById('network-speed');
const convert = 125;

let lastValidSpeed = null;
let lastSuccessTime = Date.now();

async function measureSpeed() {
  const start = performance.now();
  try {
    const response = await fetch(testUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error("Échec réseau");

    const blob = await response.blob();
    const end = performance.now();

    const duration = (end - start) / 1000;
    const sizeMB = blob.size / (1024 * 1024);
    const speedMbps = (sizeMB * 8) / duration;

    lastValidSpeed = speedMbps;
    lastSuccessTime = Date.now();
    display.textContent = `${(speedMbps * convert).toFixed(0)} Ko/s`;
  } catch (error) {
    const now = Date.now();
    const elapsed = (now - lastSuccessTime) / 1000;

    if (lastValidSpeed !== null && elapsed < 5) {
      display.textContent = `${(lastValidSpeed * convert).toFixed(0)} Ko/s`;
    } else {
      display.textContent = `Aucun accès internet`;
      lastValidSpeed = null;
    }
  }
}

setInterval(measureSpeed, 1000); // Mise à jour toutes les secondes