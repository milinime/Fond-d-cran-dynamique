const API_KEY = "e208428afbb13f5bf9fe1e92e5cb418c";

// Variables globales
let currentWeatherCode = "default";
let cachedLat = null;
let cachedLon = null;
let lastTemperature = "--";
let lastCity = "--";
let lastWindSpeed = null;
let lastWindDeg = 0;
let lastSuccessfulFetchAt = 0;
let weatherRetryTimer = null;

// Géolocalisation avec fallback
function getCoords(callback) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => callback(position.coords.latitude, position.coords.longitude),
      () => {
        console.warn("Geolocation failed or denied, using fallback coordinates.");
        callback(13.5, 2.1); // Niamey fallback
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    );
  } else {
    console.warn("Geolocation not supported, using fallback coordinates.");
    callback(13.5, 2.1);
  }
}

// Transitions / background
function getTransitionImages(hour, weatherCode) {
  const now = new Date();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();

  const transitions = [
    { start: 0, end: 360, from: "nuit", to: "matin" },
    { start: 360, end: 660, from: "matin", to: "midi" },
    { start: 660, end: 1020, from: "midi", to: "soir" },
    { start: 1020, end: 1200, from: "soir", to: "nuit" },
    { start: 1200, end: 1440, from: "nuit", to: "nuit" }
  ];

  let from = "nuit", to = "nuit", blend = 0;
  for (const t of transitions) {
    if (totalMinutes >= t.start && totalMinutes < t.end) {
      from = t.from;
      to = t.to;
      blend = (totalMinutes - t.start) / (t.end - t.start);
      break;
    }
  }

  const codePrefix = String(weatherCode).slice(0, 2);
  const variant = codePrefix === "01" ? "" :
                  codePrefix === "02" ? "_nuage" :
                  ["03", "04"].includes(codePrefix) ? "_couvert" :
                  ["09", "10"].includes(codePrefix) ? "_pluie" :
                  codePrefix === "11" ? "_orage" :
                  codePrefix === "13" ? "_neige" :
                  codePrefix === "50" ? "_brouillard" : "";

  const imgA = `assets/${from}${variant}.jpg`;
  const imgB = `assets/${to}${variant}.jpg`;

  return [imgA, imgB, blend];
}

function updateBackground() {
  const [imgA, imgB, blend] = getTransitionImages(new Date().getHours(), currentWeatherCode);
  const bgA = document.getElementById("backgroundA");
  const bgB = document.getElementById("backgroundB");

  if (bgA) {
    if (bgA.src !== imgA) bgA.src = imgA;
    bgA.style.opacity = String(1 - blend);
  }
  if (bgB) {
    if (bgB.src !== imgB) bgB.src = imgB;
    bgB.style.opacity = String(blend);
  }
}

// Astres (SunCalc requis)
function updateSunMoon(lat, lon) {
  if (typeof SunCalc === "undefined") return;

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

  const sunWrapper = document.getElementById("sun-wrapper");
  const sunEl = document.getElementById("sun");
  const sunHalo = document.querySelector(".sun-halo");

  if (sunWrapper && sunEl) {
    const sunSize = 60 + 100 * Math.max(0, sun.altitude / (Math.PI / 2));
    sunWrapper.style.width = `${sunSize}px`;
    sunWrapper.style.height = `${sunSize}px`;
    sunEl.style.width = `${sunSize}px`;
    sunEl.style.height = `${sunSize}px`;
    sunWrapper.style.left = `${sunX}%`;
    sunWrapper.style.top = `${sunY}%`;
    sunEl.style.opacity = sun.altitude > 0 ? "1" : "0";
    if (sunHalo) sunHalo.style.opacity = sun.altitude > 0 ? "1" : "0";
  }

  const moonWrapper = document.getElementById("moon-wrapper");
  const moonEl = document.getElementById("moon");
  const moonHalo = document.querySelector(".moon-halo");

  if (moonWrapper && moonEl) {
    const moonSize = 60 + 60 * Math.max(0, moon.altitude / (Math.PI / 2));
    moonWrapper.style.width = `${moonSize}px`;
    moonWrapper.style.height = `${moonSize}px`;
    moonEl.style.width = `${moonSize}px`;
    moonEl.style.height = `${moonSize}px`;
    moonWrapper.style.left = `${moonX}%`;
    moonWrapper.style.top = `${moonY}%`;
    if (moonHalo) moonHalo.style.opacity = moon.altitude > 0 ? "1" : "0";
  }

  if (typeof applyCelestialMask === "function") {
    applyCelestialMask({ x: sunX, y: sunY }, { x: moonX, y: moonY });
  }
}

// Horloge
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const clockEl = document.getElementById("clock");
  if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
}

