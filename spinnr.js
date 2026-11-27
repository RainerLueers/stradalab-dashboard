(() => {
  const statusBadge = document.getElementById("spinnr-status-badge");
  const statusText = document.getElementById("spinnr-status-text");
  const revealBox = document.getElementById("spinnr-token-reveal");
  const endpointInput = document.getElementById("spinnr-endpoint-input");
  const tokenInput = document.getElementById("spinnr-token-input");
  const copyEndpointBtn = document.getElementById("spinnr-copy-endpoint-btn");
  const copyTokenBtn = document.getElementById("spinnr-copy-token-btn");
  const generateBtn = document.getElementById("spinnr-generate-btn");
  const revokeBtn = document.getElementById("spinnr-revoke-btn");
  const msgEl = document.getElementById("spinnr-msg");

  if (!statusBadge || !generateBtn || !revokeBtn) return;

  let activeTokenRow = null;

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

  function formatDateTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getEndpointUrl() {
    const base = (window.STRADALAB_CONFIG?.supabaseUrl || "").replace(/\/+$/, "");
    return base ? `${base}/functions/v1/spinnr-import` : "";
  }

  function generateRawToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sl_${hex}`;
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function copyText(inputEl, btnEl) {
    const val = inputEl?.value || "";
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
    } catch (_err) {
      inputEl.select();
      document.execCommand("copy");
    }
    const prev = btnEl.textContent;
    btnEl.textContent = "Kopiert ✓";
    setTimeout(() => {
      btnEl.textContent = prev;
    }, 1500);
  }

  function renderState(row) {
    activeTokenRow = row;
    statusBadge.classList.remove("badge-admin", "badge-private");

    if (row) {
      statusBadge.textContent = "Aktiv";
      statusBadge.classList.add("badge-admin");

      const created = formatDateTime(row.created_at);
      const lastUsed = row.last_used_at
        ? ` · Zuletzt genutzt: ${formatDateTime(row.last_used_at)}`
        : " · Noch nicht genutzt";

      statusText.textContent =
        `Aktiver Schlüssel (${row.token_prefix}…) erstellt am ${created}${lastUsed}. ` +
        `Neue Fahrten aus SPINNR Pro werden mit deiner Standard-Sichtbarkeit importiert.`;

      generateBtn.textContent = "Neuen Schlüssel erzeugen";
      revokeBtn.classList.remove("hidden");
    } else {
      statusBadge.textContent = "Nicht eingerichtet";
      statusBadge.classList.add("badge-private");
      statusText.textContent =
        "Erzeuge einen persönlichen Upload-Schlüssel und trage ihn in SPINNR Pro unter Einstellungen ein, um Fahrten direkt nach StradaLab zu senden.";
      generateBtn.textContent = "Upload-Schlüssel erzeugen";
      revokeBtn.classList.add("hidden");
    }
  }

  async function refreshStatus() {
    const app = window.StradaApp;
    if (!app?.sb || !app.user) return;

    const { data, error } = await app.sb
      .from("api_tokens")
      .select("id, token_prefix, created_at, last_used_at")
      .eq("user_id", app.user.id)
      .eq("provider", "spinnr_pro")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      statusBadge.textContent = "Fehler";
      showMsg(`Status konnte nicht geladen werden: ${error.message}`, "error");
      return;
    }

    renderState(Array.isArray(data) && data.length > 0 ? data[0] : null);
  }

  generateBtn.addEventListener("click", async () => {
    const app = window.StradaApp;
    if (!app?.sb || !app.user) return;

    if (activeTokenRow) {
      const ok = window.confirm(
        "Einen neuen Upload-Schlüssel erzeugen? Der bisherige Schlüssel wird dadurch sofort ungültig."
      );
      if (!ok) return;
    }

    clearMsg();
    generateBtn.disabled = true;
    generateBtn.textContent = "Erzeuge…";

    try {
      // Bisherige aktive SPINNR-Schlüssel dieses Nutzers sauber widerrufen
      await app.sb
        .from("api_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", app.user.id)
        .eq("provider", "spinnr_pro")
        .is("revoked_at", null);

      const rawToken = generateRawToken();
      const tokenHash = await sha256Hex(rawToken);
      const tokenPrefix = rawToken.slice(0, 11);

      const { data, error } = await app.sb
        .from("api_tokens")
        .insert({
          user_id: app.user.id,
          provider: "spinnr_pro",
          label: "SPINNR Pro",
          token_hash: tokenHash,
          token_prefix: tokenPrefix
        })
        .select("id, token_prefix, created_at, last_used_at")
        .single();

      if (error) throw error;

      endpointInput.value = getEndpointUrl();
      tokenInput.value = rawToken;
      revealBox.classList.remove("hidden");

      renderState(data);
      showMsg(
        "Neuer Upload-Schlüssel erzeugt. Bitte kopiere ihn jetzt in SPINNR Pro – nach dem Neuladen ist er aus Sicherheitsgründen nicht mehr sichtbar.",
        "success"
      );
    } catch (err) {
      showMsg(`Erzeugen fehlgeschlagen: ${err.message}`, "error");
      await refreshStatus();
    } finally {
      generateBtn.disabled = false;
    }
  });

  revokeBtn.addEventListener("click", async () => {
    const app = window.StradaApp;
    if (!app?.sb || !app.user || !activeTokenRow) return;

    const ok = window.confirm(
      "Upload-Schlüssel für SPINNR Pro wirklich widerrufen? Bereits importierte Touren bleiben erhalten."
    );
    if (!ok) return;

    clearMsg();
    revokeBtn.disabled = true;
    revokeBtn.textContent = "Widerrufe…";

    try {
      const { error } = await app.sb
        .from("api_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", app.user.id)
        .eq("provider", "spinnr_pro")
        .is("revoked_at", null);

      if (error) throw error;

      tokenInput.value = "";
      revealBox.classList.add("hidden");
      renderState(null);
      showMsg("Upload-Schlüssel wurde widerrufen.", "success");
    } catch (err) {
      showMsg(`Widerrufen fehlgeschlagen: ${err.message}`, "error");
    } finally {
      revokeBtn.disabled = false;
      revokeBtn.textContent = "Schlüssel widerrufen";
    }
  });

  copyEndpointBtn?.addEventListener("click", () => copyText(endpointInput, copyEndpointBtn));
  copyTokenBtn?.addEventListener("click", () => copyText(tokenInput, copyTokenBtn));

  window.addEventListener("strada:ready", () => {
    revealBox.classList.add("hidden");
    tokenInput.value = "";
    refreshStatus();
  });

  window.addEventListener("strada:logout", () => {
    activeTokenRow = null;
    clearMsg();
    tokenInput.value = "";
    revealBox.classList.add("hidden");
    statusBadge.textContent = "Lädt…";
    revokeBtn.classList.add("hidden");
  });
})();