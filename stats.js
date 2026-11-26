(() => {
  const MONTH_NAMES = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"
  ];
  const MONTH_SHORT = [
    "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"
  ];

  // DOM-Referenzen
  const navTabStats = document.getElementById("nav-tab-stats");
  const statsPanel = document.getElementById("tab-stats");
  const modeMonthBtn = document.getElementById("stats-mode-month");
  const modeYearBtn = document.getElementById("stats-mode-year");
  const yearSelect = document.getElementById("stats-year");
  const monthSelect = document.getElementById("stats-month");
  const sportSelect = document.getElementById("stats-sport");
  const chartMetricSelect = document.getElementById("stats-chart-metric");
  const statsStatus = document.getElementById("stats-status");
  const periodLabel = document.getElementById("stats-period-label");

  const kpiDistance = document.getElementById("kpi-distance");
  const kpiElevation = document.getElementById("kpi-elevation");
  const kpiRides = document.getElementById("kpi-rides");
  const kpiTime = document.getElementById("kpi-time");

  const chartTitle = document.getElementById("stats-chart-title");
  const chartCanvas = document.getElementById("stats-monthly-chart");
  const activeCountEl = document.getElementById("stats-active-count");
  const tableBody = document.getElementById("stats-table-body");
  const sortButtons = document.querySelectorAll(".stats-sort-btn");

  if (!statsPanel || !tableBody) return;

  const now = new Date();
  let mode = "month"; // "month" | "year"
  let selectedYear = now.getFullYear();
  let selectedMonth = now.getMonth(); // 0..11
  let sortKey = "distance_m";
  let sortDir = "desc";
  let yearTours = [];
  let loadedYear = null;
  let monthlyChart = null;
  let yearsInitialized = false;
  let statsLoadSeq = 0;

  // Formatierungshelfer
  function getMember(userId) {
    const members = window.StradaApp?.members || [];
    return (
      members.find((m) => m.id === userId) || {
        id: userId,
        display_name: "Mitglied",
        avatar_color: "#6b7280"
      }
    );
  }

  function getInitials(name) {
    const clean = (name || "?").trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function formatKm(meters) {
    const km = Number(meters || 0) / 1000;
    return `${km.toLocaleString("de-DE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })} km`;
  }

  function formatHm(meters) {
    return `${Math.round(Number(meters || 0)).toLocaleString("de-DE")} m`;
  }

  function formatHours(seconds) {
    const s = Math.max(0, Math.round(Number(seconds || 0)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h.toLocaleString("de-DE")}:${String(m).padStart(2, "0")} h`;
  }

  function destroyChart() {
    if (monthlyChart) {
      try {
        monthlyChart.destroy();
      } catch (_e) {
        // ignorieren
      }
      monthlyChart = null;
    }
  }

  // Monats- und Jahres-Dropdowns befüllen
  function populateMonths() {
    monthSelect.textContent = "";
    MONTH_NAMES.forEach((name, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = name;
      monthSelect.appendChild(opt);
    });
    monthSelect.value = String(selectedMonth);
  }

  async function initYearOptions() {
    const app = window.StradaApp;
    const currentYear = new Date().getFullYear();
    let minYear = currentYear - 2;

    if (app?.sb) {
      const { data } = await app.sb
        .from("tours")
        .select("started_at")
        .order("started_at", { ascending: true })
        .limit(1);

      if (!window.StradaApp?.user) return;

      if (data && data.length > 0 && data[0].started_at) {
        const earliest = new Date(data[0].started_at).getFullYear();
        if (Number.isFinite(earliest) && earliest >= 2000 && earliest < minYear) {
          minYear = earliest;
        }
      }
    }

    yearSelect.textContent = "";
    for (let y = currentYear; y >= minYear; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearSelect.appendChild(opt);
    }

    if (selectedYear < minYear || selectedYear > currentYear) {
      selectedYear = currentYear;
    }
    yearSelect.value = String(selectedYear);
    yearsInitialized = true;
  }

  function updateModeUI() {
    modeMonthBtn.classList.toggle("active", mode === "month");
    modeYearBtn.classList.toggle("active", mode === "year");
    monthSelect.classList.toggle("hidden", mode !== "month");
  }

  function updateSortIndicators() {
    sortButtons.forEach((btn) => {
      const active = btn.dataset.sort === sortKey;
      btn.classList.toggle("active", active);
      const arrow = btn.querySelector(".sort-arrow");
      if (arrow) {
        arrow.textContent = active ? (sortDir === "desc" ? "↓" : "↑") : "";
      }
    });
  }

  // Alle sichtbaren Touren des gewählten Jahres schlank (ohne Track-JSON) laden
  async function loadYearTours(year) {
    const app = window.StradaApp;
    if (!app?.sb || !app.user) return;

    const mySeq = ++statsLoadSeq;
    statsStatus.textContent = `Lade Statistik für ${year}…`;
    statsStatus.classList.remove("hidden");

    // 1 Tag Puffer an den Jahresgrenzen, exakte Zuordnung danach in lokaler Zeitzone
    const rangeStart = `${year - 1}-12-31T00:00:00.000Z`;
    const rangeEnd = `${year + 1}-01-02T00:00:00.000Z`;

    const allRows = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error } = await app.sb
        .from("tours")
        .select("user_id, started_at, distance_m, elevation_gain_m, moving_time_s, sport_type")
        .gte("started_at", rangeStart)
        .lt("started_at", rangeEnd)
        .order("started_at", { ascending: true })
        .range(from, from + pageSize - 1);

      if (mySeq !== statsLoadSeq) return;

      if (error) {
        statsStatus.textContent = `Fehler beim Laden der Statistik: ${error.message}`;
        return;
      }

      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    if (mySeq !== statsLoadSeq) return;

    yearTours = allRows.filter((t) => {
      const d = new Date(t.started_at);
      return Number.isFinite(d.getTime()) && d.getFullYear() === year;
    });
    loadedYear = year;

    statsStatus.classList.add("hidden");
    renderStats();
  }

  function getSportFilteredYearTours() {
    const sport = sportSelect.value;
    if (!sport) return yearTours;
    return yearTours.filter((t) => t.sport_type === sport);
  }

  function renderStats() {
    const app = window.StradaApp;
    if (!app?.user) return;

    const sportTours = getSportFilteredYearTours();
    const periodTours =
      mode === "month"
        ? sportTours.filter((t) => new Date(t.started_at).getMonth() === selectedMonth)
        : sportTours;

    periodLabel.textContent =
      mode === "month"
        ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}`
        : `Gesamtes Jahr ${selectedYear}`;

    // 1. Club-Gesamtwerte berechnen
    let totalDist = 0;
    let totalHm = 0;
    let totalTime = 0;

    const byMember = new Map();

    for (const t of periodTours) {
      const dist = Number(t.distance_m || 0);
      const hm = Number(t.elevation_gain_m || 0);
      const time = Number(t.moving_time_s || 0);

      totalDist += dist;
      totalHm += hm;
      totalTime += time;

      let entry = byMember.get(t.user_id);
      if (!entry) {
        const m = getMember(t.user_id);
        entry = {
          user_id: t.user_id,
          display_name: m.display_name,
          avatar_color: m.avatar_color,
          rides: 0,
          distance_m: 0,
          elevation_gain_m: 0,
          moving_time_s: 0
        };
        byMember.set(t.user_id, entry);
      }

      entry.rides += 1;
      entry.distance_m += dist;
      entry.elevation_gain_m += hm;
      entry.moving_time_s += time;
    }

    kpiDistance.textContent = formatKm(totalDist);
    kpiElevation.textContent = formatHm(totalHm);
    kpiRides.textContent = periodTours.length.toLocaleString("de-DE");
    kpiTime.textContent = formatHours(totalTime);

    // 2. Mitgliederliste sortieren und rendern
    const rows = Array.from(byMember.values());
    rows.sort((a, b) => {
      const diff = (a[sortKey] || 0) - (b[sortKey] || 0);
      if (diff !== 0) return sortDir === "desc" ? -diff : diff;
      return a.display_name.localeCompare(b.display_name, "de");
    });

    activeCountEl.textContent =
      rows.length === 1
        ? "1 aktives Mitglied"
        : `${rows.length} aktive Mitglieder`;

    tableBody.textContent = "";

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "stats-empty-cell";
      td.textContent = "Keine sichtbaren Aktivitäten in diesem Zeitraum.";
      tr.appendChild(td);
      tableBody.appendChild(tr);
    } else {
      const maxVal = Math.max(1, ...rows.map((r) => Number(r[sortKey] || 0)));

      rows.forEach((row, index) => {
        const isSelf = row.user_id === app.user.id;
        const tr = document.createElement("tr");
        if (isSelf) tr.className = "stats-row-self";

        // Platz
        const tdRank = document.createElement("td");
        tdRank.className = "stats-col-rank";
        tdRank.textContent = String(index + 1);
        tr.appendChild(tdRank);

        // Mitglied
        const tdMember = document.createElement("td");
        const memberWrap = document.createElement("div");
        memberWrap.className = "stats-member-cell";

        const av = document.createElement("span");
        av.className = "avatar avatar-sm";
        av.textContent = getInitials(row.display_name);
        av.style.backgroundColor = row.avatar_color;

        const nameWrap = document.createElement("div");
        nameWrap.className = "stats-member-name-wrap";

        const nameLine = document.createElement("div");
        nameLine.className = "stats-member-name";
        nameLine.textContent = row.display_name;

        const barTrack = document.createElement("div");
        barTrack.className = "stats-bar-track";
        const barFill = document.createElement("div");
        barFill.className = "stats-bar-fill";
        const pct = Math.max(4, Math.round((Number(row[sortKey] || 0) / maxVal) * 100));
        barFill.style.width = `${pct}%`;
        barTrack.appendChild(barFill);

        nameWrap.appendChild(nameLine);
        nameWrap.appendChild(barTrack);
        memberWrap.appendChild(av);
        memberWrap.appendChild(nameWrap);
        tdMember.appendChild(memberWrap);
        tr.appendChild(tdMember);

        // Fahrten
        const tdRides = document.createElement("td");
        tdRides.className = "stats-col-num";
        tdRides.textContent = String(row.rides);
        tr.appendChild(tdRides);

        // Distanz
        const tdDist = document.createElement("td");
        tdDist.className = "stats-col-num stats-col-strong";
        tdDist.textContent = formatKm(row.distance_m);
        tr.appendChild(tdDist);

        // Höhenmeter
        const tdHm = document.createElement("td");
        tdHm.className = "stats-col-num";
        tdHm.textContent = formatHm(row.elevation_gain_m);
        tr.appendChild(tdHm);

        // Bewegungszeit
        const tdTime = document.createElement("td");
        tdTime.className = "stats-col-num";
        tdTime.textContent = formatHours(row.moving_time_s);
        tr.appendChild(tdTime);

        tableBody.appendChild(tr);
      });
    }

    // 3. Monatsverlauf für das gewählte Jahr zeichnen (erst wenn Tab sichtbar)
    if (!statsPanel.classList.contains("hidden")) {
      requestAnimationFrame(() => renderMonthlyChart(sportTours));
    }
  }

  function renderMonthlyChart(sportTours) {
    if (typeof window.Chart !== "function" || !chartCanvas) return;

    const metric = chartMetricSelect.value; // "distance" | "elevation" | "rides"
    const monthly = new Array(12).fill(0);

    for (const t of sportTours) {
      const m = new Date(t.started_at).getMonth();
      if (m < 0 || m > 11) continue;
      if (metric === "distance") monthly[m] += Number(t.distance_m || 0) / 1000;
      else if (metric === "elevation") monthly[m] += Number(t.elevation_gain_m || 0);
      else monthly[m] += 1;
    }

    const rounded = monthly.map((v) =>
      metric === "distance" ? Math.round(v * 10) / 10 : Math.round(v)
    );

    const metricTitles = {
      distance: `Monatsverlauf ${selectedYear} – Distanz (km)`,
      elevation: `Monatsverlauf ${selectedYear} – Höhenmeter (m)`,
      rides: `Monatsverlauf ${selectedYear} – Fahrten`
    };
    chartTitle.textContent = metricTitles[metric] || `Monatsverlauf ${selectedYear}`;

    const barColors = MONTH_SHORT.map((_, idx) => {
      if (mode === "month") {
        return idx === selectedMonth ? "#fc4c02" : "rgba(252, 76, 2, 0.25)";
      }
      return "rgba(252, 76, 2, 0.82)";
    });

    destroyChart();

    monthlyChart = new window.Chart(chartCanvas, {
      type: "bar",
      data: {
        labels: MONTH_SHORT,
        datasets: [
          {
            data: rounded,
            backgroundColor: barColors,
            borderRadius: 5,
            maxBarThickness: 38
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event, elements) => {
          if (elements && elements.length > 0) {
            selectedMonth = elements[0].index;
            mode = "month";
            monthSelect.value = String(selectedMonth);
            updateModeUI();
            renderStats();
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => `${MONTH_NAMES[items[0].dataIndex]} ${selectedYear}`,
              label: (item) => {
                const val = Number(item.parsed.y || 0);
                if (metric === "distance") {
                  return `${val.toLocaleString("de-DE", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1
                  })} km`;
                }
                if (metric === "elevation") {
                  return `${Math.round(val).toLocaleString("de-DE")} m`;
                }
                return `${Math.round(val)} ${Math.round(val) === 1 ? "Fahrt" : "Fahrten"}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#6b7280", font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: "#eef2f6" },
            ticks: {
              maxTicksLimit: 5,
              color: "#6b7280",
              font: { size: 11 },
              precision: metric === "rides" ? 0 : undefined,
              callback: (v) => {
                if (metric === "distance") return `${v} km`;
                if (metric === "elevation") return `${v} m`;
                return String(v);
              }
            }
          }
        }
      }
    });
  }

  // Events
  modeMonthBtn.addEventListener("click", () => {
    mode = "month";
    updateModeUI();
    renderStats();
  });

  modeYearBtn.addEventListener("click", () => {
    mode = "year";
    updateModeUI();
    renderStats();
  });

  yearSelect.addEventListener("change", () => {
    selectedYear = Number(yearSelect.value);
    loadYearTours(selectedYear);
  });

  monthSelect.addEventListener("change", () => {
    selectedMonth = Number(monthSelect.value);
    renderStats();
  });

  sportSelect.addEventListener("change", renderStats);
  chartMetricSelect.addEventListener("change", renderStats);

  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === "desc" ? "asc" : "desc";
      } else {
        sortKey = key;
        sortDir = "desc";
      }
      updateSortIndicators();
      renderStats();
    });
  });

  if (navTabStats) {
    navTabStats.addEventListener("click", async () => {
      if (!yearsInitialized) {
        await initYearOptions();
      }
      await loadYearTours(selectedYear);
    });
  }

  window.addEventListener("strada:ready", async () => {
    populateMonths();
    updateModeUI();
    updateSortIndicators();
    await initYearOptions();
  });

  window.addEventListener("strada:profile-updated", () => {
    if (loadedYear === selectedYear && !statsPanel.classList.contains("hidden")) {
      renderStats();
    }
  });

  window.addEventListener("strada:logout", () => {
    statsLoadSeq++;
    destroyChart();
    yearTours = [];
    loadedYear = null;
    yearsInitialized = false;
    tableBody.textContent = "";
    statsStatus.classList.add("hidden");
  });
})();
