// Météo gratuite, sans clé, via Open-Meteo.
const CODES = {
  0: "ciel dégagé", 1: "plutôt dégagé", 2: "partiellement nuageux", 3: "couvert",
  45: "brouillard", 48: "brouillard givrant",
  51: "bruine légère", 53: "bruine", 55: "bruine forte",
  61: "pluie légère", 63: "pluie", 65: "forte pluie",
  66: "pluie verglaçante", 67: "forte pluie verglaçante",
  71: "neige légère", 73: "neige", 75: "forte neige", 77: "grains de neige",
  80: "averses légères", 81: "averses", 82: "fortes averses",
  85: "averses de neige", 86: "fortes averses de neige",
  95: "orage", 96: "orage avec grêle", 99: "gros orage avec grêle",
};

// Noms d'icônes (dessinées côté interface).
const ICONS = {
  0: "sun", 1: "cloud-sun", 2: "cloud-sun", 3: "cloud", 45: "cloud-fog", 48: "cloud-fog",
  51: "cloud-drizzle", 53: "cloud-drizzle", 55: "cloud-drizzle", 61: "cloud-rain", 63: "cloud-rain", 65: "cloud-rain",
  66: "cloud-rain", 67: "cloud-rain", 71: "cloud-snow", 73: "cloud-snow", 75: "cloud-snow", 77: "cloud-snow",
  80: "cloud-rain", 81: "cloud-rain", 82: "cloud-lightning", 85: "cloud-snow", 86: "cloud-snow",
  95: "cloud-lightning", 96: "cloud-lightning", 99: "cloud-lightning",
};

const geoCache = new Map();

async function geocode(city) {
  const key = city.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city, count: "1", language: "fr" })}`,
  );
  const data = await res.json();
  const place = data.results?.[0];
  if (!place) throw new Error(`Ville introuvable : ${city}`);
  const result = { name: place.name, country: place.country, lat: place.latitude, lon: place.longitude };
  geoCache.set(key, result);
  return result;
}

export async function getWeather(city = process.env.CITY || "Paris") {
  const place = await geocode(city);
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "3",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = await res.json();
  if (!res.ok) throw new Error("Météo indisponible");
  return {
    city: place.name,
    country: place.country,
    now: {
      temp: Math.round(d.current.temperature_2m),
      feelsLike: Math.round(d.current.apparent_temperature),
      description: CODES[d.current.weather_code] || "—",
      icon: ICONS[d.current.weather_code] || "cloud",
      wind: Math.round(d.current.wind_speed_10m),
      humidity: d.current.relative_humidity_2m,
    },
    days: d.daily.time.map((date, i) => ({
      date,
      min: Math.round(d.daily.temperature_2m_min[i]),
      max: Math.round(d.daily.temperature_2m_max[i]),
      rain: d.daily.precipitation_probability_max[i],
      description: CODES[d.daily.weather_code[i]] || "—",
      icon: ICONS[d.daily.weather_code[i]] || "cloud",
    })),
  };
}
