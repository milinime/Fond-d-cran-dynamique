const API_URL = "https://cdn.taux.live/api/latest.json";
const REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1 semaine en ms


const displayRates = (eurToXof, usdToXof) => {
  const container = document.getElementById("exchangeRates");
  if (!container) return;

  container.innerHTML = `
    <div class="exchange-rates-content">
      <strong>Taux des devises:</strong><br>
      1 EUR → ${eurToXof.toFixed(2)} XOF<br>
      1 USD → ${usdToXof.toFixed(2)} XOF
    </div>
  `;
};

const fetchRates = async () => {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error("Réponse non valide");

    const data = await res.json();
    const usdToXof = data.rates.XOF; // USD → XOF
    const usdToEur = data.rates.EUR; // USD → EUR

    const eurToXof = usdToXof / usdToEur; // EUR → XOF

    displayRates(eurToXof, usdToXof);
    console.log("✅ Taux mis à jour avec succès");

    setTimeout(fetchRates, REFRESH_INTERVAL);
} catch (error) {
    console.warn("❌ Échec de la récupération des taux, nouvelle tentative dans 1 seconde...")
    setTimeout(fetchRates, 1000);
    
    
}
};

document.addEventListener("DOMContentLoaded", fetchRates);
