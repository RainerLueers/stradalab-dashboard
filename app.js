(() => {
  const cfg = window.STRADALAB_CONFIG || {};

  // DOM-Referenzen
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app-view");
  const authSubtitle = document.getElementById("auth-subtitle");
  const authModeLoginBtn = document.getElementById("auth-mode-login");
  const authModeJoinBtn = document.getElementById("auth-mode-join");

  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginBtn = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");

  const joinForm = document.getElementById("join-form");
  const joinName = document.getElementById("join-name");
  const joinEmail = document.getElementById("join-email");
  const joinPassword = document.getElementById("join-password");
  const joinPasswordConfirm = document.getElementById("join-password-confirm");
  const joinNote = document.getElementById("join-note");
  const joinWebsite = document.getElementById("join-website");
  const joinBtn = document.getElementById("join-btn");
  const joinMsg = document.getElementById("join-msg");

  const navAvatar = document.getElementById("nav-avatar");
  const navUsername = document.getElementById("nav-username");
  const navTabAdmin = document.getElementById("nav-tab-admin");
  const navTabs = document.querySelectorAll(".nav-tab");
  const tabPanels = {
    feed: document.getElementById("tab-feed"),
    stats: document.getElementById("tab-stats"),
    profile: document.getElementById("tab-profile"),
    admin: document.getElementById("tab-admin")
  };

  const profileForm = document.getElementById("profile-form");
  const profileName = document.getElementById("profile-name");
  const profileVisibility = document.getElementById("profile-visibility");
  const profileColor = document.getElementById("profile-color");
  const profilePreview = document.getElementById("profile-preview");
  const profileNotifyComments = document.getElementById("profile-notify-comments");
  const profileNotifyKudos = document.getElementById("profile-notify-kudos");
  const profileSaveBtn = document.getElementById("profile-save-btn");
  const profileMsg = document.getElementById("profile-msg");

  const passwordForm = document.getElementById("password-form");
  const newPasswordInput = document.getElementById("new-password");
  const confirmPasswordInput = document.getElementById("confirm-password");
  const passwordSaveBtn = document.getElementById("password-save-btn");
  const passwordMsg = document.getElementById("password-msg");

  const friendsList = document.getElementById("friends-list");
  const friendsMsg = document.getElementById("friends-msg");

  if (cfg.clubName) {
    document.getElementById("login-club-name").textContent = cfg.clubName;
    document.getElementById("nav-club-name").textContent = cfg.clubName;
    document.title = `${cfg.clubName} – Dashboard`;
  }

  if (cfg.appVersion) {
    document.querySelectorAll(".app-version").forEach((el) => {
      el.textContent = `v${cfg.appVersion}`;
    });
  }

  // Konfigurations-Prüfung
  const keyMissing =
    !cfg.supabaseUrl ||
    !cfg.supabaseKey ||
    cfg.supabaseKey.includes("HIER_DEINEN");

  if (keyMissing) {
    loginView.classList.remove("hidden");
    showMessage(
      loginError,
      "Bitte trage zuerst deinen Supabase Publishable Key in config.js ein.",
      "error"
    );
    loginBtn.disabled = true;
    return;
  }

  // detectSessionInUrl deaktivieren, damit Garmin-OAuth-Callbacks (?code=&state=)
  // nicht fälschlich von Supabase Auth abgefangen werden.
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: {
      detectSessionInUrl: false
    }
  });

  // Gemeinsamer App-Zustand für Feed & Admin
  const state = {
    sb,
    user: null,
    profile: null,
    members: [],
    friendIds: new Set(),
    reloadMembers: null
  };
  window.StradaApp = state;

  // Hilfsfunktionen
  function getInitials(name) {
    const clean = (name || "?").trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden", "msg-error", "msg-success");
    if (type === "error") el.classList.add("msg-error");
    if (type === "success") el.classList.add("msg-success");
  }

  function clearMessage(el) {
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function updateAvatarPreview() {
    profilePreview.textContent = getInitials(profileName.value);
    profilePreview.style.backgroundColor = profileColor.value;
  }

  function switchAuthMode(mode) {
    const isJoin = mode === "join";
    if (authModeLoginBtn) authModeLoginBtn.classList.toggle("active", !isJoin);
    if (authModeJoinBtn) authModeJoinBtn.classList.toggle("active", isJoin);
    if (loginForm) loginForm.classList.toggle("hidden", isJoin);
    if (joinForm) joinForm.classList.toggle("hidden", !isJoin);
    if (authSubtitle) {
      authSubtitle.textContent = isJoin
        ? "Stelle eine Beitrittsanfrage. Nach kurzer Freigabe durch den Admin erhältst du eine E-Mail."
        : "Geschlossener Club-Bereich. Bitte mit deinen Zugangsdaten anmelden.";
    }
    clearMessage(loginError);
    clearMessage(joinMsg);
  }

  function switchTab(tabName) {
    if (tabName === "admin" && !state.profile?.is_admin) {
      tabName = "feed";
    }
    navTabs.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    Object.entries(tabPanels).forEach(([key, panel]) => {
      if (panel) {
        panel.classList.toggle("hidden", key !== tabName);
      }
    });
  }

  // Navigation & Auth-Umschalter
  if (authModeLoginBtn) {
    authModeLoginBtn.addEventListener("click", () => switchAuthMode("login"));
  }
  if (authModeJoinBtn) {
    authModeJoinBtn.addEventListener("click", () => switchAuthMode("join"));
  }

  navTabs.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  profileName.addEventListener("input", updateAvatarPreview);
  profileColor.addEventListener("input", updateAvatarPreview);

  // Login & Logout
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessage(loginError);
    loginBtn.disabled = true;
    loginBtn.textContent = "Anmeldung läuft…";

    const { error } = await sb.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });

    loginBtn.disabled = false;
    loginBtn.textContent = "Anmelden";

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("email not confirmed")) {
        showMessage(
          loginError,
          "Dein Zugang wurde noch nicht freigeschaltet. Du erhältst eine E-Mail, sobald ein Admin deine Anfrage bestätigt.",
          "error"
        );
      } else {
        showMessage(loginError, "E-Mail oder Passwort nicht korrekt.", "error");
      }
    } else {
      loginPassword.value = "";
    }
  });

  // Club-Beitrittsanfrage absenden
  if (joinForm) {
    joinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMessage(joinMsg);

      const displayName = joinName.value.trim();
      const email = joinEmail.value.trim();
      const password = joinPassword.value;
      const confirmPw = joinPasswordConfirm.value;
      const note = joinNote ? joinNote.value.trim() : "";
      const website = joinWebsite ? joinWebsite.value : "";

      if (displayName.length < 2) {
        showMessage(joinMsg, "Bitte gib einen Anzeigenamen ein.", "error");
        return;
      }

      if (password.length < 8) {
        showMessage(
          joinMsg,
          "Das Passwort muss mindestens 8 Zeichen lang sein.",
          "error"
        );
        return;
      }

      if (password !== confirmPw) {
        showMessage(
          joinMsg,
          "Die beiden Passwörter stimmen nicht überein.",
          "error"
        );
        return;
      }

      joinBtn.disabled = true;
      joinBtn.textContent = "Sende Anfrage…";

      try {
        const res = await fetch(`${cfg.supabaseUrl}/functions/v1/join-request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: cfg.supabaseKey
          },
          body: JSON.stringify({
            display_name: displayName,
            email,
            password,
            note,
            website
          })
        });

        let body = {};
        try {
          body = await res.json();
        } catch (_err) {
          body = {};
        }

        if (!res.ok) {
          throw new Error(body.error || `Serverfehler (${res.status})`);
        }

        joinForm.reset();
        showMessage(
          joinMsg,
          "Deine Beitrittsanfrage wurde übermittelt! Sobald der Admin deinen Zugang freigibt, bekommst du eine E-Mail und kannst dich anmelden.",
          "success"
        );
      } catch (err) {
        showMessage(
          joinMsg,
          err.message || "Anfrage konnte nicht gesendet werden.",
          "error"
        );
      } finally {
        joinBtn.disabled = false;
        joinBtn.textContent = "Beitritt anfragen";
      }
    });
  }

  logoutBtn.addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  // Profil speichern (inkl. Benachrichtigungs-Schalter)
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessage(profileMsg);

    const displayName = profileName.value.trim();
    if (!displayName) {
      showMessage(profileMsg, "Bitte einen Anzeigenamen eingeben.", "error");
      return;
    }

    profileSaveBtn.disabled = true;
    const { data, error } = await sb
      .from("profiles")
      .update({
        display_name: displayName,
        avatar_color: profileColor.value,
        default_visibility: profileVisibility.value,
        notify_comments: profileNotifyComments ? profileNotifyComments.checked : true,
        notify_kudos: profileNotifyKudos ? profileNotifyKudos.checked : true
      })
      .eq("id", state.user.id)
      .select()
      .single();

    profileSaveBtn.disabled = false;

    if (error) {
      showMessage(profileMsg, `Fehler beim Speichern: ${error.message}`, "error");
      return;
    }

    state.profile = data;
    const idx = state.members.findIndex((m) => m.id === data.id);
    if (idx >= 0) state.members[idx] = data;
    window.dispatchEvent(new CustomEvent("strada:profile-updated"));
    renderHeader();
    showMessage(profileMsg, "Profil gespeichert.", "success");
  });

  // Passwort ändern
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMessage(passwordMsg);

      const newPassword = newPasswordInput.value;
      const confirmPassword = confirmPasswordInput.value;

      if (newPassword.length < 8) {
        showMessage(
          passwordMsg,
          "Das Passwort muss mindestens 8 Zeichen lang sein.",
          "error"
        );
        return;
      }

      if (newPassword !== confirmPassword) {
        showMessage(
          passwordMsg,
          "Die beiden Passwörter stimmen nicht überein.",
          "error"
        );
        return;
      }

      passwordSaveBtn.disabled = true;
      passwordSaveBtn.textContent = "Speichere…";

      const { error } = await sb.auth.updateUser({ password: newPassword });

      passwordSaveBtn.disabled = false;
      passwordSaveBtn.textContent = "Passwort ändern";

      if (error) {
        const msg = error.message
          .toLowerCase()
          .includes("different from the old password")
          ? "Das neue Passwort muss sich vom bisherigen unterscheiden."
          : `Passwort konnte nicht geändert werden: ${error.message}`;
        showMessage(passwordMsg, msg, "error");
        return;
      }

      passwordForm.reset();
      showMessage(passwordMsg, "Passwort erfolgreich geändert.", "success");
    });
  }

  // Rendering
  function renderHeader() {
    if (!state.profile) return;
    navUsername.textContent = state.profile.display_name;
    navAvatar.textContent = getInitials(state.profile.display_name);
    navAvatar.style.backgroundColor = state.profile.avatar_color;
  }

  function renderProfileForm() {
    if (!state.profile) return;
    profileName.value = state.profile.display_name;
    profileVisibility.value = state.profile.default_visibility;
    profileColor.value = state.profile.avatar_color;
    if (profileNotifyComments) {
      profileNotifyComments.checked = state.profile.notify_comments !== false;
    }
    if (profileNotifyKudos) {
      profileNotifyKudos.checked = state.profile.notify_kudos !== false;
    }
    updateAvatarPreview();
  }

  function renderFriendsList() {
    friendsList.textContent = "";
    clearMessage(friendsMsg);

    const others = state.members.filter((m) => m.id !== state.user.id);
    if (others.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Noch keine weiteren Clubmitglieder vorhanden.";
      friendsList.appendChild(p);
      return;
    }

    others.forEach((member) => {
      const row = document.createElement("label");
      row.className = "friend-row";

      const info = document.createElement("div");
      info.className = "friend-info";

      const av = document.createElement("span");
      av.className = "avatar avatar-sm";
      av.textContent = getInitials(member.display_name);
      av.style.backgroundColor = member.avatar_color;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = member.display_name;

      info.appendChild(av);
      info.appendChild(nameSpan);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.friendIds.has(member.id);

      checkbox.addEventListener("change", async () => {
        clearMessage(friendsMsg);
        checkbox.disabled = true;
        const checked = checkbox.checked;

        let err = null;
        if (checked) {
          const { error } = await sb.from("friend_shares").insert({
            owner_id: state.user.id,
            friend_id: member.id
          });
          err = error;
        } else {
          const { error } = await sb
            .from("friend_shares")
            .delete()
            .eq("owner_id", state.user.id)
            .eq("friend_id", member.id);
          err = error;
        }

        checkbox.disabled = false;

        if (err) {
          checkbox.checked = !checked;
          showMessage(friendsMsg, `Änderung fehlgeschlagen: ${err.message}`, "error");
          return;
        }

        if (checked) {
          state.friendIds.add(member.id);
        } else {
          state.friendIds.delete(member.id);
        }
        showMessage(
          friendsMsg,
          checked
            ? `${member.display_name} wurde zur Freigabeliste hinzugefügt.`
            : `${member.display_name} wurde aus der Freigabeliste entfernt.`,
          "success"
        );
      });

      row.appendChild(info);
      row.appendChild(checkbox);
      friendsList.appendChild(row);
    });
  }

  // Mitgliederliste & Freigabeliste aktualisieren (nur freigegebene Mitglieder)
  async function reloadMembers() {
    if (!state.user) return;
    const [membersRes, sharesRes] = await Promise.all([
      sb.from("profiles").select("*").order("display_name", { ascending: true }),
      sb.from("friend_shares").select("friend_id").eq("owner_id", state.user.id)
    ]);

    if (membersRes.error) return;

    const allProfiles = membersRes.data || [];
    state.profile = allProfiles.find((m) => m.id === state.user.id) || state.profile;
    state.members = allProfiles.filter((m) => m.is_approved !== false);
    state.friendIds = new Set((sharesRes.data || []).map((r) => r.friend_id));

    renderFriendsList();
    window.dispatchEvent(new CustomEvent("strada:profile-updated"));
  }
  state.reloadMembers = reloadMembers;

  let activeUserId = undefined;

  function showLoadFailure(message) {
    activeUserId = undefined;
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    switchAuthMode("login");
    showMessage(loginError, message, "error");
  }

  // Daten nach Login laden
  async function loadUserData(user) {
    state.user = user;

    try {
      const [membersRes, sharesRes] = await Promise.all([
        sb.from("profiles").select("*").order("display_name", { ascending: true }),
        sb.from("friend_shares").select("friend_id").eq("owner_id", user.id)
      ]);

      if (membersRes.error) {
        console.error("Profile-Fehler:", membersRes.error);
        showLoadFailure(
          "Profildaten konnten nicht geladen werden. Bitte Seite neu laden oder erneut anmelden."
        );
        return;
      }

      const allProfiles = membersRes.data || [];
      state.profile = allProfiles.find((m) => m.id === user.id) || null;

      if (!state.profile) {
        await sb.auth.signOut();
        showLoadFailure(
          "Dein Benutzerprofil wurde nicht gefunden. Bitte wende dich an den Admin."
        );
        return;
      }

      // Zusätzliche Absicherung: unbestätigte Profile sofort wieder abmelden
      if (state.profile.is_approved === false) {
        await sb.auth.signOut();
        showLoadFailure(
          "Dein Zugang wurde noch nicht freigeschaltet. Du erhältst eine E-Mail, sobald ein Admin deine Anfrage bestätigt."
        );
        return;
      }

      state.members = allProfiles.filter((m) => m.is_approved !== false);
      state.friendIds = new Set((sharesRes.data || []).map((r) => r.friend_id));

      const isAdmin = Boolean(state.profile.is_admin);
      if (navTabAdmin) {
        navTabAdmin.classList.toggle("hidden", !isAdmin);
      }
      if (!isAdmin) {
        switchTab("feed");
      }

      renderHeader();
      renderProfileForm();
      renderFriendsList();

      loginView.classList.add("hidden");
      appView.classList.remove("hidden");
      window.dispatchEvent(new CustomEvent("strada:ready"));
    } catch (err) {
      console.error("Unerwarteter Ladefehler:", err);
      showLoadFailure(
        "Verbindung zum Server fehlgeschlagen. Bitte prüfe deine Internetverbindung und lade die Seite neu."
      );
    }
  }

  function showLogin() {
    state.user = null;
    state.profile = null;
    state.members = [];
    state.friendIds.clear();
    clearMessage(profileMsg);
    if (passwordForm) passwordForm.reset();
    if (passwordMsg) clearMessage(passwordMsg);
    if (navTabAdmin) navTabAdmin.classList.add("hidden");
    switchTab("feed");
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("strada:logout"));
  }

  // Auth-Status überwachen
  sb.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id || null;
    if (uid === activeUserId) return;
    activeUserId = uid;

    if (session?.user) {
      setTimeout(() => loadUserData(session.user), 0);
    } else {
      showLogin();
    }
  });
})();
