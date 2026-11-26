window.StradaWeather = (() => {
  const COMPASS_DE = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

  function toFiniteNumber(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function degToCompass(deg) {
    const n = toFiniteNumber(deg);
    if (n === null) return "";
    const idx = Math.round(((n % 360) + 360) % 360 / 45) % 8;
    return COMPASS_DE[idx];
  }

  function decodeWmo(code) {
    const c = toFiniteNumber(code);
    if (c === null) return { icon: "🌡️", label: "Wetter" };
    if (c === 0) return { icon: "☀️", label: "Klar" };
    if (c === 1) return { icon: "🌤️", label: "Überwiegend klar" };
    if (c === 2) return { icon: "⛅", label: "Leicht bewölkt" };
    if (c === 3) return { icon: "☁️", label: "Bedeckt" };
    if (c === 45 || c === 48) return { icon: "🌫️", label: "Nebel" };
    if (c >= 51 && c <= 57) return { icon: "🌦️", label: "Nieselregen" };
    if (c >= 61 && c <= 65) return { icon: "🌧️", label: "Regen" };
    if (c === 66 || c === 67) return { icon: "🌧️", label: "Gefrierender Regen" };
    if (c >= 71 && c <= 77) return { icon: "❄️", label: "Schnee" };
    if (c >= 80 && c <= 82) return { icon: "🌦️", label: "Regenschauer" };
    if (c === 85 || c === 86) return { icon: "🌨️", label: "Schneeschauer" };
    if (c >= 95 && c <= 99) return { icon: "⛈️", label: "Gewitter" };
    return { icon: "🌡️", label: "Wetter" };
  }

  function getMidpoint(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const mid = coords[Math.floor(coords.length / 2)];
    const lat = toFiniteNumber(mid?.[0]);
    const lon = toFiniteNumber(mid?.[1]);
    if (lat === null || lon === null) return null;
    // Auf 2 Nachkommastellen (~1 km) runden – schützt genaue Adressen
    return {
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100
    };
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (_err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function extractHour(data, targetHourUtc) {
    const h = data?.hourly;
    if (!h || !Array.isArray(h.time) || h.time.length === 0) return null;

    let idx = h.time.findIndex((t) => {
      const hour = toFiniteNumber(String(t).slice(11, 13));
      return hour === targetHourUtc;
    });
    if (idx < 0) idx = Math.min(targetHourUtc, h.time.length - 1);

    const temp = toFiniteNumber(h.temperature_2m?.[idx]);
    if (temp === null) return null;

    const wind = toFiniteNumber(h.wind_speed_10m?.[idx]);
    const windDir = toFiniteNumber(h.wind_direction_10m?.[idx]);
    const precip = toFiniteNumber(h.precipitation?.[idx]);
    const code = toFiniteNumber(h.weather_code?.[idx]);

    const wmo = decodeWmo(code);
    return {
      temp_c: Math.round(temp * 10) / 10,
      wind_kmh: wind !== null ? Math.round(wind) : null,
      wind_dir_deg: windDir !== null ? Math.round(windDir) : null,
      wind_dir: windDir !== null ? degToCompass(windDir) : "",
      precip_mm: precip !== null ? Math.round(precip * 10) / 10 : 0,
      code: code !== null ? code : null,
      label: wmo.label,
      fetched_at: new Date().toISOString()
    };
  }

  async function fetchForTour({ startedAt, durationS = 0, coords }) {
    const mid = getMidpoint(coords);
    if (!mid || !startedAt) return null;

    const startMs = Date.parse(startedAt);
    if (!Number.isFinite(startMs)) return null;

    // Mittlere Uhrzeit der Fahrt (in UTC für eindeutiges Stunden-Matching)
    const midMs = startMs + Math.max(0, Number(durationS) || 0) * 500;
    const nowMs = Date.now();
    if (midMs > nowMs + 3600 * 1000) return null; // Keine Zukunftswerte

    const midDate = new Date(midMs);
    const dateStr = midDate.toISOString().slice(0, 10);
    const targetHourUtc = midDate.getUTCHours();

    const params =
      `latitude=${mid.lat}&longitude=${mid.lon}` +
      `&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
      `&start_date=${dateStr}&end_date=${dateStr}&timezone=UTC`;

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
    const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?${params}`;

    const ageDays = (nowMs - midMs) / (1000 * 60 * 60 * 24);
    const urls = ageDays <= 5 ? [forecastUrl, archiveUrl] : [archiveUrl, forecastUrl];

    for (const url of urls) {
      const data = await fetchJsonWithTimeout(url);
      const parsed = extractHour(data, targetHourUtc);
      if (parsed) return parsed;
    }

    return null;
  }

  function createWeatherElement(weather) {
    const tempC = toFiniteNumber(weather?.temp_c);
    if (tempC === null) return null;

    const wmo = decodeWmo(weather.code);
    const wrap = document.createElement("div");
    wrap.className = "tour-weather";

    const mainSpan = document.createElement("span");
    mainSpan.className = "weather-chip weather-main";
    mainSpan.textContent = `${wmo.icon} ${weather.label || wmo.label}`;
    wrap.appendChild(mainSpan);

    const tempSpan = document.createElement("span");
    tempSpan.className = "weather-chip";
    tempSpan.textContent = `${tempC.toFixed(1).replace(".", ",")} °C`;
    wrap.appendChild(tempSpan);

    const windKmh = toFiniteNumber(weather.wind_kmh);
    if (windKmh !== null) {
      const dir = weather.wind_dir || degToCompass(weather.wind_dir_deg);
      const windSpan = document.createElement("span");
      windSpan.className = "weather-chip";
      windSpan.textContent = `Wind ${Math.round(windKmh)} km/h${dir ? " " + dir : ""}`;
      wrap.appendChild(windSpan);
    }

    const precipMm = toFiniteNumber(weather.precip_mm);
    if (precipMm !== null && precipMm >= 0.1) {
      const rainSpan = document.createElement("span");
      rainSpan.className = "weather-chip";
      rainSpan.textContent = `Niederschlag ${precipMm.toFixed(1).replace(".", ",")} mm/h`;
      wrap.appendChild(rainSpan);
    }

    return wrap;
  }

  return { fetchForTour, createWeatherElement };
})();
