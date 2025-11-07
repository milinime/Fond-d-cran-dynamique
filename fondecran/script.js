const API_KEY = "e208428afbb13f5bf9fe1e92e5cb418c";
let currentWeatherCode = "default";
let cachedLat = null;
let cachedLon = null;
let lastTemperature = "--";
let lastCity = "--";
let lastWindSpeed = null;
let lastWindDeg = 0;
let lastSuccessfulFetchAt = 0;
let weatherRetryTimer = null;
let rainState = { active: true, drops: [], poolInterval: null };

// 📍 Coordonnées fixes (Niamey)
function getCoords(callback) {
  callback(13.5, 2.1);
}

// --- TRANSITIONS / BACKGROUND (inchangés, juste réutilisés) ---
function getTransitionImages(hour, weatherCode) {
  const now = new Date();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();

  const transitions = [
    { start: 0, end: 360, from: 'nuit', to: 'matin' },
    { start: 360, end: 660, from: 'matin', to: 'midi' },
    { start: 660, end: 1020, from: 'midi', to: 'soir' },
    { start: 1020, end: 1200, from: 'soir', to: 'nuit' },
    { start: 1200, end: 1440, from: 'nuit', to: 'nuit' }
  ];

  let from = 'nuit', to = 'nuit', blend = 0;
  for (const t of transitions) {
    if (totalMinutes >= t.start && totalMinutes < t.end) {
      from = t.from;
      to = t.to;
      blend = (totalMinutes - t.start) / (t.end - t.start);
      break;
    }
  }

  const variant = weatherCode.startsWith("01") ? "" :
                  weatherCode.startsWith("02") ? "_nuage" :
                  (weatherCode.startsWith("03") || weatherCode.startsWith("04")) ? "_couvert" :
                  (weatherCode.startsWith("09") || weatherCode.startsWith("10")) ? "_pluie" :
                  weatherCode.startsWith("11") ? "_orage" :
                  weatherCode.startsWith("13") ? "_neige" :
                  weatherCode.startsWith("50") ? "_brouillard" : "";

  const imgA = `assets/${from}${variant}.jpg`;
  const imgB = `assets/${to}${variant}.jpg`;

  return [imgA, imgB, blend];
}

function updateBackground() {
  const [imgA, imgB, blend] = getTransitionImages(new Date().getHours(), currentWeatherCode);
  const bgA = document.getElementById('backgroundA');
  const bgB = document.getElementById('backgroundB');

  if (bgA) bgA.src = imgA;
  if (bgB) bgB.src = imgB;
  if (bgA) bgA.style.opacity = 1 - blend;
  if (bgB) bgB.style.opacity = blend;
}

