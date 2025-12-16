const canvas = document.getElementById('fogCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let fogLayers = [];
let fogActive = false;
let lastFogDetectedAt = null;
let userCoords = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (fogActive) generateFog(0.2);
}

window.addEventListener('resize', resizeCanvas);

function generateFog(intensity) {
  fogLayers = [];
  const layerCount = Math.floor(10 + intensity * 40);

  for (let i = 0; i < layerCount; i++) {
    fogLayers.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 400 + 300,
      alpha: intensity * (Math.random() * 0.1 + 0.05),
      dx: Math.random() * 0.1 - 0.05,
      dy: Math.random() * 0.05 - 0.025
    });
  }
}

function drawFogLayer(p) {
  const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
  gradient.addColorStop(0, `rgba(230, 230, 230, ${p.alpha})`);
  gradient.addColorStop(1, 'rgba(230, 230, 230, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fill();
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (fogActive) {
    for (let p of fogLayers) {
      drawFogLayer(p);
      p.x += p.dx;
      p.y += p.dy;

      if (p.x < -p.radius) p.x = canvas.width + p.radius;
      if (p.x > canvas.width + p.radius) p.x = -p.radius;
      if (p.y < -p.radius) p.y = canvas.height + p.radius;
      if (p.y > canvas.height + p.radius) p.y = -p.radius;
    }
  }
  requestAnimationFrame(animate);
}

async function getWeatherFogIntensity() {
  if (!userCoords) return;

  const apiKey = 'e208428afbb13f5bf9fe1e92e5cb418c'; // ← Remplace par ta clé API
  const { latitude, longitude } = userCoords;
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=metric`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const visibility = data.visibility || 10000;
    const condition = data.weather[0].main.toLowerCase();
    const description = data.weather[0].description.toLowerCase();

    const fogTerms = ['fog', 'mist', 'haze', 'smoke', 'dust', 'sand', 'ash', 'squall', 'tornado'];
    const isFoggy = fogTerms.includes(condition) || fogTerms.some(term => description.includes(term));

    if (isFoggy) {
      const intensity = Math.min(1, (10000 - visibility) / 10000);
      fogActive = true;
      lastFogDetectedAt = Date.now();
      generateFog(intensity);
    } else {
      fogActive = false;
      fogLayers = [];
    }
  } catch (error) {
    const now = Date.now();
    if (lastFogDetectedAt && now - lastFogDetectedAt < 60 * 60 * 1000) {
      fogActive = true; // Maintien du brouillard pendant 1h
    } else {
      fogActive = false;
      fogLayers = [];
    }
  }

  setTimeout(getWeatherFogIntensity, 5 * 60 * 1000); // Actualisation toutes les 5 min
}

navigator.geolocation.getCurrentPosition(
  pos => {
    userCoords = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude
    };
    getWeatherFogIntensity();
    animate();
  },
  err => {
    console.error('Géolocalisation refusée ou échouée:', err);
  }
);