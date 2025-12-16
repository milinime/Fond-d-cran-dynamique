let sunriseHour = 7;
let sunsetHour = 19;
let retryInterval = null;
let isUsingDefaultTimes = true; // Pour savoir si on utilise les valeurs par défaut

// 🔁 Charger les heures stockées si disponibles
const storedSunrise = localStorage.getItem('sunriseHour');
const storedSunset = localStorage.getItem('sunsetHour');

if (storedSunrise && storedSunset) {
  sunriseHour = parseInt(storedSunrise);
  sunsetHour = parseInt(storedSunset);
  isUsingDefaultTimes = false;
}

function updateVisibility() {
  const now = new Date();
  const currentHour = now.getHours();
  const isDay = currentHour>= sunriseHour && currentHour < sunsetHour;

  sun.style.display = isDay? '': 'none';
  sunHalo.style.display = isDay? '': 'none';
  moon.style.display = isDay? 'none': '';
  moonHalo.style.display = isDay? 'none': '';

  updateSunTimeDisplay();
}

function updateSunTimeDisplay() {
  const sunriseDisplay = document.getElementById('sunrise-display');
  const sunsetDisplay = document.getElementById('sunset-display');

  if (sunriseDisplay && sunsetDisplay) {
    sunriseDisplay.textContent = `${sunriseHour}h${isUsingDefaultTimes? ' ⚠️': ''}`;
    sunsetDisplay.textContent = `${sunsetHour}h${isUsingDefaultTimes? ' ⚠️': ''}`;
}
}

function fetchSunTimes(lat, lon) {
  const apiKey = 'e208428afbb13f5bf9fe1e92e5cb418c';

  fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`)
.then(res => res.json())
.then(data => {
      const sunriseUTC = data.sys.sunrise * 1000;
      const sunsetUTC = data.sys.sunset * 1000;

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const sunriseLocal = new Date(sunriseUTC).toLocaleString('en-US', { timeZone: tz});
      const sunsetLocal = new Date(sunsetUTC).toLocaleString('en-US', { timeZone: tz});

      sunriseHour = new Date(sunriseLocal).getHours();
      sunsetHour = new Date(sunsetLocal).getHours();
      isUsingDefaultTimes = false;

      // 💾 Sauvegarde dans localStorage
      localStorage.setItem('sunriseHour', sunriseHour);
      localStorage.setItem('sunsetHour', sunsetHour);

      console.log(`✅ Heures mises à jour: lever ${sunriseHour}h / coucher ${sunsetHour}h`);

      updateVisibility();

      if (retryInterval) {
        clearInterval(retryInterval);
        retryInterval = null;
}
})
.catch(err => {
      console.warn('❌ Échec API OpenWeatherMap, nouvelle tentative dans 1s', err);
      if (!retryInterval) {
        retryInterval = setInterval(() => fetchSunTimes(lat, lon), 1000);
}
});
}

setInterval(updateVisibility, 60 * 1000);
updateVisibility();

if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude} = pos.coords;
      fetchSunTimes(latitude, longitude);
},
    err => {
      console.warn('⚠️ Géolocalisation refusée ou échouée. Utilisation des heures par défaut.', err);
}
);
}