// --- ASTRES (soleil / lune) ---
function updateSunMoon(lat, lon) {
  if (typeof SunCalc === 'undefined') return;
  const now = new Date();
  const sun = SunCalc.getPosition(now, lat, lon);
  const moon = SunCalc.getMoonPosition(now, lat, lon);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const t = minutes / 1440;

  const simX = 50 + 40 * Math.cos(Math.PI * (1 - t));
  const simY = 80 - 60 * Math.sin(Math.PI * t);

  const realX = 50 + (sun.azimuth / Math.PI) * 50;
  const realY = 50 - (sun.altitude / (Math.PI / 2)) * 50;

  const sunX = 0.7 * realX + 0.3 * simX;
  const sunY = 0.7 * realY + 0.3 * simY;

  const moonX = 50 + (moon.azimuth / Math.PI) * 50;
  const moonY = 50 - (moon.altitude / (Math.PI / 2)) * 50;

  const sunWrapper = document.getElementById('sun-wrapper');
  const sunEl = document.getElementById('sun');
  const sunHalo = document.querySelector('.sun-halo');

  if (sunWrapper && sunEl) {
    const sunSize = 60 + 100 * Math.max(0, sun.altitude / (Math.PI / 2));
    sunWrapper.style.width = `${sunSize}px`;
    sunWrapper.style.height = `${sunSize}px`;
    sunEl.style.width = `${sunSize}px`;
    sunEl.style.height = `${sunSize}px`;
    sunWrapper.style.left = `${sunX}%`;
    sunWrapper.style.top = `${sunY}%`;
    sunEl.style.opacity = sun.altitude > 0 ? 1 : 0;
    if (sunHalo) sunHalo.style.opacity = sun.altitude > 0 ? 1 : 0;
  }

  const moonWrapper = document.getElementById('moon-wrapper');
  const moonEl = document.getElementById('moon');
  const moonHalo = document.querySelector('.moon-halo');

  if (moonWrapper && moonEl) {
    const moonSize = 60 + 60 * Math.max(0, moon.altitude / (Math.PI / 2));
    moonWrapper.style.width = `${moonSize}px`;
    moonWrapper.style.height = `${moonSize}px`;
    moonEl.style.width = `${moonSize}px`;
    moonEl.style.height = `${moonSize}px`;
    moonWrapper.style.left = `${moonX}%`;
    moonWrapper.style.top = `${moonY}%`;
    if (moonHalo) moonHalo.style.opacity = moon.altitude > 0 ? 1 : 0;
  }

  if (typeof applyCelestialMask === 'function') {
    applyCelestialMask({ x: sunX, y: sunY }, { x: moonX, y: moonY });
  }
}

// --- HORLOGE ---
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
}

// --- AFFICHAGE TEMP / VILLE / VENT ---
function showTemperature(temp) {
  const el = document.getElementById('temperature');
  if (!el) return;
  el.textContent = temp !== undefined && temp !== null ? `${temp}°C` : (lastTemperature !== "--" ? `${lastTemperature}°C` : "--");
}
function showCity(name) {
  const el = document.getElementById('city-name');
  if (!el) return;
  const city = name || (lastCity !== "--" ? lastCity : "--");
  el.textContent = city !== "--" ? `🌐 ${city}` : "--";
}
function showWind(speed, deg) {
  const txt = document.getElementById('wind-text');
  const arrow = document.getElementById('wind-arrow');
  if (txt) txt.textContent = (speed !== undefined && speed !== null) ? `${speed} km/h` : (lastWindSpeed !== null ? `${lastWindSpeed} km/h` : "--");
  if (arrow) arrow.style.transform = `rotate(${deg || 0}deg)`;
}

