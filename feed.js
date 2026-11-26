(() => {
  const COMMENT_MAX_LEN = 280;

  const SPORT_LABELS = {
    ride: "Rennrad",
    gravel: "Gravel",
    mtb: "MTB",
    indoor: "Indoor",
    run: "Laufen",
    other: "Sonstiges"
  };

  const VISIBILITY_LABELS = {
    club: "Club",
    friends: "Freunde",
    private: "Privat"
  };

  // DOM-Referenzen
  const openUploadBtn = document.getElementById("open-upload-btn");
  const filterScope = document.getElementById("filter-scope");
  const filterMember = document.getElementById("filter-member");
  const feedList = document.getElementById("feed-list");
  const feedStatus = document.getElementById("feed-status");

  // Upload-Modal
  const uploadModal = document.getElementById("upload-modal");
  const closeUploadBtn = document.getElementById("close-upload-btn");
  const uploadForm = document.getElementById("upload-form");
  const dropzone = document.getElementById("gpx-dropzone");
  const fileInput = document.getElementById("gpx-file-input");
  const fileNameLabel = document.getElementById("gpx-file-name");
  const previewBox = document.getElementById("gpx-preview-stats");
  const uploadTitle = document.getElementById("upload-title");
  const uploadSport = document.getElementById("upload-sport");
  const uploadVisibility = document.getElementById("upload-visibility");
  const uploadDesc = document.getElementById("upload-desc");
  const uploadPrivacy = document.getElementById("upload-privacy");
  const uploadWeather = document.getElementById("upload-weather");
  const uploadSubmitBtn = document.getElementById("upload-submit-btn");
  const uploadMsg = document.getElementById("upload-msg");

  // Bearbeiten-Modal
  const editModal = document.getElementById("edit-modal");
  const closeEditBtn = document.getElementById("close-edit-btn");
  const editForm = document.getElementById("edit-form");
  const editId = document.getElementById("edit-tour-id");
  const editTitle = document.getElementById("edit-title");
  const editSport = document.getElementById("edit-sport");
  const editVisibility = document.getElementById("edit-visibility");
  const editDesc = document.getElementById("edit-desc");
  const editSaveBtn = document.getElementById("edit-save-btn");
  const editMsg = document.getElementById("edit-msg");

  let allTours = [];
  let activeMaps = [];
  let activeCharts = [];
  let selectedFileType = null; // "gpx" | "fit"
  let selectedRawData = null; // string (GPX) | ArrayBuffer (FIT)
  let selectedFileName = "";
  let parsedTour = null;
  let duplicateTour = null;
  let dupCheckSeq = 0;

  // Hilfsfunktionen & Formatierung
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
    return `${(Number(meters || 0) / 1000).toFixed(1).replace(".", ",")} km`;
  }

  function formatHm(meters) {
    return `${Math.round(Number(meters || 0))} m`;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds || 0)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")} h`;
    return `${m}:${String(sec).padStart(2, "0")} min`;
  }

  function formatSpeed(kmh) {
    if (kmh === null || kmh === undefined) return "–";
    return `${Number(kmh).toFixed(1).replace(".", ",")} km/h`;
  }

  function formatPace(distanceM, movingTimeS, avgSpeedKmh) {
    let secPerKm = null;
    const distKm = Number(distanceM || 0) / 1000;
    const timeS = Number(movingTimeS || 0);

    if (distKm > 0 && timeS > 0) {
      secPerKm = timeS / distKm;
    } else if (avgSpeedKmh && Number(avgSpeedKmh) > 0) {
      secPerKm = 3600 / Number(avgSpeedKmh);
    }

    if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) {
      return "–";
    }

    const totalSec = Math.round(secPerKm);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")} min/km`;
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function showMsg(el, text, type) {
    el.textContent = text;
    el.classList.remove("hidden", "msg-error", "msg-success");
    if (type === "error") el.classList.add("msg-error");
    if (type === "success") el.classList.add("msg-success");
  }

  function clearMsg(el) {
    el.textContent = "";
    el.classList.add("hidden");
  }

  function createSvgIcon(pathD) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  function destroyVisuals() {
    activeMaps.forEach((m) => {
      try {
        m.remove();
      } catch (_e) {
        // ignorieren
      }
    });
    activeMaps = [];

    activeCharts.forEach((c) => {
      try {
        c.destroy();
      } catch (_e) {
        // ignorieren
      }
    });
    activeCharts = [];
  }

  // Duplettenprüfung gegen eigene Touren in Supabase (erkennt auch GPX + FIT derselben Fahrt)
  async function findDuplicateTour(tourData) {
    const app = window.StradaApp;
    if (!app?.sb || !app.user || !tourData?.started_at) return null;

    const startMs = Date.parse(tourData.started_at);
    if (!Number.isFinite(startMs)) return null;

    const minIso = new Date(startMs - 5 * 60 * 1000).toISOString();
    const maxIso = new Date(startMs + 5 * 60 * 1000).toISOString();

    const { data, error } = await app.sb
      .from("tours")
      .select("id, title, started_at, distance_m, moving_time_s")
      .eq("user_id", app.user.id)
      .gte("started_at", minIso)
      .lte("started_at", maxIso);

    if (error || !Array.isArray(data) || data.length === 0) return null;

    const newDist = Number(tourData.distance_m || 0);
    const newTime = Number(tourData.moving_time_s || 0);

    return (
      data.find((existing) => {
        const oldDist = Number(existing.distance_m || 0);
        const oldTime = Number(existing.moving_time_s || 0);

        const distTol = Math.max(1000, Math.max(newDist, oldDist) * 0.1);
        const timeTol = Math.max(300, Math.max(newTime, oldTime) * 0.1);

        const distMatch = Math.abs(newDist - oldDist) <= distTol;
        const timeMatch = Math.abs(newTime - oldTime) <= timeTol;
        return distMatch || timeMatch;
      }) || null
    );
  }

  // Mitglieder-Dropdown aktualisieren
  function populateMemberFilter() {
    const app = window.StradaApp;
    if (!app) return;
    const prev = filterMember.value;
    filterMember.textContent = "";

    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "Alle Mitglieder";
    filterMember.appendChild(allOpt);

    app.members.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.display_name;
      filterMember.appendChild(opt);
    });

    if ([...filterMember.options].some((o) => o.value === prev)) {
      filterMember.value = prev;
    }
  }

  // Touren inkl. Kudos, Kommentaren und Wetter laden
  async function loadTours() {
    const app = window.StradaApp;
    if (!app || !app.user) return;

    feedStatus.textContent = "Lade Touren…";
    feedStatus.classList.remove("hidden");

    const { data, error } = await app.sb
      .from("tours")
      .select(
        "*, author:profiles!tours_user_id_fkey(id, display_name, avatar_color), kudos(user_id, created_at), comments(id, user_id, body, created_at)"
      )
      .order("started_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      feedStatus.textContent = `Fehler beim Laden der Touren: ${error.message}`;
      return;
    }

    allTours = (data || []).map((t) => ({
      ...t,
      kudos: Array.isArray(t.kudos) ? t.kudos : [],
      comments: (Array.isArray(t.comments) ? t.comments : []).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      )
    }));

    feedStatus.classList.add("hidden");
    renderFeed();
  }

  function getFilteredTours() {
    const app = window.StradaApp;
    const scope = filterScope.value;
    const memberId = filterMember.value;

    return allTours.filter((t) => {
      if (scope === "mine" && t.user_id !== app.user.id) return false;
      if (memberId && t.user_id !== memberId) return false;
      return true;
    });
  }

  function createStatItem(label, value) {
    const box = document.createElement("div");
    box.className = "stat-item";

    const lbl = document.createElement("span");
    lbl.className = "stat-label";
    lbl.textContent = label;

    const val = document.createElement("span");
    val.className = "stat-value";
    val.textContent = value;

    box.appendChild(lbl);
    box.appendChild(val);
    return box;
  }

  // ==========================================================================
  // TOUR-KARTE MIT WETTER, KARTE, HÖHENPROFIL, KUDOS & KOMMENTAREN
  // ==========================================================================
  function renderTourCard(tour) {
    const app = window.StradaApp;
    const isOwner = tour.user_id === app.user.id;
    const isRun = tour.sport_type === "run";
    const authorName = tour.author?.display_name || getMember(tour.user_id).display_name;
    const authorColor = tour.author?.avatar_color || getMember(tour.user_id).avatar_color;

    const card = document.createElement("article");
    card.className = "card tour-card";

    // 1. Kopfzeile
    const header = document.createElement("div");
    header.className = "tour-header";

    const authorWrap = document.createElement("div");
    authorWrap.className = "tour-author";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = getInitials(authorName);
    avatar.style.backgroundColor = authorColor;

    const meta = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "tour-author-name";
    nameEl.textContent = authorName;

    const subEl = document.createElement("div");
    subEl.className = "tour-meta";
    subEl.textContent = `${formatDate(tour.started_at)} · ${SPORT_LABELS[tour.sport_type] || tour.sport_type}`;

    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    authorWrap.appendChild(avatar);
    authorWrap.appendChild(meta);

    const headerRight = document.createElement("div");
    headerRight.className = "tour-header-actions";

    const visBadge = document.createElement("span");
    visBadge.className = `badge badge-${tour.visibility}`;
    visBadge.textContent = VISIBILITY_LABELS[tour.visibility] || tour.visibility;
    headerRight.appendChild(visBadge);

    if (isOwner) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-ghost btn-sm";
      editBtn.textContent = "Bearbeiten";
      editBtn.addEventListener("click", () => openEditModal(tour));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger-ghost btn-sm";
      delBtn.textContent = "Löschen";
      delBtn.addEventListener("click", () => deleteTour(tour, delBtn));

      headerRight.appendChild(editBtn);
      headerRight.appendChild(delBtn);
    }

    header.appendChild(authorWrap);
    header.appendChild(headerRight);
    card.appendChild(header);

    // 2. Titel & Beschreibung
    const titleEl = document.createElement("h3");
    titleEl.className = "tour-title";
    titleEl.textContent = tour.title;
    card.appendChild(titleEl);

    if (tour.description && tour.description.trim()) {
      const descEl = document.createElement("p");
      descEl.className = "tour-desc";
      descEl.textContent = tour.description;
      card.appendChild(descEl);
    }

    // 3. Kennzahlen
    const statsRow = document.createElement("div");
    statsRow.className = "stats-grid";
    statsRow.appendChild(createStatItem("Distanz", formatKm(tour.distance_m)));
    statsRow.appendChild(createStatItem("Höhenmeter", formatHm(tour.elevation_gain_m)));
    statsRow.appendChild(createStatItem("Bewegungszeit", formatDuration(tour.moving_time_s)));

    if (isRun) {
      statsRow.appendChild(
        createStatItem("Ø Pace", formatPace(tour.distance_m, tour.moving_time_s, tour.avg_speed_kmh))
      );
    } else {
      statsRow.appendChild(createStatItem("Ø Tempo", formatSpeed(tour.avg_speed_kmh)));
    }

    if (tour.avg_power_w) {
      statsRow.appendChild(createStatItem("Ø Leistung", `${tour.avg_power_w} W`));
    }
    if (tour.avg_hr_bpm) {
      statsRow.appendChild(createStatItem("Ø Puls", `${tour.avg_hr_bpm} bpm`));
    }
    if (tour.avg_cadence_rpm && !isRun) {
      statsRow.appendChild(createStatItem("Ø Trittfrequenz", `${tour.avg_cadence_rpm} rpm`));
    }
    card.appendChild(statsRow);

    // 3b. Wetter-Slot
    const weatherSlot = document.createElement("div");
    function renderWeatherSlot() {
      weatherSlot.textContent = "";
      if (tour.weather && window.StradaWeather) {
        const el = window.StradaWeather.createWeatherElement(tour.weather);
        if (el) weatherSlot.appendChild(el);
      }
    }
    renderWeatherSlot();
    card.appendChild(weatherSlot);

    // 4. Leaflet-Karte
    const coords = Array.isArray(tour.track_preview) ? tour.track_preview : [];
    let mapEl = null;
    if (coords.length >= 2) {
      mapEl = document.createElement("div");
      mapEl.className = "tour-map";
      card.appendChild(mapEl);
    }

    // 5. Höhenprofil (Chart.js)
    const eleProfile = Array.isArray(tour.elevation_profile) ? tour.elevation_profile : [];
    let eleCanvas = null;
    if (eleProfile.length >= 2) {
      const eles = eleProfile.map((p) => Number(p[1])).filter(Number.isFinite);
      const minEle = Math.round(Math.min(...eles));
      const maxEle = Math.round(Math.max(...eles));

      const eleWrap = document.createElement("div");
      eleWrap.className = "elevation-wrap";

      const eleHead = document.createElement("div");
      eleHead.className = "elevation-header";

      const eleTitle = document.createElement("span");
      eleTitle.textContent = "Höhenprofil";

      const eleRange = document.createElement("span");
      eleRange.textContent = `Min. ${minEle} m · Max. ${maxEle} m`;

      eleHead.appendChild(eleTitle);
      eleHead.appendChild(eleRange);

      const canvasBox = document.createElement("div");
      canvasBox.className = "elevation-canvas-box";
      eleCanvas = document.createElement("canvas");
      canvasBox.appendChild(eleCanvas);

      eleWrap.appendChild(eleHead);
      eleWrap.appendChild(canvasBox);
      card.appendChild(eleWrap);
    }

    // 6. Fußzeile: Kudos, Kommentare, Wetter nachladen, Privacy-Hinweis & GPX-Download
    const footer = document.createElement("div");
    footer.className = "tour-footer";

    const actionsLeft = document.createElement("div");
    actionsLeft.className = "tour-actions-left";

    const kudoBtn = document.createElement("button");
    kudoBtn.type = "button";
    kudoBtn.className = "btn-social btn-kudo";
    const kudoIcon = createSvgIcon(
      "M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
    );
    const kudoLabel = document.createElement("span");
    kudoBtn.appendChild(kudoIcon);
    kudoBtn.appendChild(kudoLabel);

    if (isOwner) {
      kudoBtn.disabled = true;
      kudoBtn.title = "Eigene Touren können nicht mit Kudos versehen werden.";
    }

    const kudosSummary = document.createElement("div");
    kudosSummary.className = "kudos-summary hidden";

    function updateKudosUI() {
      const count = tour.kudos.length;
      const gaveKudo = tour.kudos.some((k) => k.user_id === app.user.id);
      kudoBtn.classList.toggle("active", gaveKudo);
      kudoLabel.textContent = count > 0 ? `Kudos (${count})` : "Kudos";

      if (count > 0) {
        const names = tour.kudos.map((k) => getMember(k.user_id).display_name);
        const shown = names.slice(0, 4).join(", ");
        const extra = names.length > 4 ? ` und ${names.length - 4} weitere` : "";
        kudosSummary.textContent = `Kudos von ${shown}${extra}`;
        kudosSummary.classList.remove("hidden");
      } else {
        kudosSummary.textContent = "";
        kudosSummary.classList.add("hidden");
      }
    }

    if (!isOwner) {
      kudoBtn.addEventListener("click", async () => {
        kudoBtn.disabled = true;
        const alreadyGiven = tour.kudos.some((k) => k.user_id === app.user.id);

        if (alreadyGiven) {
          const { error } = await app.sb
            .from("kudos")
            .delete()
            .eq("tour_id", tour.id)
            .eq("user_id", app.user.id);

          if (!error) {
            tour.kudos = tour.kudos.filter((k) => k.user_id !== app.user.id);
          } else {
            alert(`Kudo konnte nicht entfernt werden: ${error.message}`);
          }
        } else {
          const { error } = await app.sb.from("kudos").insert({
            tour_id: tour.id,
            user_id: app.user.id
          });

          if (!error) {
            tour.kudos.push({
              user_id: app.user.id,
              created_at: new Date().toISOString()
            });
          } else {
            alert(`Kudo fehlgeschlagen: ${error.message}`);
          }
        }

        kudoBtn.disabled = false;
        updateKudosUI();
      });
    }

    updateKudosUI();

    const commentToggleBtn = document.createElement("button");
    commentToggleBtn.type = "button";
    commentToggleBtn.className = "btn-social";
    const commentIcon = createSvgIcon(
      "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
    );
    const commentBtnLabel = document.createElement("span");
    commentToggleBtn.appendChild(commentIcon);
    commentToggleBtn.appendChild(commentBtnLabel);

    actionsLeft.appendChild(kudoBtn);
    actionsLeft.appendChild(commentToggleBtn);

    const actionsRight = document.createElement("div");
    actionsRight.className = "tour-actions-right";

    if (tour.privacy_trimmed) {
      const trimNote = document.createElement("span");
      trimNote.className = "muted-inline";
      trimNote.textContent = "Start & Ziel um 400 m gekürzt";
      actionsRight.appendChild(trimNote);
    }

    if (
      isOwner &&
      !tour.weather &&
      coords.length >= 2 &&
      window.StradaWeather
    ) {
      const weatherBtn = document.createElement("button");
      weatherBtn.type = "button";
      weatherBtn.className = "btn btn-ghost btn-sm";
      weatherBtn.textContent = "Wetter laden";
      weatherBtn.addEventListener("click", async () => {
        weatherBtn.disabled = true;
        weatherBtn.textContent = "Lade Wetter…";

        const weather = await window.StradaWeather.fetchForTour({
          startedAt: tour.started_at,
          durationS: tour.elapsed_time_s || tour.moving_time_s || 0,
          coords
        });

        if (!weather) {
          weatherBtn.disabled = false;
          weatherBtn.textContent = "Wetter laden";
          alert("Für diesen Zeitpunkt/Ort konnten keine Wetterdaten abgerufen werden.");
          return;
        }

        const { error } = await app.sb
          .from("tours")
          .update({ weather })
          .eq("id", tour.id);

        if (error) {
          weatherBtn.disabled = false;
          weatherBtn.textContent = "Wetter laden";
          alert(`Wetter konnte nicht gespeichert werden: ${error.message}`);
          return;
        }

        tour.weather = weather;
        renderWeatherSlot();
        weatherBtn.remove();
      });
      actionsRight.appendChild(weatherBtn);
    }

    if (coords.length >= 2 && tour.gpx_path) {
      const downloadBtn = document.createElement("button");
      downloadBtn.type = "button";
      downloadBtn.className = "btn btn-ghost btn-sm";
      downloadBtn.textContent = "GPX herunterladen";
      downloadBtn.addEventListener("click", () => downloadGpx(tour, downloadBtn));
      actionsRight.appendChild(downloadBtn);
    }

    footer.appendChild(actionsLeft);
    footer.appendChild(actionsRight);
    card.appendChild(footer);
    card.appendChild(kudosSummary);

    // 7. Kommentarbereich
    const commentsSection = document.createElement("div");
    commentsSection.className =
      tour.comments.length > 0 ? "comments-section" : "comments-section hidden";

    const commentsListEl = document.createElement("div");
    commentsListEl.className = "comments-list";

    const commentForm = document.createElement("form");
    commentForm.className = "comment-form";

    const inputRow = document.createElement("div");
    inputRow.className = "comment-input-row";

    const commentInput = document.createElement("textarea");
    commentInput.className = "comment-input";
    commentInput.rows = 1;
    commentInput.maxLength = COMMENT_MAX_LEN;
    commentInput.placeholder = "Kurzen Kommentar schreiben (max. 280 Zeichen)…";

    const commentSubmitBtn = document.createElement("button");
    commentSubmitBtn.type = "submit";
    commentSubmitBtn.className = "btn btn-primary btn-sm";
    commentSubmitBtn.textContent = "Senden";
    commentSubmitBtn.disabled = true;

    inputRow.appendChild(commentInput);
    inputRow.appendChild(commentSubmitBtn);

    const formFooter = document.createElement("div");
    formFooter.className = "comment-form-footer";

    const commentErrEl = document.createElement("span");
    commentErrEl.className = "msg-error";

    const charCounter = document.createElement("span");
    charCounter.className = "char-counter";
    charCounter.textContent = `0 / ${COMMENT_MAX_LEN}`;

    formFooter.appendChild(commentErrEl);
    formFooter.appendChild(charCounter);

    commentForm.appendChild(inputRow);
    commentForm.appendChild(formFooter);

    commentsSection.appendChild(commentsListEl);
    commentsSection.appendChild(commentForm);
    card.appendChild(commentsSection);

    function updateCommentCount() {
      const n = tour.comments.length;
      commentBtnLabel.textContent = n > 0 ? `Kommentare (${n})` : "Kommentieren";
    }

    function renderCommentsList() {
      commentsListEl.textContent = "";
      updateCommentCount();

      tour.comments.forEach((c) => {
        const member = getMember(c.user_id);
        const canDelete = c.user_id === app.user.id || isOwner;

        const item = document.createElement("div");
        item.className = "comment-item";

        const main = document.createElement("div");
        main.className = "comment-main";

        const av = document.createElement("span");
        av.className = "avatar avatar-sm";
        av.textContent = getInitials(member.display_name);
        av.style.backgroundColor = member.avatar_color;

        const content = document.createElement("div");
        content.className = "comment-content";

        const metaRow = document.createElement("div");
        metaRow.className = "comment-meta";

        const authorSpan = document.createElement("span");
        authorSpan.className = "comment-author";
        authorSpan.textContent = member.display_name;

        const timeSpan = document.createElement("span");
        timeSpan.className = "comment-time";
        timeSpan.textContent = formatDate(c.created_at);

        metaRow.appendChild(authorSpan);
        metaRow.appendChild(timeSpan);

        const bodyP = document.createElement("p");
        bodyP.className = "comment-body";
        bodyP.textContent = c.body;

        content.appendChild(metaRow);
        content.appendChild(bodyP);

        main.appendChild(av);
        main.appendChild(content);
        item.appendChild(main);

        if (canDelete) {
          const delCommentBtn = document.createElement("button");
          delCommentBtn.type = "button";
          delCommentBtn.className = "comment-del-btn";
          delCommentBtn.title = "Kommentar löschen";
          delCommentBtn.textContent = "×";
          delCommentBtn.addEventListener("click", async () => {
            delCommentBtn.disabled = true;
            const { error } = await app.sb
              .from("comments")
              .delete()
              .eq("id", c.id);

            if (error) {
              delCommentBtn.disabled = false;
              commentErrEl.textContent = `Löschen fehlgeschlagen: ${error.message}`;
              return;
            }
            tour.comments = tour.comments.filter((x) => x.id !== c.id);
            renderCommentsList();
          });
          item.appendChild(delCommentBtn);
        }

        commentsListEl.appendChild(item);
      });
    }

    commentToggleBtn.addEventListener("click", () => {
      const wasHidden = commentsSection.classList.contains("hidden");
      commentsSection.classList.toggle("hidden");
      if (wasHidden) {
        commentInput.focus();
      }
    });

    commentInput.addEventListener("input", () => {
      const len = commentInput.value.length;
      const trimmedLen = commentInput.value.trim().length;
      charCounter.textContent = `${len} / ${COMMENT_MAX_LEN}`;
      charCounter.classList.toggle("near-limit", len >= COMMENT_MAX_LEN - 30);
      commentSubmitBtn.disabled = trimmedLen === 0 || len > COMMENT_MAX_LEN;
      commentErrEl.textContent = "";
    });

    commentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = commentInput.value.trim();
      if (!body || body.length > COMMENT_MAX_LEN) return;

      commentSubmitBtn.disabled = true;
      commentErrEl.textContent = "";

      const { data, error } = await app.sb
        .from("comments")
        .insert({
          tour_id: tour.id,
          user_id: app.user.id,
          body
        })
        .select("id, user_id, body, created_at")
        .single();

      if (error) {
        commentSubmitBtn.disabled = false;
        commentErrEl.textContent = `Fehler: ${error.message}`;
        return;
      }

      tour.comments.push(data);
      commentInput.value = "";
      charCounter.textContent = `0 / ${COMMENT_MAX_LEN}`;
      charCounter.classList.remove("near-limit");
      renderCommentsList();
    });

    renderCommentsList();

    return { card, mapEl, coords, eleCanvas, eleProfile };
  }

  function initLeafletMap(mapEl, coords) {
    const map = L.map(mapEl, {
      scrollWheelZoom: false,
      attributionControl: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap"
    }).addTo(map);

    const poly = L.polyline(coords, {
      color: "#fc4c02",
      weight: 3.5,
      opacity: 0.92
    }).addTo(map);

    L.circleMarker(coords[0], {
      radius: 5,
      color: "#ffffff",
      weight: 2,
      fillColor: "#16a34a",
      fillOpacity: 1
    }).addTo(map);

    L.circleMarker(coords[coords.length - 1], {
      radius: 5,
      color: "#ffffff",
      weight: 2,
      fillColor: "#111827",
      fillOpacity: 1
    }).addTo(map);

    requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    });

    activeMaps.push(map);
  }

  function initElevationChart(canvas, profile) {
    if (typeof window.Chart !== "function") return;

    const pts = profile
      .map((p) => ({ x: Number(p[0]), y: Number(p[1]) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (pts.length < 2) return;
    const maxDist = pts[pts.length - 1].x;
    if (maxDist <= 0) return;

    const eles = pts.map((p) => p.y);
    const minEle = Math.min(...eles);
    const maxEle = Math.max(...eles);

    const yScale = {
      grid: { color: "#eef2f6" },
      ticks: {
        maxTicksLimit: 4,
        color: "#6b7280",
        font: { size: 11 },
        callback: (v) => `${Math.round(v)} m`
      }
    };

    if (maxEle - minEle < 20) {
      const mid = (maxEle + minEle) / 2;
      yScale.min = Math.floor(mid - 10);
      yScale.max = Math.ceil(mid + 10);
    } else {
      yScale.grace = "10%";
    }

    const chart = new window.Chart(canvas, {
      type: "line",
      data: {
        datasets: [
          {
            data: pts,
            borderColor: "#fc4c02",
            borderWidth: 2,
            backgroundColor: "rgba(252, 76, 2, 0.14)",
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) =>
                `Kilometer ${Number(items[0].parsed.x).toFixed(1).replace(".", ",")} km`,
              label: (item) => `Höhe: ${Math.round(item.parsed.y)} m`
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: maxDist,
            grid: { display: false },
            ticks: {
              maxTicksLimit: 6,
              color: "#6b7280",
              font: { size: 11 },
              callback: (v) => `${Number(v).toFixed(1).replace(".", ",")} km`
            }
          },
          y: yScale
        }
      }
    });

    activeCharts.push(chart);
  }

  function renderFeed() {
    destroyVisuals();
    feedList.textContent = "";

    const tours = getFilteredTours();
    if (tours.length === 0) {
      const empty = document.createElement("div");
      empty.className = "card empty-state";

      const h = document.createElement("h2");
      h.textContent = "Noch keine Touren sichtbar";

      const p = document.createElement("p");
      p.className = "muted";
      p.textContent =
        "Lade oben rechts deine erste GPX- oder FIT-Datei hoch oder passe den Filter an.";

      empty.appendChild(h);
      empty.appendChild(p);
      feedList.appendChild(empty);
      return;
    }

    tours.forEach((tour) => {
      const { card, mapEl, coords, eleCanvas, eleProfile } = renderTourCard(tour);
      feedList.appendChild(card);
      if (mapEl && coords.length >= 2) {
        initLeafletMap(mapEl, coords);
      }
      if (eleCanvas && eleProfile.length >= 2) {
        initElevationChart(eleCanvas, eleProfile);
      }
    });
  }

  // Privater GPX-Download über zeitlich begrenzte signierte URL
  async function downloadGpx(tour, btn) {
    const app = window.StradaApp;
    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = "Erzeuge Link…";

    const datePrefix = (tour.started_at || "").slice(0, 10) || "tour";
    const safeTitle = (tour.title || "tour")
      .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "_")
      .slice(0, 50);
    const filename = `${datePrefix}_${safeTitle}.gpx`;

    const { data, error } = await app.sb.storage
      .from("gpx-files")
      .createSignedUrl(tour.gpx_path, 60, { download: filename });

    btn.disabled = false;
    btn.textContent = origLabel;

    if (error || !data?.signedUrl) {
      alert(`Download fehlgeschlagen: ${error?.message || "Kein Zugriff"}`);
      return;
    }

    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Tour löschen (nur Eigentümer – zusätzlich per RLS gesichert)
  async function deleteTour(tour, btn) {
    const confirmed = window.confirm(
      `Möchtest du die Tour „${tour.title}“ wirklich dauerhaft löschen?`
    );
    if (!confirmed) return;

    const app = window.StradaApp;
    btn.disabled = true;

    const { error } = await app.sb.from("tours").delete().eq("id", tour.id);
    if (error) {
      btn.disabled = false;
      alert(`Löschen fehlgeschlagen: ${error.message}`);
      return;
    }

    if (tour.gpx_path) {
      await app.sb.storage.from("gpx-files").remove([tour.gpx_path]);
    }

    allTours = allTours.filter((t) => t.id !== tour.id);
    renderFeed();
  }

  // ==========================================================================
  // UPLOAD-MODAL (GPX & FIT)
  // ==========================================================================
  function renderUploadPreview() {
    if (!parsedTour) return;
    const isRun = uploadSport.value === "run";

    previewBox.textContent = "";
    previewBox.appendChild(createStatItem("Distanz", formatKm(parsedTour.distance_m)));
    previewBox.appendChild(createStatItem("Höhenmeter", formatHm(parsedTour.elevation_gain_m)));
    previewBox.appendChild(createStatItem("Zeit", formatDuration(parsedTour.moving_time_s)));

    if (isRun) {
      previewBox.appendChild(
        createStatItem(
          "Ø Pace",
          formatPace(parsedTour.distance_m, parsedTour.moving_time_s, parsedTour.avg_speed_kmh)
        )
      );
    } else {
      previewBox.appendChild(createStatItem("Ø Tempo", formatSpeed(parsedTour.avg_speed_kmh)));
    }

    if (parsedTour.avg_power_w) {
      previewBox.appendChild(createStatItem("Ø Leistung", `${parsedTour.avg_power_w} W`));
    }
    if (parsedTour.avg_hr_bpm) {
      previewBox.appendChild(createStatItem("Ø Puls", `${parsedTour.avg_hr_bpm} bpm`));
    }
    if (parsedTour.avg_cadence_rpm && !isRun) {
      previewBox.appendChild(createStatItem("Ø Trittfrequenz", `${parsedTour.avg_cadence_rpm} rpm`));
    }
  }

  function resetUploadForm() {
    uploadForm.reset();
    selectedFileType = null;
    selectedRawData = null;
    selectedFileName = "";
    parsedTour = null;
    duplicateTour = null;
    dupCheckSeq++;
    fileNameLabel.textContent = "GPX- oder FIT-Datei hierher ziehen oder klicken zum Auswählen";
    previewBox.classList.add("hidden");
    previewBox.textContent = "";
    uploadSubmitBtn.disabled = true;
    uploadSubmitBtn.textContent = "Tour veröffentlichen";
    clearMsg(uploadMsg);

    const defVis = window.StradaApp?.profile?.default_visibility || "club";
    uploadVisibility.value = defVis;
    if (uploadWeather) {
      uploadWeather.checked = true;
    }
  }

  function openUploadModal() {
    resetUploadForm();
    uploadModal.classList.remove("hidden");
  }

  function closeUploadModal() {
    uploadModal.classList.add("hidden");
  }

  function parseSelectedFile(applyAutoSport = false) {
    clearMsg(uploadMsg);
    duplicateTour = null;
    if (!selectedRawData || !selectedFileType) return;

    try {
      const opts = { privacyTrim: uploadPrivacy.checked };

      if (selectedFileType === "fit") {
        if (!window.StradaFIT) {
          throw new Error("FIT-Parser (fit.js) wurde nicht geladen.");
        }
        parsedTour = window.StradaFIT.parseFIT(selectedRawData, selectedFileName, opts);
      } else {
        parsedTour = window.StradaGPX.parseGPX(selectedRawData, selectedFileName, opts);
      }

      if (!uploadTitle.value.trim()) {
        uploadTitle.value = parsedTour.title;
      }

      if (applyAutoSport && parsedTour.detected_sport) {
        uploadSport.value = parsedTour.detected_sport;
      }

      if (uploadWeather && applyAutoSport) {
        const hasTrack = Array.isArray(parsedTour.track_preview) && parsedTour.track_preview.length >= 2;
        uploadWeather.checked = hasTrack;
      }

      renderUploadPreview();
      previewBox.classList.remove("hidden");
      uploadSubmitBtn.disabled = true;
      uploadSubmitBtn.textContent = "Prüfe Dupletten…";

      if (selectedFileType === "fit" && parsedTour.has_gps === false) {
        showMsg(
          uploadMsg,
          "Hinweis: FIT-Datei ohne GPS-Strecke erkannt (Indoor-Aktivität ohne Karte/Wetter).",
          "success"
        );
      }

      // Asynchron auf Duplette prüfen – bei Treffer bleibt der Upload gesperrt
      const mySeq = ++dupCheckSeq;
      const tourSnapshot = parsedTour;
      findDuplicateTour(tourSnapshot)
        .then((match) => {
          if (mySeq !== dupCheckSeq || parsedTour !== tourSnapshot) return;
          duplicateTour = match;
          uploadSubmitBtn.textContent = "Tour veröffentlichen";
          if (match) {
            uploadSubmitBtn.disabled = true;
            showMsg(
              uploadMsg,
              `Duplette erkannt: „${match.title}“ (${formatDate(match.started_at)} · ${formatKm(match.distance_m)}) ist bereits hochgeladen. Upload gesperrt.`,
              "error"
            );
          } else {
            uploadSubmitBtn.disabled = false;
          }
        })
        .catch(() => {
          if (mySeq !== dupCheckSeq || parsedTour !== tourSnapshot) return;
          uploadSubmitBtn.textContent = "Tour veröffentlichen";
          uploadSubmitBtn.disabled = false;
        });
    } catch (err) {
      parsedTour = null;
      previewBox.classList.add("hidden");
      uploadSubmitBtn.disabled = true;
      uploadSubmitBtn.textContent = "Tour veröffentlichen";
      showMsg(uploadMsg, err.message, "error");
    }
  }

  function handleFile(file) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isGpx = lower.endsWith(".gpx");
    const isFit = lower.endsWith(".fit");

    if (!isGpx && !isFit) {
      showMsg(uploadMsg, "Bitte eine Datei mit der Endung .gpx oder .fit auswählen.", "error");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showMsg(uploadMsg, "Die Datei ist größer als das Limit von 15 MB.", "error");
      return;
    }

    selectedFileType = isFit ? "fit" : "gpx";
    selectedFileName = file.name;
    fileNameLabel.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
    uploadTitle.value = "";

    const reader = new FileReader();
    reader.onload = () => {
      selectedRawData = isFit ? reader.result : String(reader.result || "");
      parseSelectedFile(true);
    };
    reader.onerror = () => {
      showMsg(uploadMsg, "Datei konnte nicht gelesen werden.", "error");
    };

    if (isFit) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  openUploadBtn.addEventListener("click", openUploadModal);
  closeUploadBtn.addEventListener("click", closeUploadModal);
  uploadModal.addEventListener("click", (e) => {
    if (e.target === uploadModal) closeUploadModal();
  });

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    handleFile(e.dataTransfer.files[0]);
  });

  uploadPrivacy.addEventListener("change", () => {
    if (selectedRawData) parseSelectedFile(false);
  });

  uploadSport.addEventListener("change", () => {
    if (parsedTour) renderUploadPreview();
  });

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!parsedTour) return;

    const app = window.StradaApp;
    const title = uploadTitle.value.trim();
    if (!title) {
      showMsg(uploadMsg, "Bitte einen Titel eingeben.", "error");
      return;
    }

    clearMsg(uploadMsg);
    uploadSubmitBtn.disabled = true;
    uploadSubmitBtn.textContent = "Prüfe Dupletten…";

    const dup = duplicateTour || (await findDuplicateTour(parsedTour));
    if (dup) {
      duplicateTour = dup;
      showMsg(
        uploadMsg,
        `Duplette erkannt: „${dup.title}“ (${formatDate(dup.started_at)} · ${formatKm(dup.distance_m)}) ist bereits hochgeladen. Upload gesperrt.`,
        "error"
      );
      uploadSubmitBtn.disabled = true;
      uploadSubmitBtn.textContent = "Tour veröffentlichen";
      return;
    }

    let weatherData = null;
    const hasTrack =
      Array.isArray(parsedTour.track_preview) && parsedTour.track_preview.length >= 2;
    const shouldFetchWeather =
      Boolean(uploadWeather?.checked) &&
      hasTrack &&
      Boolean(window.StradaWeather);

    if (shouldFetchWeather) {
      uploadSubmitBtn.textContent = "Frage Wetter ab…";
      weatherData = await window.StradaWeather.fetchForTour({
        startedAt: parsedTour.started_at,
        durationS: parsedTour.elapsed_time_s || parsedTour.moving_time_s || 0,
        coords: parsedTour.track_preview
      });
    }

    uploadSubmitBtn.textContent = "Lade hoch…";

    const tourId = crypto.randomUUID();
    const gpxPath = `${app.user.id}/${tourId}.gpx`;

    const { error: storageErr } = await app.sb.storage
      .from("gpx-files")
      .upload(gpxPath, parsedTour.gpx_blob, {
        contentType: "application/gpx+xml",
        upsert: false
      });

    if (storageErr) {
      uploadSubmitBtn.disabled = false;
      uploadSubmitBtn.textContent = "Tour veröffentlichen";
      showMsg(uploadMsg, `Storage-Fehler: ${storageErr.message}`, "error");
      return;
    }

    const { error: dbErr } = await app.sb.from("tours").insert({
      id: tourId,
      user_id: app.user.id,
      title,
      description: uploadDesc.value.trim(),
      sport_type: uploadSport.value,
      visibility: uploadVisibility.value,
      started_at: parsedTour.started_at,
      distance_m: parsedTour.distance_m,
      elevation_gain_m: parsedTour.elevation_gain_m,
      moving_time_s: parsedTour.moving_time_s,
      elapsed_time_s: parsedTour.elapsed_time_s,
      avg_speed_kmh: parsedTour.avg_speed_kmh,
      avg_power_w: parsedTour.avg_power_w,
      avg_hr_bpm: parsedTour.avg_hr_bpm,
      avg_cadence_rpm: parsedTour.avg_cadence_rpm,
      track_preview: parsedTour.track_preview,
      elevation_profile: parsedTour.elevation_profile,
      gpx_path: gpxPath,
      privacy_trimmed: parsedTour.privacy_trimmed,
      weather: weatherData
    });

    if (dbErr) {
      await app.sb.storage.from("gpx-files").remove([gpxPath]);
      uploadSubmitBtn.disabled = false;
      uploadSubmitBtn.textContent = "Tour veröffentlichen";
      showMsg(uploadMsg, `Datenbank-Fehler: ${dbErr.message}`, "error");
      return;
    }

    uploadSubmitBtn.disabled = false;
    uploadSubmitBtn.textContent = "Tour veröffentlichen";
    closeUploadModal();
    await loadTours();
  });

  // ==========================================================================
  // BEARBEITEN-MODAL (NUR EIGENTÜMER)
  // ==========================================================================
  function openEditModal(tour) {
    clearMsg(editMsg);
    editId.value = tour.id;
    editTitle.value = tour.title;
    editSport.value = tour.sport_type;
    editVisibility.value = tour.visibility;
    editDesc.value = tour.description || "";
    editModal.classList.remove("hidden");
  }

  function closeEditModal() {
    editModal.classList.add("hidden");
  }

  closeEditBtn.addEventListener("click", closeEditModal);
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) closeEditModal();
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const app = window.StradaApp;
    const title = editTitle.value.trim();
    if (!title) {
      showMsg(editMsg, "Titel darf nicht leer sein.", "error");
      return;
    }

    editSaveBtn.disabled = true;
    clearMsg(editMsg);

    const { error } = await app.sb
      .from("tours")
      .update({
        title,
        sport_type: editSport.value,
        visibility: editVisibility.value,
        description: editDesc.value.trim()
      })
      .eq("id", editId.value);

    editSaveBtn.disabled = false;

    if (error) {
      showMsg(editMsg, `Speichern fehlgeschlagen: ${error.message}`, "error");
      return;
    }

    closeEditModal();
    await loadTours();
  });

  // Filter & Tab-Wechsel
  filterScope.addEventListener("change", renderFeed);
  filterMember.addEventListener("change", renderFeed);

  document.querySelectorAll('.nav-tab[data-tab="feed"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      setTimeout(() => activeMaps.forEach((m) => m.invalidateSize()), 50);
    });
  });

  // Events aus app.js abonnieren
  window.addEventListener("strada:ready", () => {
    populateMemberFilter();
    loadTours();
  });

  window.addEventListener("strada:profile-updated", () => {
    populateMemberFilter();
    loadTours();
  });

  window.addEventListener("strada:logout", () => {
    destroyVisuals();
    allTours = [];
    feedList.textContent = "";
    closeUploadModal();
    closeEditModal();
  });
})();
