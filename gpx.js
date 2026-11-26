window.StradaGPX = (() => {
  const EARTH_RADIUS_M = 6371000;
  const PRIVACY_TRIM_M = 400;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function extractExtensionValues(ptNode) {
    let power = null;
    let hr = null;
    let cad = null;

    const ext = ptNode.getElementsByTagName("extensions")[0];
    if (!ext) return { power, hr, cad };

    const descendants = ext.getElementsByTagName("*");
    for (let i = 0; i < descendants.length; i++) {
      const el = descendants[i];
      if (el.children.length > 0) continue;
      const name = (el.localName || el.nodeName || "").toLowerCase();
      const val = parseFloat(el.textContent);
      if (!Number.isFinite(val)) continue;

      if (power === null && (name === "power" || name === "watts")) {
        if (val >= 0 && val <= 2500) power = val;
      } else if (hr === null && (name === "hr" || name === "heartrate")) {
        if (val >= 30 && val <= 240) hr = val;
      } else if (cad === null && (name === "cad" || name === "cadence")) {
        if (val >= 0 && val <= 250) cad = val;
      }
    }
    return { power, hr, cad };
  }

  function computeElevationGain(points) {
    const eles = points.map((p) => p.ele).filter((e) => Number.isFinite(e));
    if (eles.length < 3) return 0;

    // 3-Punkt-Glättung gegen GPS-Höhenrauschen
    const smoothed = eles.map((e, i) => {
      if (i === 0 || i === eles.length - 1) return e;
      return (eles[i - 1] + e + eles[i + 1]) / 3;
    });

    // Hysterese (2,5 m Schwelle) verhindert künstliche Höhenmeter im Flachland
    const THRESHOLD = 2.5;
    let gain = 0;
    let refEle = smoothed[0];

    for (let i = 1; i < smoothed.length; i++) {
      const diff = smoothed[i] - refEle;
      if (diff >= THRESHOLD) {
        gain += diff;
        refEle = smoothed[i];
      } else if (diff <= -THRESHOLD) {
        refEle = smoothed[i];
      }
    }
    return Math.round(gain * 10) / 10;
  }

  function downsample(arr, maxPoints) {
    if (arr.length <= maxPoints) return arr;
    const result = [];
    const step = (arr.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
      result.push(arr[Math.round(i * step)]);
    }
    return result;
  }

  function removeXmlNodesByTag(xmlDoc, tagName) {
    const nodes = Array.from(xmlDoc.getElementsByTagName(tagName));
    for (const n of nodes) {
      if (n.parentNode) {
        n.parentNode.removeChild(n);
      }
    }
  }

  function parseGPX(xmlText, fileName, options = {}) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "application/xml");

    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("Die Datei ist keine gültige GPX/XML-Datei.");
    }

    let ptNodes = Array.from(xmlDoc.getElementsByTagName("trkpt"));
    if (ptNodes.length === 0) {
      ptNodes = Array.from(xmlDoc.getElementsByTagName("rtept"));
    }
    if (ptNodes.length < 2) {
      throw new Error("Die GPX-Datei enthält zu wenige GPS-Punkte (mindestens 2 erforderlich).");
    }

    // Titel aus GPX oder Dateiname ableiten
    const trkName = xmlDoc.querySelector("trk > name, rte > name, metadata > name");
    const defaultTitle =
      (trkName && trkName.textContent.trim()) ||
      (fileName || "Neue Tour").replace(/\.gpx$/i, "");

    const points = [];
    let cumDist = 0;
    let movingTimeS = 0;
    let powerSum = 0;
    let powerCount = 0;
    let hrSum = 0;
    let hrCount = 0;
    let cadSum = 0;
    let cadCount = 0;

    for (let i = 0; i < ptNodes.length; i++) {
      const node = ptNodes[i];
      const lat = parseFloat(node.getAttribute("lat"));
      const lon = parseFloat(node.getAttribute("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const eleNode = node.getElementsByTagName("ele")[0];
      const ele = eleNode ? parseFloat(eleNode.textContent) : NaN;

      const timeNode = node.getElementsByTagName("time")[0];
      const timeMs = timeNode ? Date.parse(timeNode.textContent.trim()) : NaN;

      const ext = extractExtensionValues(node);
      if (ext.power !== null) {
        powerSum += ext.power;
        powerCount++;
      }
      if (ext.hr !== null) {
        hrSum += ext.hr;
        hrCount++;
      }
      if (ext.cad !== null && ext.cad > 0) {
        cadSum += ext.cad;
        cadCount++;
      }

      if (points.length > 0) {
        const prev = points[points.length - 1];
        const segDist = haversineM(prev.lat, prev.lon, lat, lon);
        cumDist += segDist;

        if (Number.isFinite(timeMs) && Number.isFinite(prev.timeMs)) {
          const dt = (timeMs - prev.timeMs) / 1000;
          if (dt > 0 && dt <= 60) {
            const speedMs = segDist / dt;
            if (speedMs >= 0.8) {
              movingTimeS += dt;
            }
          }
        }
      }

      points.push({
        node,
        lat,
        lon,
        ele: Number.isFinite(ele) ? ele : null,
        timeMs: Number.isFinite(timeMs) ? timeMs : null,
        cumDist
      });
    }

    if (points.length < 2) {
      throw new Error("Keine gültigen Koordinaten in der GPX-Datei gefunden.");
    }

    const timedPoints = points.filter((p) => p.timeMs !== null);
    let startedAt = new Date().toISOString();
    let elapsedTimeS = 0;

    if (timedPoints.length >= 2) {
      startedAt = new Date(timedPoints[0].timeMs).toISOString();
      elapsedTimeS = Math.max(
        0,
        Math.round((timedPoints[timedPoints.length - 1].timeMs - timedPoints[0].timeMs) / 1000)
      );
    } else {
      const metaTime = xmlDoc.querySelector("metadata > time");
      if (metaTime && Number.isFinite(Date.parse(metaTime.textContent.trim()))) {
        startedAt = new Date(Date.parse(metaTime.textContent.trim())).toISOString();
      }
    }

    // Fallback, falls z. B. eine statische Indoor-Aufzeichnung keine GPS-Bewegung hat
    if (movingTimeS === 0 && elapsedTimeS > 0) {
      movingTimeS = elapsedTimeS;
    }
    movingTimeS = Math.round(movingTimeS);

    const distanceM = Math.round(cumDist * 10) / 10;
    const elevationGainM = computeElevationGain(points);

    let avgSpeedKmh = null;
    if (movingTimeS > 0 && distanceM > 0) {
      const spd = (distanceM / 1000) / (movingTimeS / 3600);
      if (spd > 0 && spd <= 150) {
        avgSpeedKmh = Math.round(spd * 100) / 100;
      }
    }

    // Privatsphäre-Schnitt: Start & Ziel um 400 m für Karte und gespeicherte GPX kürzen
    // (inkl. Entfernen von <bounds> und <wpt>, damit keine Start-/Heimkoordinaten im XML bleiben)
    let visiblePoints = points;
    let privacyTrimmed = false;

    if (options.privacyTrim && cumDist > PRIVACY_TRIM_M * 3) {
      const trimmed = [];
      const toRemove = [];
      for (const p of points) {
        if (p.cumDist >= PRIVACY_TRIM_M && p.cumDist <= cumDist - PRIVACY_TRIM_M) {
          trimmed.push(p);
        } else {
          toRemove.push(p);
        }
      }
      if (trimmed.length >= 2) {
        for (const p of toRemove) {
          if (p.node && p.node.parentNode) {
            p.node.parentNode.removeChild(p.node);
          }
        }
        removeXmlNodesByTag(xmlDoc, "bounds");
        removeXmlNodesByTag(xmlDoc, "wpt");
        visiblePoints = trimmed;
        privacyTrimmed = true;
      }
    }

    // Vereinfachte Spur für den schnellen Aktivitäten-Feed (max. 250 Punkte)
    const trackPreview = downsample(visiblePoints, 250).map((p) => [
      Math.round(p.lat * 1e5) / 1e5,
      Math.round(p.lon * 1e5) / 1e5
    ]);

    // Vereinfachtes Höhenprofil (max. 120 Punkte)
    const baseDist = visiblePoints[0].cumDist;
    const elePts = visiblePoints.filter((p) => p.ele !== null);
    const elevationProfile =
      elePts.length >= 2
        ? downsample(elePts, 120).map((p) => [
            Math.round(((p.cumDist - baseDist) / 1000) * 100) / 100,
            Math.round(p.ele * 10) / 10
          ])
        : [];

    // GPX-Text für den privaten Storage-Upload (bei aktivem Privacy-Schnitt gekürzt)
    const serializedGpx = privacyTrimmed
      ? new XMLSerializer().serializeToString(xmlDoc)
      : xmlText;

    return {
      title: defaultTitle.slice(0, 120),
      started_at: startedAt,
      distance_m: distanceM,
      elevation_gain_m: elevationGainM,
      moving_time_s: movingTimeS,
      elapsed_time_s: elapsedTimeS,
      avg_speed_kmh: avgSpeedKmh,
      avg_power_w: powerCount > 0 ? Math.round(powerSum / powerCount) : null,
      avg_hr_bpm: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
      avg_cadence_rpm: cadCount > 0 ? Math.round(cadSum / cadCount) : null,
      track_preview: trackPreview,
      elevation_profile: elevationProfile,
      privacy_trimmed: privacyTrimmed,
      gpx_blob: new Blob([serializedGpx], { type: "application/gpx+xml" })
    };
  }

  return { parseGPX };
})();