// --- WEATHER FETCH / LOGIC ---
function scheduleWeatherUpdates(lat, lon) {
  if (weatherRetryTimer) {
    clearTimeout(weatherRetryTimer);
    weatherRetryTimer = null;
  }

  function tryUpdate() {
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`)
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(data => {
        lastSuccessfulFetchAt = Date.now();

        currentWeatherCode = (data.weather && data.weather[0] && data.weather[0].icon) ? data.weather[0].icon : "default";

        // icône météo fallback
        const iconPath = `assets/weather/${currentWeatherCode}.png`;
        const weatherIconEl = document.getElementById('weather-icon');
        if (weatherIconEl) {
          fetch(iconPath).then(r => {
            weatherIconEl.src = r.ok ? iconPath : 'assets/weather/default.png';
          }).catch(() => {
            weatherIconEl.src = 'assets/weather/default.png';
          });
        }

        updateBackground();

        if (data.main && typeof data.main.temp === 'number') {
          lastTemperature = Math.round(data.main.temp);
        }
        showTemperature(lastTemperature);

        if (data.name) lastCity = data.name;
        showCity(lastCity);

        if (data.wind) {
          lastWindSpeed = typeof data.wind.speed === 'number' ? Math.round(data.wind.speed) : null;
          lastWindDeg = typeof data.wind.deg === 'number' ? data.wind.deg : 0;
          showWind(lastWindSpeed, lastWindDeg);
        } else {
          showWind(null, 0);
        }

        // Détection pluie pour animation
        const isRainy = currentWeatherCode.startsWith("09") || currentWeatherCode.startsWith("10");
        triggerRainAnimation(isRainy);

        weatherRetryTimer = setTimeout(tryUpdate, 3600000);
      })
      .catch(() => {
        currentWeatherCode = "default";
        const weatherIconEl = document.getElementById('weather-icon');
        if (weatherIconEl) weatherIconEl.src = 'assets/weather/default.png';
        updateBackground();

        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const stillValid = (lastSuccessfulFetchAt && (now - lastSuccessfulFetchAt) < oneHour);

        if (stillValid) {
          showTemperature(lastTemperature);
          showCity(lastCity);
        } else {
          lastTemperature = "--";
          lastCity = "--";
          showTemperature(null);
          showCity(null);
        }

        if (stillValid) {
          showWind(lastWindSpeed, lastWindDeg);
        } else {
          lastWindSpeed = null;
          lastWindDeg = 0;
          showWind(null, 0);
        }

        // couper la pluie en cas d'erreur si plus de données valides
        triggerRainAnimation(true);

        weatherRetryTimer = setTimeout(tryUpdate, 1000);
      });
  }

  tryUpdate();
}

// --- PLUIE : création du conteneur si absent ---
function ensureRainContainer() {
  let container = document.getElementById('rain-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'rain-container';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.overflow = 'hidden';
    container.style.zIndex = '20';
    document.body.appendChild(container);
  }
  return container;
}

// Supprime toutes les gouttes immédiatement
function clearRain() {
  const container = document.getElementById('rain-container');
  if (!container) return;
  container.innerHTML = '';
  rainState.drops = [];
  if (rainState.poolInterval) {
    clearInterval(rainState.poolInterval);
    rainState.poolInterval = null;
  }
  rainState.active = true;
}

// Crée et anime un ensemble de gouttes
function triggerRainAnimation(active) {
  const container = ensureRainContainer();
  if (!active) {
    clearRain();
    return;
  }

  // Si déjà active, ne pas recréer tout de suite; on peut ajuster l'intensité
  if (rainState.active) return;
  rainState.active = true;

  // Paramètres réglables
  const baseCount = 90; // gouttes initiales
  const variation = 60; // variation aléatoire
  const windFactor = (lastWindDeg || 0) * (Math.PI / 180);

  // Création initiale
  const total = baseCount + Math.round(Math.random() * variation);
  for (let i = 0; i < total; i++) {
    const drop = document.createElement('div');
    drop.className = 'raindrop';
    // styles inline (léger, évite ajout CSS séparé)
    const left = Math.random() * 100; // vw
    const size = 1 + Math.random() * 2.5; // px width
    const height = 10 + Math.random() * 30; // px height
    const duration = 0.6 + Math.random() * 1.8; // s
    const delay = Math.random() * 1.2; // s
    const blur = Math.random() < 0.2 ? 'filter: blur(0.6px);' : '';
    drop.style.position = 'absolute';
    drop.style.left = left + 'vw';
    drop.style.top = (-10 - Math.random() * 30) + 'px';
    drop.style.width = size + 'px';
    drop.style.height = height + 'px';
    drop.style.background = 'linear-gradient(to bottom, rgba(255,255,255,0.8), rgba(255,255,255,0.15))';
    drop.style.opacity = '0.9';
    drop.style.borderRadius = '1px';
    drop.style.transform = `translateX(0)`;
    drop.style.transition = `transform ${duration}s linear, top ${duration}s linear, opacity ${duration}s linear`;
    drop.style.animation = `none`;
    drop.style.zIndex = '21';
    if (blur) drop.style.filter = 'blur(0.3px)';

    // store metadata
    const meta = {
      el: drop,
      duration,
      left,
      windShift: (Math.cos(windFactor) * (5 + Math.random() * 10)) // px horizontal shift
    };

    container.appendChild(drop);
    rainState.drops.push(meta);

    // animate by setting final position in next tick
    (function(m) {
      requestAnimationFrame(() => {
        m.el.style.top = (window.innerHeight + 30) + 'px';
        m.el.style.transform = `translateX(${m.windShift}px)`;
        m.el.style.opacity = '0';
      });
      // cleanup after duration + small buffer
      setTimeout(() => {
        if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
        // remove from drops array
        const idx = rainState.drops.indexOf(m);
        if (idx >= 0) rainState.drops.splice(idx, 1);
      }, (m.duration + 0.2) * 1000);
    })(meta);
  }

  // Pool qui continue d'ajouter des gouttes à intervalle pour maintenir l'effet
  rainState.poolInterval = setInterval(() => {
    if (!rainState.active) return;
    // ajoute quelques gouttes à la fois
    const add = 6 + Math.floor(Math.random() * 8);
    for (let i = 0; i < add; i++) {
      const drop = document.createElement('div');
      drop.className = 'raindrop';
      const left = Math.random() * 100;
      const size = 1 + Math.random() * 2.5;
      const height = 10 + Math.random() * 30;
      const duration = 0.6 + Math.random() * 1.8;
      drop.style.position = 'absolute';
      drop.style.left = left + 'vw';
      drop.style.top = (-10 - Math.random() * 30) + 'px';
      drop.style.width = size + 'px';
      drop.style.height = height + 'px';
      drop.style.background = 'linear-gradient(to bottom, rgba(255,255,255,0.8), rgba(255,255,255,0.15))';
      drop.style.opacity = '0.9';
      drop.style.borderRadius = '1px';
      drop.style.transform = `translateX(0)`;
      drop.style.transition = `transform ${duration}s linear, top ${duration}s linear, opacity ${duration}s linear`;
      drop.style.zIndex = '21';
      container.appendChild(drop);

      const meta = {
        el: drop,
        duration,
        left,
        windShift: (Math.cos((lastWindDeg || 0) * (Math.PI / 180)) * (5 + Math.random() * 10))
      };

      rainState.drops.push(meta);
      (function(m) {
        requestAnimationFrame(() => {
          m.el.style.top = (window.innerHeight + 30) + 'px';
          m.el.style.transform = `translateX(${m.windShift}px)`;
          m.el.style.opacity = '0';
        });
        setTimeout(() => {
          if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
          const idx = rainState.drops.indexOf(m);
          if (idx >= 0) rainState.drops.splice(idx, 1);
        }, (m.duration + 0.2) * 1000);
      })(meta);
    }

    // safety: if too many elements, clear some
    if (rainState.drops.length > 400) {
      // remove oldest batch
      const removeCount = Math.floor(rainState.drops.length / 4);
      for (let i = 0; i < removeCount; i++) {
        const m = rainState.drops.shift();
        if (m && m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
      }
    }
  }, 700);
}

// --- INIT / BOUCLES ---
window.addEventListener('load', () => {
  updateClock();
  setInterval(updateClock, 1000);

  const cityEl = document.getElementById('city-name');
  if (cityEl) cityEl.style.fontFamily = "'Segoe UI', sans-serif";
  const tempEl = document.getElementById('temperature');
  if (tempEl) tempEl.style.fontFamily = "'Segoe UI', sans-serif";
  const windEl = document.getElementById('wind-info');
  if (windEl) windEl.style.fontFamily = "'Segoe UI', sans-serif";

  // ensure rain container exists from the start (optional)
  ensureRainContainer();

  getCoords((lat, lon) => {
    cachedLat = lat;
    cachedLon = lon;

    scheduleWeatherUpdates(lat, lon);

    setInterval(() => {
      updateBackground();
      updateSunMoon(cachedLat, cachedLon);
    }, 1000);
  });

  // small CSS injection for raindrops to avoid external stylesheet changes
  const styleId = 'rain-style-injected';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* basic fallback style for raindrops */
      .raindrop { will-change: transform, top, opacity; pointer-events: none; }
    `;
    document.head.appendChild(style);
  }
});

window.addEventListener('online', () => {
  if (cachedLat !== null && cachedLon !== null) {
    scheduleWeatherUpdates(cachedLat, cachedLon);
  }
});
