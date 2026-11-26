(() => {
  const statusBadge = document.getElementById("garmin-status-badge");
  const statusText = document.getElementById("garmin-status-text");
  const settingsBox = document.getElementById("garmin-settings-box");
  const autoPrivacyCheckbox = document.getElementById("garmin-auto-privacy");
  const connectBtn = document.getElementById("garmin-connect-btn");
  const disconnectBtn = document.getElementById("garmin-disconnect-btn");
  const msgEl = document.getElementById("garmin-msg");

  if (!statusBadge || !connectBtn || !disconnectBtn) return;

  // OAuth-Parameter direkt beim Laden sichern (falls Nutzer von Garmin zurückkehrt)
  const initialParams = new URLSearchParams(window.location.search);
  let pendingCode = initialParams.get("code");
  let pendingState = initialParams.get("state");
  let pendingOAuthError =
    initialParams.get("error_description") || initialParams.get("error");

  function resetConnectButton() {
    connectBtn.disabled = false;
    connectBtn.textContent = "Mit Garmin Connect verbinden";
  }

  function showMsg(text, type) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.classList.remove("hidden", "msg-error", "msg-success");
    if (type === "error") msgEl.classList.add("msg-error");
    if (type === "success") msgEl.classList.add("msg-success");
  }

  function clearMsg() {
    if (!msgEl) return;
    msgEl.textContent = "";
    msgEl.classList.add("hidden");
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function cleanUrlParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    window.history.replaceState({}, document.title, url.pathname + url.hash);
  }

  function openProfileTab() {
    const profileTabBtn = document.querySelector('.nav-tab[data-tab="profile"]');
    if (profileTabBtn) profileTabBtn.click();
  }

  async function callGarminAuth(action, payload = {}) {
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

    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/garmin-auth`, {
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
    } catch (_err) {
      body = {};
    }

    if (!res.ok) {
      throw new Error(body.error || `Serverfehler (${res.status})`);
    }
    return body;
  }

  function renderState(data) {
    statusBadge.classList.remove("badge-admin", "badge-private");
    resetConnectButton();

    if (!data.configured) {
      statusBadge.textContent = "In Vorbereitung";
      statusBadge.classList.add("badge-private");
      statusText.textContent =
        "Die automatische Garmin-Connect-Synchronisation wird derzeit freigeschaltet. Bis dahin kannst du deine FIT- und GPX-Dateien wie gewohnt manuell hochladen.";
      settingsBox.classList.add("hidden");
      connectBtn.classList.add("hidden");
      disconnectBtn.classList.add("hidden");
      return;
    }

    if (data.connected) {
      statusBadge.textContent = "Verbunden";
      statusBadge.classList.add("badge-admin");
      const since = data.connected_at ? ` (seit ${formatDate(data.connected_at)})` : "";
      statusText.textContent = `Dein Garmin-Connect-Konto ist verknüpft${since}. Neue Touren werden nach dem Synchronisieren automatisch mit deiner Standard-Sichtbarkeit importiert.`;
      autoPrivacyCheckbox.checked = data.auto_privacy_trim !== false;
      settingsBox.classList.remove("hidden");
      connectBtn.classList.add("hidden");
      disconnectBtn.classList.remove("hidden");
    } else {
      statusBadge.textContent = "Nicht verbunden";
      statusBadge.classList.add("badge-private");
      statusText.textContent =
        "Verbinde dein Garmin-Connect-Konto, damit neue Touren nach dem Speichern automatisch im Dashboard erscheinen. Es gilt deine gewählte Standard-Sichtbarkeit.";
      settingsBox.classList.add("hidden");
      connectBtn.classList.remove("hidden");
      disconnectBtn.classList.add("hidden");
    }
  }

  async function refreshStatus() {
    try {
      const data = await callGarminAuth("status");
      renderState(data);
    } catch (err) {
      statusBadge.textContent = "Fehler";
      showMsg(`Status konnte nicht geladen werden: ${err.message}`, "error");
    }
  }

  async function handleOAuthReturnIfPresent() {
    if (pendingOAuthError) {
      const errText = pendingOAuthError;
      pendingOAuthError = null;
      pendingCode = null;
      pendingState = null;
      cleanUrlParams();
      openProfileTab();
      showMsg(`Garmin-Verbindung abgebrochen: ${errText}`, "error");
      await refreshStatus();
      return;
    }

    if (pendingCode && pendingState) {
      const code = pendingCode;
      const state = pendingState;
      pendingCode = null;
      pendingState = null;
      cleanUrlParams();
      openProfileTab();

      statusBadge.textContent = "Verbinde…";
      showMsg("Schließe Verbindung mit Garmin Connect ab…", "");

      try {
        await callGarminAuth("callback", { code, state });
        showMsg(
          "Garmin Connect wurde erfolgreich verbunden! Zukünftige Touren erscheinen automatisch im Feed.",
          "success"
        );
      } catch (err) {
        showMsg(`Verbindung fehlgeschlagen: ${err.message}`, "error");
      }

      await refreshStatus();
      return;
    }

    await refreshStatus();
  }

  connectBtn.addEventListener("click", async () => {
    clearMsg();
    connectBtn.disabled = true;
    connectBtn.textContent = "Leite zu Garmin weiter…";

    try {
      const { authorize_url } = await callGarminAuth("start");
      if (!authorize_url) {
        throw new Error("Keine Weiterleitungs-URL erhalten.");
      }
      window.location.href = authorize_url;
    } catch (err) {
      resetConnectButton();
      showMsg(err.message || "Verbindung konnte nicht gestartet werden.", "error");
    }
  });

  disconnectBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Verbindung zu Garmin Connect wirklich trennen? Bereits importierte Touren bleiben im Dashboard erhalten."
    );
    if (!confirmed) return;

    clearMsg();
    disconnectBtn.disabled = true;
    disconnectBtn.textContent = "Trenne…";

    try {
      await callGarminAuth("disconnect");
      showMsg("Garmin Connect wurde getrennt.", "success");
      await refreshStatus();
    } catch (err) {
      showMsg(`Trennen fehlgeschlagen: ${err.message}`, "error");
    } finally {
      disconnectBtn.disabled = false;
      disconnectBtn.textContent = "Verbindung trennen";
    }
  });

  autoPrivacyCheckbox.addEventListener("change", async () => {
    clearMsg();
    autoPrivacyCheckbox.disabled = true;
    const checked = autoPrivacyCheckbox.checked;

    try {
      await callGarminAuth("settings", {
        auto_privacy_trim: checked,
        auto_weather: true
      });
      showMsg(
        checked
          ? "Privatsphäre-Kürzung (400 m) für Garmin-Touren aktiviert."
          : "Privatsphäre-Kürzung für Garmin-Touren deaktiviert.",
        "success"
      );
    } catch (err) {
      autoPrivacyCheckbox.checked = !checked;
      showMsg(`Einstellung konnte nicht gespeichert werden: ${err.message}`, "error");
    } finally {
      autoPrivacyCheckbox.disabled = false;
    }
  });

  // Verhindert eingefrorenen Button bei Rückkehr über den Browser-Zurück-Button (bfcache)
  window.addEventListener("pageshow", () => {
    if (connectBtn.disabled) {
      resetConnectButton();
    }
  });

  window.addEventListener("strada:ready", () => {
    handleOAuthReturnIfPresent();
  });

  window.addEventListener("strada:logout", () => {
    clearMsg();
    resetConnectButton();
    statusBadge.textContent = "Lädt…";
    settingsBox.classList.add("hidden");
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.add("hidden");
  });
})();
