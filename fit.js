
window.StradaFIT = (() => {
  const EARTH_RADIUS_M = 6371000;
  const PRIVACY_TRIM_M = 400;
  const FIT_EPOCH_UNIX_S = 631065600; // 1989-12-31T00:00:00Z
  const SEMICIRCLE_TO_DEG = 180 / 2147483648; // 180 / 2^31

  const SPORT_LABELS_DE = {
    ride: "Rennrad",
    gravel: "Gravel",
    mtb: "MTB",
    indoor: "Indoor",
    run: "Laufen",
    other: "Tour"
  };

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

  function escapeXml(str) {
    return String(str || "")
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;")
      .replace(/'/g, "&" + "apos;");
  }

  function fitTsToMs(fitSec) {
    // FIT-Werte < 0x10000000 sind laut Spezifikation relative Laufzeiten, keine UTC-Zeitstempel
    if (!Number.isFinite(fitSec) || fitSec < 0x10000000) return null;
    return (fitSec + FIT_EPOCH_UNIX_S) * 1000;
  }

  function readFieldValue(view, bytes, offset, size, baseType, littleEndian) {
    const baseNum = baseType & 0x1f;

    if (baseNum === 7) {
      // Null-terminierter UTF-8-String
      let end = offset;
      const limit = offset + size;
      while (end < limit && bytes[end] !== 0) end++;
      if (end === offset) return null;
      try {
        return new TextDecoder("utf-8").decode(bytes.subarray(offset, end)).trim() || null;
      } catch (_e) {
        return null;
      }
    }

    switch (baseNum) {
      case 0: // enum
      case 2: // uint8
        if (size !== 1) return null;
        {
          const v = view.getUint8(offset);
          return v === 0xff ? null : v;
        }
      case 1: // sint8
        if (size !== 1) return null;
        {
          const v = view.getInt8(offset);
          return v === 0x7f ? null : v;
        }
      case 3: // sint16
        if (size !== 2) return null;
        {
          const v = view.getInt16(offset, littleEndian);
          return v === 0x7fff ? null : v;
        }
      case 4: // uint16
        if (size !== 2) return null;
        {
          const v = view.getUint16(offset, littleEndian);
          return v === 0xffff ? null : v;
        }
      case 5: // sint32
        if (size !== 4) return null;
        {
          const v = view.getInt32(offset, littleEndian);
          return v === 0x7fffffff ? null : v;
        }
      case 6: // uint32
        if (size !== 4) return null;
        {
          const v = view.getUint32(offset, littleEndian);
          return v === 0xffffffff ? null : v;
        }
      case 8: // float32
        if (size !== 4) return null;
        {
          if (view.getUint32(offset, littleEndian) === 0xffffffff) return null;
          const v = view.getFloat32(offset, littleEndian);
          return Number.isFinite(v) ? v : null;
        }
      case 9: // float64
        if (size !== 8) return null;
        {
          const v = view.getFloat64(offset, littleEndian);
          return Number.isFinite(v) ? v : null;
        }
      case 10: // uint8z
        if (size !== 1) return null;
        {
          const v = view.getUint8(offset);
          return v === 0 ? null : v;
        }
      case 11: // uint16z
        if (size !== 2) return null;
        {
          const v = view.getUint16(offset, littleEndian);
          return v === 0 ? null : v;
        }
      case 12: // uint32z
        if (size !== 4) return null;
        {
          const v = view.getUint32(offset, littleEndian);
          return v === 0 ? null : v;
        }
      default:
        return null;
    }
  }

  // Binären FIT-Stream (inkl. verketteter Blöcke, komprimierter Zeitstempel & Dev-Felder) dekodieren
  function decodeFitBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    if (bytes.length < 14) {
      throw new Error("Die Datei ist zu kurz für eine gültige FIT-Datei.");
    }

    const records = [];
    const sessions = [];
    let fileCreatedTs = null;
    let sportMsg = null;
    let validBlocks = 0;

    let offset = 0;
    while (offset + 12 <= bytes.length) {
      const headerSize = bytes[offset];
      if (headerSize < 12 || offset + headerSize > bytes.length) break;

      // Signatur ".FIT" prüfen
      if (
        bytes[offset + 8] !== 0x2e ||
        bytes[offset + 9] !== 0x46 ||
        bytes[offset + 10] !== 0x49 ||
        bytes[offset + 11] !== 0x54
      ) {
        if (validBlocks === 0) {
          throw new Error("Die Datei ist keine gültige FIT-Datei (Signatur .FIT fehlt).");
        }
        break;
      }

      const dataSize = view.getUint32(offset + 4, true);
      const dataStart = offset + headerSize;
      const dataEnd = Math.min(dataStart + dataSize, bytes.length);
      validBlocks++;

      const localDefs = new Array(16).fill(null);
      let pos = dataStart;
      let lastTimestamp = null;

      while (pos < dataEnd) {
        const recHeader = bytes[pos++];

        if ((recHeader & 0x80) === 0 && (recHeader & 0x40) !== 0) {
          // Definition Message
          const hasDevFields = (recHeader & 0x20) !== 0;
          const localType = recHeader & 0x0f;
          if (pos + 5 > dataEnd) break;

          pos++; // reserved
          const arch = bytes[pos++];
          const littleEndian = arch === 0;
          const globalMsgNum = view.getUint16(pos, littleEndian);
          pos += 2;
          const numFields = bytes[pos++];

          if (pos + numFields * 3 > dataEnd) break;
          const fields = [];
          for (let i = 0; i < numFields; i++) {
            fields.push({
              num: bytes[pos],
              size: bytes[pos + 1],
              baseType: bytes[pos + 2]
            });
            pos += 3;
          }

          let devBytes = 0;
          if (hasDevFields && pos < dataEnd) {
            const numDevFields = bytes[pos++];
            if (pos + numDevFields * 3 > dataEnd) break;
            for (let i = 0; i < numDevFields; i++) {
              devBytes += bytes[pos + 1];
              pos += 3;
            }
          }

          localDefs[localType] = {
            globalMsgNum,
            littleEndian,
            fields,
            devBytes
          };
        } else {
          // Data Message (normal oder mit komprimiertem Zeitstempel)
          const isCompressedTs = (recHeader & 0x80) !== 0;
          const localType = isCompressedTs ? (recHeader >> 5) & 0x03 : recHeader & 0x0f;
          const def = localDefs[localType];
          if (!def) break;

          let totalMsgBytes = def.devBytes;
          for (let i = 0; i < def.fields.length; i++) {
            totalMsgBytes += def.fields[i].size;
          }
          if (pos + totalMsgBytes > dataEnd) break;

          const wantMsg =
            def.globalMsgNum === 20 || // record
            def.globalMsgNum === 18 || // session
            def.globalMsgNum === 12 || // sport
            def.globalMsgNum === 0; // file_id

          if (!wantMsg) {
            pos += totalMsgBytes;
            continue;
          }

          const obj = {};
          for (let i = 0; i < def.fields.length; i++) {
            const f = def.fields[i];
            const val = readFieldValue(view, bytes, pos, f.size, f.baseType, def.littleEndian);
            if (val !== null) {
              obj[f.num] = val;
            }
            pos += f.size;
          }
          pos += def.devBytes;

          if (isCompressedTs && lastTimestamp !== null) {
            const timeOffset = recHeader & 0x1f;
            const prevLow = lastTimestamp & 0x1f;
            let ts = ((lastTimestamp & 0xffffffe0) >>> 0) + timeOffset;
            if (timeOffset < prevLow) ts += 32;
            lastTimestamp = ts;
            obj[253] = ts;
          } else if (typeof obj[253] === "number") {
            lastTimestamp = obj[253];
          }

          if (def.globalMsgNum === 20) {
            records.push(obj);
          } else if (def.globalMsgNum === 18) {
            sessions.push(obj);
          } else if (def.globalMsgNum === 12) {
            sportMsg = obj;
          } else if (def.globalMsgNum === 0 && typeof obj[4] === "number") {
            fileCreatedTs = obj[4];
          }
        }
      }

      // 2-Byte-Datei-CRC überspringen, falls weiterer FIT-Block folgt
      offset = dataEnd + 2;
    }

    if (validBlocks === 0) {
      throw new Error("Die Datei konnte nicht als FIT-Datei gelesen werden.");
    }

    return { records, sessions, sportMsg, fileCreatedTs };
  }

  function mapFitSport(sportEnum, subSportEnum, hasGps) {
    // Sub-Sport Indoor / Virtuell hat Vorrang (z. B. Zwift, Rouvy, SPINNR, Tacx)
    if (subSportEnum === 6 || subSportEnum === 58) {
      return "indoor";
    }

    if (sportEnum === 2) {
      // Cycling
      if (subSportEnum === 8) return "mtb";
      if (subSportEnum === 46 || subSportEnum === 11) return "gravel";
      return hasGps ? "ride" : "indoor";
    }

    if (sportEnum === 1) {
      // Running
      if (subSportEnum === 1 && !hasGps) return "indoor";
      return "run";
    }

    if (!hasGps && (sportEnum === 0 || sportEnum === 5 || sportEnum === undefined || sportEnum === null)) {
      return "indoor";
    }

    return "other";
  }

  function computeElevationGain(points) {
    const eles = points.map((p) => p.ele).filter((e) => Number.isFinite(e));
    if (eles.length < 3) return 0;

    const smoothed = eles.map((e, i) => {
      if (i === 0 || i === eles.length - 1) return e;
      return (eles[i - 1] + e + eles[i + 1]) / 3;
    });

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

  function buildDefaultTitle(fileName, sportKey, startedAtIso) {
    const base = (fileName || "").replace(/\.fit$/i, "").trim();
    // Typische kryptische Geräte-Dateinamen (reine Ziffern / Datumsstempel / Garmin-IDs) lesbar benennen
    const looksGeneric =
      !base ||
      /^[\d_-]+$/.test(base) ||
      /^[0-9a-z]{8,12}$/i.test(base) ||
      /^activity_\d+$/i.test(base);

    if (!looksGeneric) {
      return base.slice(0, 120);
    }

    const label = SPORT_LABELS_DE[sportKey] || "Tour";
    const d = new Date(startedAtIso);
    const dateDe = Number.isFinite(d.getTime())
      ? d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "";
    return dateDe ? `${label} am ${dateDe}` : label;
  }

  function buildGpxXml(title, startedAtIso, points) {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="StradaLab Club" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
      "  <metadata>",
      `    <name>${escapeXml(title)}</name>`,
      `    <time>${escapeXml(startedAtIso)}</time>`,
      "  </metadata>"
    ];

    if (points.length > 0) {
      lines.push("  <trk>");
      lines.push(`    <name>${escapeXml(title)}</name>`);
      lines.push("    <trkseg>");

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        lines.push(`      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`);
        if (p.ele !== null) {
          lines.push(`        <ele>${p.ele.toFixed(1)}</ele>`);
        }
        if (p.timeMs !== null) {
          lines.push(`        <time>${new Date(p.timeMs).toISOString()}</time>`);
        }

        const hasExt =
          p.power !== null || p.hr !== null || p.cad !== null || p.temp !== null;
        if (hasExt) {
          lines.push("        <extensions>");
          if (p.power !== null) {
            lines.push(`          <power>${Math.round(p.power)}</power>`);
          }
          if (p.hr !== null || p.cad !== null || p.temp !== null) {
            lines.push("          <gpxtpx:TrackPointExtension>");
            if (p.temp !== null) {
              lines.push(`            <gpxtpx:atemp>${p.temp}</gpxtpx:atemp>`);
            }
            if (p.hr !== null) {
              lines.push(`            <gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`);
            }
            if (p.cad !== null) {
              lines.push(`            <gpxtpx:cad>${Math.round(p.cad)}</gpxtpx:cad>`);
            }
            lines.push("          </gpxtpx:TrackPointExtension>");
          }
          lines.push("        </extensions>");
        }

        lines.push("      </trkpt>");
      }

      lines.push("    </trkseg>");
      lines.push("  </trk>");
    }

    lines.push("</gpx>");
    return lines.join("\n");
  }

  function parseFIT(arrayBuffer, fileName, options = {}) {
    const { records, sessions, sportMsg, fileCreatedTs } = decodeFitBuffer(arrayBuffer);

    if (records.length === 0 && sessions.length === 0) {
      throw new Error("Die FIT-Datei enthält keine Aktivitätsdaten (keine Records oder Session).");
    }

    const gpsPoints = [];
    const allTimedMs = [];
    let cumHaversineM = 0;
    let maxRecordDistM = 0;
    let movingTimeFromRecords = 0;
    let prevRecTimeMs = null;

    let powerSum = 0;
    let powerCount = 0;
    let hrSum = 0;
    let hrCount = 0;
    let cadSum = 0;
    let cadCount = 0;

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const timeMs = typeof r[253] === "number" ? fitTsToMs(r[253]) : null;
      if (timeMs !== null) {
        allTimedMs.push(timeMs);
      }

      // Höhe: enhanced_altitude (78) bevorzugen, Fallback altitude (2)
      let ele = null;
      if (typeof r[78] === "number") {
        ele = r[78] / 5 - 500;
      } else if (typeof r[2] === "number") {
        ele = r[2] / 5 - 500;
      }
      if (ele !== null && (ele < -500 || ele > 9000)) ele = null;

      // Geschwindigkeit: enhanced_speed (73) oder speed (6) in m/s
      let speedMs = null;
      if (typeof r[73] === "number") {
        speedMs = r[73] / 1000;
      } else if (typeof r[6] === "number") {
        speedMs = r[6] / 1000;
      }

      const recDistM = typeof r[5] === "number" ? r[5] / 100 : null;
      if (recDistM !== null && recDistM > maxRecordDistM) {
        maxRecordDistM = recDistM;
      }

      const power =
        typeof r[7] === "number" && r[7] >= 0 && r[7] <= 2500 ? r[7] : null;
      const hr =
        typeof r[3] === "number" && r[3] >= 30 && r[3] <= 240 ? r[3] : null;
      const cad =
        typeof r[4] === "number" && r[4] >= 0 && r[4] <= 250 ? r[4] : null;
      const temp =
        typeof r[13] === "number" && r[13] >= -50 && r[13] <= 70 ? r[13] : null;

      if (power !== null) {
        powerSum += power;
        powerCount++;
      }
      if (hr !== null) {
        hrSum += hr;
        hrCount++;
      }
      if (cad !== null && cad > 0) {
        cadSum += cad;
        cadCount++;
      }

      if (timeMs !== null && prevRecTimeMs !== null) {
        const dt = (timeMs - prevRecTimeMs) / 1000;
        if (dt > 0 && dt <= 60) {
          if (speedMs === null || speedMs >= 0.8 || (power !== null && power > 5)) {
            movingTimeFromRecords += dt;
          }
        }
      }
      if (timeMs !== null) prevRecTimeMs = timeMs;

      // GPS-Koordinaten (0, 0 ausschließen, da manche Indoor-Geräte 0 als Platzhalter schreiben)
      if (typeof r[0] === "number" && typeof r[1] === "number") {
        const lat = r[0] * SEMICIRCLE_TO_DEG;
        const lon = r[1] * SEMICIRCLE_TO_DEG;
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          (Math.abs(lat) > 0.0001 || Math.abs(lon) > 0.0001)
        ) {
          if (gpsPoints.length > 0) {
            const prev = gpsPoints[gpsPoints.length - 1];
            cumHaversineM += haversineM(prev.lat, prev.lon, lat, lon);
          }

          gpsPoints.push({
            lat,
            lon,
            ele,
            timeMs,
            power,
            hr,
            cad,
            temp,
            cumDist: recDistM !== null ? recDistM : cumHaversineM
          });
        }
      }
    }

    // Session-Summen zusammenfassen (unterstützt auch Multi-Session-Dateien)
    let sessionStartMs = null;
    let sessionDistM = 0;
    let sessionTimerS = 0;
    let sessionElapsedS = 0;
    let sessionAscentM = 0;
    let sessionHasAscent = false;
    let sessionSport = sportMsg?.[0] ?? null;
    let sessionSubSport = sportMsg?.[1] ?? null;
    let sessionPowerW = null;
    let sessionHrBpm = null;
    let sessionCadRpm = null;
    let sessionAvgSpeedMs = null;

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      if (sessionStartMs === null && typeof s[2] === "number") {
        sessionStartMs = fitTsToMs(s[2]);
      }
      if (typeof s[5] === "number" && sessionSport === null) sessionSport = s[5];
      if (typeof s[6] === "number" && sessionSubSport === null) sessionSubSport = s[6];
      if (typeof s[9] === "number") sessionDistM += s[9] / 100;
      if (typeof s[8] === "number") sessionTimerS += s[8] / 1000;
      if (typeof s[7] === "number") sessionElapsedS += s[7] / 1000;
      if (typeof s[22] === "number") {
        sessionAscentM += s[22];
        sessionHasAscent = true;
      }
      if (sessions.length === 1) {
        if (typeof s[20] === "number" && s[20] > 0 && s[20] <= 2500) sessionPowerW = s[20];
        if (typeof s[16] === "number" && s[16] >= 30 && s[16] <= 240) sessionHrBpm = s[16];
        if (typeof s[18] === "number" && s[18] > 0 && s[18] <= 250) sessionCadRpm = s[18];
        if (typeof s[124] === "number") sessionAvgSpeedMs = s[124] / 1000;
        else if (typeof s[14] === "number") sessionAvgSpeedMs = s[14] / 1000;
      }
    }

    // Startzeit bestimmen
    let startMs = sessionStartMs;
    if (startMs === null && allTimedMs.length > 0) startMs = allTimedMs[0];
    if (startMs === null && fileCreatedTs !== null) startMs = fitTsToMs(fileCreatedTs);
    const startedAt = new Date(startMs !== null ? startMs : Date.now()).toISOString();

    const hasGps = gpsPoints.length >= 2;
    const detectedSport = mapFitSport(sessionSport, sessionSubSport, hasGps);

    // Distanz, Zeit, Höhenmeter & Schnitt
    const distanceM = Math.round(
      (sessionDistM > 0 ? sessionDistM : maxRecordDistM > 0 ? maxRecordDistM : cumHaversineM) * 10
    ) / 10;

    let elapsedTimeS = Math.round(sessionElapsedS);
    if (elapsedTimeS <= 0 && allTimedMs.length >= 2) {
      elapsedTimeS = Math.max(
        0,
        Math.round((allTimedMs[allTimedMs.length - 1] - allTimedMs[0]) / 1000)
      );
    }

    let movingTimeS = Math.round(sessionTimerS);
    if (movingTimeS <= 0) {
      movingTimeS = Math.round(movingTimeFromRecords > 0 ? movingTimeFromRecords : elapsedTimeS);
    }
    if (elapsedTimeS <= 0) elapsedTimeS = movingTimeS;

    let elevationGainM = 0;
    if (sessionHasAscent && sessionAscentM > 0) {
      elevationGainM = Math.round(sessionAscentM * 10) / 10;
    } else if (hasGps) {
      elevationGainM = computeElevationGain(gpsPoints);
    }

    let avgSpeedKmh = null;
    if (movingTimeS > 0 && distanceM > 0) {
      const spd = (distanceM / 1000) / (movingTimeS / 3600);
      if (spd > 0 && spd <= 150) avgSpeedKmh = Math.round(spd * 100) / 100;
    } else if (sessionAvgSpeedMs && sessionAvgSpeedMs > 0) {
      const spd = sessionAvgSpeedMs * 3.6;
      if (spd <= 150) avgSpeedKmh = Math.round(spd * 100) / 100;
    }

    const avgPowerW =
      sessionPowerW !== null
        ? Math.round(sessionPowerW)
        : powerCount > 0
          ? Math.round(powerSum / powerCount)
          : null;
    const avgHrBpm =
      sessionHrBpm !== null
        ? Math.round(sessionHrBpm)
        : hrCount > 0
          ? Math.round(hrSum / hrCount)
          : null;
    const avgCadenceRpm =
      sessionCadRpm !== null
        ? Math.round(sessionCadRpm)
        : cadCount > 0
          ? Math.round(cadSum / cadCount)
          : null;

    // Privatsphäre-Schnitt (400 m an Start & Ziel) für Karte und erzeugte GPX
    let visiblePoints = gpsPoints;
    let privacyTrimmed = false;

    if (hasGps && options.privacyTrim) {
      const firstD = gpsPoints[0].cumDist;
      const lastD = gpsPoints[gpsPoints.length - 1].cumDist;
      const totalSpan = lastD - firstD;
      if (totalSpan > PRIVACY_TRIM_M * 3) {
        const trimmed = gpsPoints.filter(
          (p) => p.cumDist >= firstD + PRIVACY_TRIM_M && p.cumDist <= lastD - PRIVACY_TRIM_M
        );
        if (trimmed.length >= 2) {
          visiblePoints = trimmed;
          privacyTrimmed = true;
        }
      }
    }

    const trackPreview = hasGps
      ? downsample(visiblePoints, 250).map((p) => [
          Math.round(p.lat * 1e5) / 1e5,
          Math.round(p.lon * 1e5) / 1e5
        ])
      : [];

    let elevationProfile = [];
    if (hasGps) {
      const baseDist = visiblePoints[0].cumDist;
      const elePts = visiblePoints.filter((p) => p.ele !== null);
      if (elePts.length >= 2) {
        elevationProfile = downsample(elePts, 120).map((p) => [
          Math.round(((p.cumDist - baseDist) / 1000) * 100) / 100,
          Math.round(p.ele * 10) / 10
        ]);
      }
    }

    const defaultTitle = buildDefaultTitle(fileName, detectedSport, startedAt);
    const gpxXml = buildGpxXml(defaultTitle, startedAt, visiblePoints);

    return {
      title: defaultTitle,
      started_at: startedAt,
      distance_m: distanceM,
      elevation_gain_m: elevationGainM,
      moving_time_s: movingTimeS,
      elapsed_time_s: elapsedTimeS,
      avg_speed_kmh: avgSpeedKmh,
      avg_power_w: avgPowerW,
      avg_hr_bpm: avgHrBpm,
      avg_cadence_rpm: avgCadenceRpm,
      track_preview: trackPreview,
      elevation_profile: elevationProfile,
      privacy_trimmed: privacyTrimmed,
      detected_sport: detectedSport,
      has_gps: hasGps,
      gpx_blob: new Blob([gpxXml], { type: "application/gpx+xml" })
    };
  }

  return { parseFIT };
})();
