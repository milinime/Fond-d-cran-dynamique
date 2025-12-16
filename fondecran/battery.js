// BATTERIE - JAVASCRIPT
navigator.getBattery?.().then(battery => {
  const levelBar = document.querySelector(".batteryLevel");
  const textEl = document.getElementById("batteryText");

  function updateBattery() {
    const level = Math.round(battery.level * 100);
    const charging = battery.charging ? "⚡" : "";
    const warning = level < 20 ? "⚠️" : "";

    textEl.textContent = `${level}% ${charging}${warning}`;
    levelBar.style.width = `${level}%`;

    // Couleur selon niveau et état de charge
    if (level < 20 && !battery.charging) {
      levelBar.style.backgroundColor = "#ff1100ff"; // rouge
    } else if (level < 50) {
      levelBar.style.backgroundColor = "#ff9800"; // orange
    } else {
      levelBar.style.backgroundColor = "#4caf50"; // vert
    }
  }

  updateBattery();
  battery.addEventListener("levelchange", updateBattery);
  battery.addEventListener("chargingchange", updateBattery);
});