// Affichage température / ville / vent
function showTemperature(temp) {
  const el = document.getElementById("temperature");
  if (!el) return;
  el.textContent = temp !== undefined && temp !== null ? `${temp}°C` : (lastTemperature !== "--" ? `${lastTemperature}°C` : "--");
}

function showCity(name) {
  const el = document.getElementById("city-name");
  if (!el) return;
  const city = name || (lastCity !== "--" ? lastCity : "--");
  el.textContent = city !== "--" ? `🌐 ${city}` : "--";
}

function showWind(speed, deg) {
  const txt = document.getElementById("wind-text");
  const arrow = document.getElementById("wind-arrow");
  if (txt) txt.textContent = speed !== undefined && speed !== null ? `${speed} km/h` : (lastWindSpeed !== null ? `${lastWindSpeed} km/h` : "--");
  if (arrow) arrow.style.transform = `rotate(${deg || 0}deg)`;
}

// Weather fetch / logique de retry
function scheduleWeatherUpdates(lat, lon) {
  if (weatherRetryTimer) {
    clearTimeout(weatherRetryTimer);
    weatherRetryTimer = null;
  }

  function tryUpdate() {
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`)
      .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(data => {
        lastSuccessfulFetchAt = Date.now();

        currentWeatherCode = data.weather && data.weather[0] && data.weather[0].icon ? data.weather[0].icon : "default";

        // icône météo fallback (test existence fichier)
        const iconPath = `assets/weather/${currentWeatherCode}.png`;
        const weatherIconEl = document.getElementById("weather-icon");
        if (weatherIconEl) {
          fetch(iconPath).then(r => {
            weatherIconEl.src = r.ok ? iconPath : "assets/weather/default.png";
          }).catch(() => {
            weatherIconEl.src = "assets/weather/default.png";
          });
        }

        updateBackground();

        if (data.main && typeof data.main.temp === "number") {
          lastTemperature = Math.round(data.main.temp);
        }
        showTemperature(lastTemperature);

        if (data.name) lastCity = data.name;
        showCity(lastCity);

        if (data.wind) {
          lastWindSpeed = typeof data.wind.speed === "number" ? Math.round(data.wind.speed) : null;
          lastWindDeg = typeof data.wind.deg === "number" ? data.wind.deg : 0;
          showWind(lastWindSpeed, lastWindDeg);
        } else {
          showWind(null, 0);
        }

        // prochaine mise à jour normale dans 1 heure
        weatherRetryTimer = setTimeout(tryUpdate, 100 * 60 * 1000);
      })
      .catch(err => {
        console.warn("Weather fetch failed:", err);
        currentWeatherCode = "default";
        const weatherIconEl = document.getElementById("weather-icon");
        if (weatherIconEl) weatherIconEl.src = "assets/weather/default.png";
        updateBackground();

        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const stillValid = (lastSuccessfulFetchAt && (now - lastSuccessfulFetchAt) < oneHour);

        if (stillValid) {
          showTemperature(lastTemperature);
          showCity(lastCity);
          showWind(lastWindSpeed, lastWindDeg);
        } else {
          lastTemperature = "--";
          lastCity = "--";
          lastWindSpeed = null;
          lastWindDeg = 0;
          showTemperature(null);
          showCity(null);
          showWind(null, 0);
        }

        // retry rapide (exponentiel possible) -> pour sécurité ici 1s puis escalade
        const elapsed = lastSuccessfulFetchAt ? (now - lastSuccessfulFetchAt) : Infinity;
        const retryDelay = stillValid ? 60 * 1000 : 1000; // si on avait des données, attendre 1min, sinon 1s
        weatherRetryTimer = setTimeout(tryUpdate, retryDelay);
      });
  }

  tryUpdate();
}

// INIT / boucles
window.addEventListener("load", () => {
  updateClock();
  setInterval(updateClock, 1000);

  const cityEl = document.getElementById("city-name");
  if (cityEl) cityEl.style.fontFamily = "'Segoe UI', sans-serif";
  const tempEl = document.getElementById("temperature");
  if (tempEl) tempEl.style.fontFamily = "'Segoe UI', sans-serif";
  const windEl = document.getElementById("wind-info");
  if (windEl) windEl.style.fontFamily = "'Segoe UI', sans-serif";

  getCoords((lat, lon) => {
    cachedLat = lat;
    cachedLon = lon;

    scheduleWeatherUpdates(lat, lon);

    // boucle visuelle plus lente que 1s si tu veux moins de charge ; 1000ms ici pour fluidité soleil/mode
    setInterval(() => {
      updateBackground();
      updateSunMoon(cachedLat, cachedLon);
    }, 1000);
  });
});

// relancer fetch météo quand on revient en ligne
window.addEventListener("online", () => {
  if (cachedLat !== null && cachedLon !== null) {
    scheduleWeatherUpdates(cachedLat, cachedLon);
  }
});