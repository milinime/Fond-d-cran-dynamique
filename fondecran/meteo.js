const container = document.getElementById('rain-container');

// 🎛️ MODIFIE ICI la fréquence (en ms) entre chaque goutte
let rainFrequency = 5;

let rainActive = false;
let lastCondition = null;
let lastRainTime = null;
let fallbackTimeout = null;
let cloudDelayTimeout = null;
let rainInterval = null;

function startRain(angle = 20, offsetX = 40) {
  stopRain(); // Nettoyage avant relance
  injectKeyframes(angle, offsetX);

  rainInterval = setInterval(() => {
    const drop = document.createElement('div');
    drop.className = 'raindrop';
    drop.style.left = `${Math.random() * 100}vw`;
    drop.style.top = `-${Math.random() * 30}px`;
    drop.style.animationDuration = `${0.8 + Math.random() * 0.6}s`;
    container.appendChild(drop);
    setTimeout(() => {
      if (container.contains(drop)) container.removeChild(drop);
    }, 2000);
  }, rainFrequency);
}

function stopRain() {
  clearInterval(rainInterval);
  rainInterval = null;
  container.innerHTML = '';
}

function injectKeyframes(angle, offsetX) {
  const existing = document.getElementById('rain-keyframes');
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = 'rain-keyframes';
  style.innerHTML = `
    @keyframes fall {
      0% {
        transform: translate(0, -30px) rotate(${angle}deg);
        opacity: 1;
      }
      100% {
        transform: translate(${offsetX}px, 100vh) rotate(${angle}deg);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

async function fetchWeather() {
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=13.5128&lon=2.1127&appid=e208428afbb13f5bf9fe1e92e5cb418c&units=metric`);
    const data = await res.json();
    const condition = data.weather[0].main.toLowerCase();
    const windSpeed = data.wind?.speed || 0;
    handleWeather(condition, windSpeed);
  } catch (err) {
    console.warn('Échec API météo');
    if (!rainActive && ['rain', 'drizzle', 'thunderstorm'].includes(lastCondition)) {
      console.log('Maintien de la pluie car condition précédente = pluie');
      startRain(20, 40);
      rainActive = true;
      clearTimeout(fallbackTimeout);
      fallbackTimeout = setTimeout(() => {
        stopRain();
        rainActive = false;
      }, 90 * 60 * 1000);
    }
  }
}

function handleWeather(condition, windSpeed) {
  const angle = Math.min(windSpeed * 2, 30);
  const offsetX = Math.min(windSpeed * 5, 60);

  if (['rain', 'drizzle', 'thunderstorm'].includes(condition)) {
    clearTimeout(cloudDelayTimeout);
    clearTimeout(fallbackTimeout);
    lastRainTime = Date.now();

    if (condition === 'rain') rainFrequency = 5;
    if (condition === 'drizzle') rainFrequency = 20;
    if (condition === 'thunderstorm') rainFrequency = 2;

    startRain(angle, offsetX);
    rainActive = true;
    lastCondition = condition;
  }

  else if (condition === 'clouds' && ['rain', 'drizzle', 'thunderstorm'].includes(lastCondition)) {
    console.log('Nuageux après pluie → maintien pluie faible 20 min');
    rainFrequency = 30;
    startRain(angle, offsetX);
    rainActive = true;
    lastCondition = condition;

    clearTimeout(cloudDelayTimeout);
    cloudDelayTimeout = setTimeout(() => {
      stopRain();
      rainActive = false;
    }, 20 * 60 * 1000);
  }

  else {
    stopRain();
    rainActive = false;
    lastCondition = condition;
  }
}

setInterval(fetchWeather, 5 * 60 * 1000); // Actualisation toutes les 5 min
fetchWeather(); // Initialisation