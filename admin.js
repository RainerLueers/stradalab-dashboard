(() => {
  const adminTabBtn = document.getElementById("nav-tab-admin");

  const pendingCard = document.getElementById("admin-pending-card");
  const pendingCountBadge = document.getElementById("admin-pending-count");
  const pendingMsg = document.getElementById("admin-pending-msg");
  const pendingContainer = document.getElementById("admin-pending-list");

  const createForm = document.getElementById("admin-create-form");
  const createName = document.getElementById("admin-create-name");
  const createEmail = document.getElementById("admin-create-email");
  const createPassword = document.getElementById("admin-create-password");
  const genCreatePwBtn = document.getElementById("admin-gen-pw-btn");
  const createSubmitBtn = document.getElementById("admin-create-btn");
  const createMsg = document.getElementById("admin-create-msg");

  const refreshBtn = document.getElementById("admin-refresh-btn");
  const userCountBadge = document.getElementById("admin-user-count");
  const listMsg = document.getElementById("admin-list-msg");
  const usersContainer = document.getElementById("admin-users-list");

  // Modal: Passwort zurücksetzen
  const pwModal = document.getElementById("admin-pw-modal");
  const closePwModalBtn = document.getElementById("close-admin-pw-btn");
  const pwForm = document.getElementById("admin-pw-form");
  const pwUserId = document.getElementById("admin-pw-user-id");
  const pwUserLabel = document.getElementById("admin-pw-user-label");
  const pwInput = document.getElementById("admin-pw-input");
  const pwGenBtn = document.getElementById("admin-pw-gen-btn");
  const pwSaveBtn = document.getElementById("admin-pw-save-btn");
  const pwMsg = document.getElementById("admin-pw-msg");

  if (!createForm || !usersContainer) return;

  function showMsg(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden", "msg-error", "msg-success");
    if (type === "error") el.classList.add("msg-error");
    if (type === "success") el.classList.add("msg-success");
  }

  function clearMsg(el) {
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function getInitials(name) {
    const clean = (name || "?").trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function formatDateShort(iso) {
    if (!iso) return "Noch nie";
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  // Gut lesbares 12-stelliges Startpasswort (ohne verwechselbare Zeichen 0/O/1/l/I)
  function generatePassword(length = 12) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#-_";
    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += chars[arr[i] % chars.length];
    }
    return out;
  }

  function updateAdminTabBadge(pendingCount) {
    if (!adminTabBtn) return;
    adminTabBtn.textContent =
      pendingCount > 0 ? `Admin (${pendingCount})` : "Admin";
  }

  // Aufruf der Supabase Edge Function `admin-users`
  async function callAdmin(action, payload = {}) {
    const app = window.StradaApp;
    const cfg = window.STRADALAB_CONFIG || {};
    if (!app?.sb || !cfg.supabaseUrl) {
      throw new Error("Supabase ist nicht initialisiert.");
    }

    const { data: sessionData, error: sessErr } = await app.sb.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (sessErr || !accessToken) {
      throw new Error("Sitzung abgelaufen. Bitte neu anmelden.");
    }

    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/admin-users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ action, ...payload })
    });

    let body = {};
    try {
      body = await res.json();
    } catch (_e) {
      body = {};
    }

    if (!res.ok) {
      throw new Error(body.error || `Serverfehler (${res.status})`);
    }
    return body;
  }

  // Mitgliederliste & offene Beitrittsanfragen laden
  async function loadUsers() {
    const app = window.StradaApp;
    if (!app?.profile?.is_admin) return;

    clearMsg(listMsg);
    refreshBtn.disabled = true;
    usersContainer.textContent = "";

    const loadingP = document.createElement("p");
    loadingP.className = "muted";
    loadingP.textContent = "Lade Mitgliederliste…";
    usersContainer.appendChild(loadingP);

    try {
      const { users = [] } = await callAdmin("list");
      const pendingUsers = users.filter((u) => u.is_approved === false);
      const approvedUsers = users.filter((u) => u.is_approved !== false);

      updateAdminTabBadge(pendingUsers.length);
      renderPendingRequests(pendingUsers);
      renderUsers(approvedUsers);
    } catch (err) {
      usersContainer.textContent = "";
      showMsg(listMsg, `Fehler beim Laden: ${err.message}`, "error");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function renderPendingRequests(pendingUsers) {
    if (!pendingCard || !pendingContainer) return;
    pendingContainer.textContent = "";

    if (pendingUsers.length === 0) {
      pendingCard.classList.add("hidden");
      clearMsg(pendingMsg);
      return;
    }

    pendingCard.classList.remove("hidden");
    if (pendingCountBadge) {
      pendingCountBadge.textContent =
        pendingUsers.length === 1
          ? "1 offene Anfrage"
          : `${pendingUsers.length} offene Anfragen`;
    }

    pendingUsers.forEach((u) => {
      const row = document.createElement("div");
      row.className = "admin-user-row";

      const left = document.createElement("div");
      left.className = "admin-user-info";

      const av = document.createElement("span");
      av.className = "avatar";
      av.textContent = getInitials(u.display_name);
      av.style.backgroundColor = u.avatar_color || "#6b7280";

      const details = document.createElement("div");
      details.className = "admin-user-details";

      const nameLine = document.createElement("div");
      nameLine.className = "admin-user-name-line";

      const nameEl = document.createElement("strong");
      nameEl.textContent = u.display_name;
      nameLine.appendChild(nameEl);

      const newBadge = document.createElement("span");
      newBadge.className = "badge badge-admin";
      newBadge.textContent = "Anfrage";
      nameLine.appendChild(newBadge);

      const emailEl = document.createElement("div");
      emailEl.className = "admin-user-email";
      emailEl.textContent = u.email;

      const metaEl = document.createElement("div");
      metaEl.className = "admin-user-meta";
      metaEl.textContent = `Angefragt am ${formatDateShort(u.created_at)}`;

      details.appendChild(nameLine);
      details.appendChild(emailEl);
      details.appendChild(metaEl);

      if (u.join_note && u.join_note.trim()) {
        const noteEl = document.createElement("div");
        noteEl.style.marginTop = "6px";
        noteEl.style.padding = "6px 10px";
        noteEl.style.background = "#f3f4f6";
        noteEl.style.borderRadius = "6px";
        noteEl.style.fontSize = "13px";
        noteEl.style.color = "#374151";
        noteEl.textContent = `„${u.join_note.trim()}“`;
        details.appendChild(noteEl);
      }

      left.appendChild(av);
      left.appendChild(details);

      const actions = document.createElement("div");
      actions.className = "admin-user-actions";

      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "btn btn-primary btn-sm";
      approveBtn.textContent = "Freigeben";
      approveBtn.addEventListener("click", () => approveUser(u, approveBtn, rejectBtn));

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "btn btn-danger-ghost btn-sm";
      rejectBtn.textContent = "Ablehnen";
      rejectBtn.addEventListener("click", () => rejectUser(u, approveBtn, rejectBtn));

      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);

      row.appendChild(left);
      row.appendChild(actions);
      pendingContainer.appendChild(row);
    });
  }

  async function approveUser(user, approveBtn, rejectBtn) {
    clearMsg(pendingMsg);
    clearMsg(listMsg);
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    approveBtn.textContent = "Schalte frei…";

    try {
      const res = await callAdmin("approve", { user_id: user.id });
      await loadUsers();
      if (typeof window.StradaApp?.reloadMembers === "function") {
        await window.StradaApp.reloadMembers();
      }
      const mailNote = res.email_sent
        ? " Willkommens-E-Mail wurde verschickt."
        : " (Hinweis: Willkommens-E-Mail konnte nicht versendet werden.)";
      showMsg(
        listMsg,
        `${user.display_name} (${user.email}) wurde freigeschaltet.${mailNote}`,
        "success"
      );
    } catch (err) {
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
      approveBtn.textContent = "Freigeben";
      showMsg(pendingMsg, `Freigabe fehlgeschlagen: ${err.message}`, "error");
    }
  }

  async function rejectUser(user, approveBtn, rejectBtn) {
    const confirmed = window.confirm(
      `Beitrittsanfrage von „${user.display_name}“ (${user.email}) wirklich ablehnen und entfernen?`
    );
    if (!confirmed) return;

    clearMsg(pendingMsg);
    clearMsg(listMsg);
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    rejectBtn.textContent = "Entferne…";

    try {
      await callAdmin("reject", { user_id: user.id });
      await loadUsers();
      showMsg(
        listMsg,
        `Beitrittsanfrage von ${user.display_name} wurde abgelehnt und entfernt.`,
        "success"
      );
    } catch (err) {
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
      rejectBtn.textContent = "Ablehnen";
      showMsg(pendingMsg, `Ablehnen fehlgeschlagen: ${err.message}`, "error");
    }
  }

  function renderUsers(users) {
    const app = window.StradaApp;
    usersContainer.textContent = "";
    userCountBadge.textContent = `${users.length} ${users.length === 1 ? "Mitglied" : "Mitglieder"}`;

    if (users.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Keine Mitglieder vorhanden.";
      usersContainer.appendChild(p);
      return;
    }

    users.forEach((u) => {
      const isSelf = u.id === app.user?.id;

      const row = document.createElement("div");
      row.className = "admin-user-row";

      // Links: Avatar + Name + E-Mail + Metadaten
      const left = document.createElement("div");
      left.className = "admin-user-info";

      const av = document.createElement("span");
      av.className = "avatar";
      av.textContent = getInitials(u.display_name);
      av.style.backgroundColor = u.avatar_color || "#6b7280";

      const details = document.createElement("div");
      details.className = "admin-user-details";

      const nameLine = document.createElement("div");
      nameLine.className = "admin-user-name-line";

      const nameEl = document.createElement("strong");
      nameEl.textContent = u.display_name;
      nameLine.appendChild(nameEl);

      if (u.is_admin) {
        const badge = document.createElement("span");
        badge.className = "badge badge-admin";
        badge.textContent = "Admin";
        nameLine.appendChild(badge);
      }

      if (isSelf) {
        const selfBadge = document.createElement("span");
        selfBadge.className = "badge badge-private";
        selfBadge.textContent = "Du";
        nameLine.appendChild(selfBadge);
      }

      const emailEl = document.createElement("div");
      emailEl.className = "admin-user-email";
      emailEl.textContent = u.email;

      const metaEl = document.createElement("div");
      metaEl.className = "admin-user-meta";
      const tourLabel = u.tour_count === 1 ? "1 Tour" : `${u.tour_count} Touren`;
      metaEl.textContent = `${tourLabel} · Letzter Login: ${formatDateShort(u.last_sign_in_at)}`;

      details.appendChild(nameLine);
      details.appendChild(emailEl);
      details.appendChild(metaEl);

      left.appendChild(av);
      left.appendChild(details);

      // Rechts: Aktionen
      const actions = document.createElement("div");
      actions.className = "admin-user-actions";

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn-ghost btn-sm";
      resetBtn.textContent = "Passwort setzen";
      resetBtn.addEventListener("click", () => openPwModal(u));
      actions.appendChild(resetBtn);

      if (!isSelf) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-danger-ghost btn-sm";
        delBtn.textContent = "Löschen";
        delBtn.addEventListener("click", () => deleteUser(u, delBtn));
        actions.appendChild(delBtn);
      }

      row.appendChild(left);
      row.appendChild(actions);
      usersContainer.appendChild(row);
    });
  }

  // Mitglied anlegen
  genCreatePwBtn.addEventListener("click", () => {
    createPassword.value = generatePassword(12);
    createPassword.focus();
    createPassword.select();
  });

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg(createMsg);

    const displayName = createName.value.trim();
    const email = createEmail.value.trim();
    const password = createPassword.value;

    if (password.length < 8) {
      showMsg(createMsg, "Das Startpasswort muss mindestens 8 Zeichen lang sein.", "error");
      return;
    }

    createSubmitBtn.disabled = true;
    createSubmitBtn.textContent = "Lege an…";

    try {
      await callAdmin("create", {
        email,
        password,
        display_name: displayName
      });

      createForm.reset();
      showMsg(
        createMsg,
        `Mitglied angelegt: ${email} | Startpasswort: ${password}`,
        "success"
      );

      await loadUsers();
      if (typeof window.StradaApp?.reloadMembers === "function") {
        await window.StradaApp.reloadMembers();
      }
    } catch (err) {
      showMsg(createMsg, `Anlegen fehlgeschlagen: ${err.message}`, "error");
    } finally {
      createSubmitBtn.disabled = false;
      createSubmitBtn.textContent = "Mitglied anlegen";
    }
  });

  // Mitglied löschen
  async function deleteUser(user, btn) {
    const confirmed = window.confirm(
      `Möchtest du das Mitglied „${user.display_name}“ (${user.email}) wirklich dauerhaft löschen?\n\nAlle Touren, GPX-Dateien, Kudos und Kommentare dieses Mitglieds werden dabei ebenfalls entfernt.`
    );
    if (!confirmed) return;

    clearMsg(listMsg);
    btn.disabled = true;

    try {
      await callAdmin("delete", { user_id: user.id });
      showMsg(listMsg, `${user.display_name} wurde gelöscht.`, "success");
      await loadUsers();
      if (typeof window.StradaApp?.reloadMembers === "function") {
        await window.StradaApp.reloadMembers();
      }
    } catch (err) {
      btn.disabled = false;
      showMsg(listMsg, `Löschen fehlgeschlagen: ${err.message}`, "error");
    }
  }

  // Passwort-Reset-Modal
  function openPwModal(user) {
    clearMsg(pwMsg);
    pwUserId.value = user.id;
    pwUserLabel.textContent = `${user.display_name} (${user.email})`;
    pwInput.value = generatePassword(12);
    pwModal.classList.remove("hidden");
    pwInput.focus();
    pwInput.select();
  }

  function closePwModal() {
    pwModal.classList.add("hidden");
    pwForm.reset();
    clearMsg(pwMsg);
  }

  closePwModalBtn.addEventListener("click", closePwModal);
  pwModal.addEventListener("click", (e) => {
    if (e.target === pwModal) closePwModal();
  });

  pwGenBtn.addEventListener("click", () => {
    pwInput.value = generatePassword(12);
    pwInput.focus();
    pwInput.select();
  });

  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg(pwMsg);

    const password = pwInput.value;
    if (password.length < 8) {
      showMsg(pwMsg, "Das Passwort muss mindestens 8 Zeichen lang sein.", "error");
      return;
    }

    pwSaveBtn.disabled = true;
    pwSaveBtn.textContent = "Speichere…";

    try {
      const label = pwUserLabel.textContent;
      await callAdmin("reset_password", {
        user_id: pwUserId.value,
        password
      });
      closePwModal();
      showMsg(
        listMsg,
        `Neues Passwort für ${label} gesetzt: ${password}`,
        "success"
      );
    } catch (err) {
      showMsg(pwMsg, `Fehler: ${err.message}`, "error");
    } finally {
      pwSaveBtn.disabled = false;
      pwSaveBtn.textContent = "Passwort speichern";
    }
  });

  // Events
  refreshBtn.addEventListener("click", loadUsers);

  if (adminTabBtn) {
    adminTabBtn.addEventListener("click", loadUsers);
  }

  window.addEventListener("strada:ready", () => {
    if (window.StradaApp?.profile?.is_admin) {
      loadUsers();
    }
  });

  window.addEventListener("strada:logout", () => {
    usersContainer.textContent = "";
    userCountBadge.textContent = "";
    if (pendingContainer) pendingContainer.textContent = "";
    if (pendingCard) pendingCard.classList.add("hidden");
    updateAdminTabBadge(0);
    createForm.reset();
    clearMsg(createMsg);
    clearMsg(listMsg);
    clearMsg(pendingMsg);
    closePwModal();
  });
})();
