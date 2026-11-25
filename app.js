(() => {
  const cfg = window.STRADALAB_CONFIG || {};

  // DOM-Referenzen
  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app-view");
  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginBtn = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");

  const navAvatar = document.getElementById("nav-avatar");
  const navUsername = document.getElementById("nav-username");
  const navTabs = document.querySelectorAll(".nav-tab");
  const tabPanels = {
    feed: document.getElementById("tab-feed"),
    profile: document.getElementById("tab-profile")
  };

  const profileForm = document.getElementById("profile-form");
  const profileName = document.getElementById("profile-name");
  const profileVisibility = document.getElementById("profile-visibility");
  const profileColor = document.getElementById("profile-color");
  const profilePreview = document.getElementById("profile-preview");
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

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  // Gemeinsamer App-Zustand für spätere Module (GPX-Upload & Feed)
  const state = {
    sb,
    user: null,
    profile: null,
    members: [],
    friendIds: new Set()
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
    el.textContent = text;
    el.classList.remove("hidden", "msg-error", "msg-success");
    if (type === "error") el.classList.add("msg-error");
    if (type === "success") el.classList.add("msg-success");
  }

  function clearMessage(el) {
    el.textContent = "";
    el.classList.add("hidden");
  }

  function updateAvatarPreview() {
    profilePreview.textContent = getInitials(profileName.value);
    profilePreview.style.backgroundColor = profileColor.value;
  }

  function switchTab(tabName) {
    navTabs.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    Object.entries(tabPanels).forEach(([key, panel]) => {
      panel.classList.toggle("hidden", key !== tabName);
    });
  }

  // Navigation
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
      showMessage(loginError, "E-Mail oder Passwort nicht korrekt.", "error");
    } else {
      loginPassword.value = "";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  // Profil speichern
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
        default_visibility: profileVisibility.value
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
          checkbox.checked = !checked; // Rollback bei Fehler
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

  // Daten nach Login laden
  async function loadUserData(user) {
    state.user = user;

    const [membersRes, sharesRes] = await Promise.all([
      sb.from("profiles").select("*").order("display_name", { ascending: true }),
      sb.from("friend_shares").select("friend_id").eq("owner_id", user.id)
    ]);

    if (membersRes.error) {
      console.error("Profile-Fehler:", membersRes.error);
      return;
    }

    state.members = membersRes.data || [];
    state.profile = state.members.find((m) => m.id === user.id) || null;
    state.friendIds = new Set((sharesRes.data || []).map((r) => r.friend_id));

    renderHeader();
    renderProfileForm();
    renderFriendsList();

    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("strada:ready"));
  }

  function showLogin() {
    state.user = null;
    state.profile = null;
    state.members = [];
    state.friendIds.clear();
    clearMessage(profileMsg);
    if (passwordForm) passwordForm.reset();
    if (passwordMsg) clearMessage(passwordMsg);
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("strada:logout"));
  }

  // Auth-Status überwachen
  let activeUserId = undefined;
  sb.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id || null;
    if (uid === activeUserId) return;
    activeUserId = uid;

    if (session?.user) {
      // Asynchron starten, um Auth-Lock in Supabase JS v2 zu vermeiden
      setTimeout(() => loadUserData(session.user), 0);
    } else {
      showLogin();
    }
  });
})();