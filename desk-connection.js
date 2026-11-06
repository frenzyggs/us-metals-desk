/* Private-link recovery. No credential is logged, displayed, or sent to any new host.
 * IMPORTANT: manifest injection runs synchronously before the URL fragment is stripped.
 */
(function () {
  "use strict";
  const D_KEY = "desk_us_d", K_KEY = "desk_us_k";
  const DB = "us_metals_desk_connection_v1", STORE = "connection";
  let D = null, K = null, onConnect = null, cryptoKey = null;
  let dbPromise = null, blobURL = null;
  const error = (kind, message) => Object.assign(new Error(message), { kind });

  function storage(write, name, value) {
    try {
      if (write) { if (value == null) localStorage.removeItem(name); else localStorage.setItem(name, value); }
      else return localStorage.getItem(name);
    } catch (_) { return null; }
  }
  function cookiePath() {
    const p = location.pathname;
    return (p.endsWith("/") ? p : p.replace(/[^/]+$/, "")) || "/";
  }
  function legacyCookie() {
    for (const part of (document.cookie || "").split("; ")) {
      if (part.startsWith(D_KEY + "=")) { try { return decodeURIComponent(part.slice(D_KEY.length + 1)); } catch (_) { return null; } }
    }
    return null;
  }
  function parseLink(raw, base) {
    if (typeof raw !== "string" || !raw.trim()) throw error("link", "Paste your private desk link first.");
    let url;
    try { url = new URL(raw.trim(), base || location.href); }
    catch (_) { throw error("link", "That is not a valid link. Paste the complete private desk link."); }
    const p = new URLSearchParams(url.hash.replace(/^#/, ""));
    const d = p.get("d"), k = p.get("k");
    if (!d || !k || d.length < 24 || k.length < 32) throw error("link", "The link is incomplete. Copy the entire private link, including both parts after #.");
    if (!/^[A-Za-z0-9_-]{24,256}$/.test(d) || !/^[A-Za-z0-9_-]{32,256}$/.test(k)) throw error("link", "That private link has an invalid format. Please paste the original link again.");
    if (base) {
      const origin = new URL(base);
      if (url.protocol !== origin.protocol || url.host !== origin.host) throw error("link", "Use the private link for this desk app, on the same secure host.");
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw error("link", "The private link must use HTTPS.");
    }
    return { d, k, full: url.href };
  }
  function database() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB blocked"));
    });
    return dbPromise;
  }
  async function idb(action, value, key = "private-link") {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, action === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore(STORE);
      const request = action === "write" ? store.put(value, key) : action === "read" ? store.get(key) : store.delete(key);
      request.onsuccess = () => resolve(action === "read" ? (request.result || null) : null);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    });
  }
  function backup() { idb("write", { d: D, k: K }).catch(() => {}); }
  function revokeManifest() {
    if (blobURL) URL.revokeObjectURL(blobURL);
    blobURL = null;
  }
  function manifest(link) {
    return idb("read", undefined, "manifest").then(saved => {
      const previous = saved || new URL("manifest.json", import.meta.url).href;
      const response = new Response(previous, { headers: { "Content-Type": "application/manifest+json" } });
      return response.json();
    }).catch(() => fetch(new URL("manifest.json", import.meta.url), { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("manifest unavailable");
      return r.json();
    })).then(doc => {
      // start_url and scope use the original, still-visible full hash at install time.
      const full = new URL(link);
      doc.start_url = full.href;
      doc.scope = full.href;
      doc.id = full.pathname;
      const linkEl = document.getElementById("app-manifest");
      revokeManifest();
      blobURL = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: "application/manifest+json" }));
      linkEl.href = blobURL;
      linkEl.dataset.dynamic = "true";
      return true;
    }).catch(() => false);
  }
  function remember(values) {
    D = values.d; K = values.k;
    storage(true, D_KEY, D); storage(true, K_KEY, K);
    cryptoKey = null;
    backup();
  }
  function resetKey() { cryptoKey = null; }
  function bytes(s) {
    try {
      const pad = "=".repeat((4 - (s.length % 4)) % 4);
      const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
      return Uint8Array.from(bin, c => c.charCodeAt(0));
    } catch (_) { throw error("decrypt", "Decryption failed"); }
  }
  async function key() {
    if (!D || !K) throw error("key", "Private desk connection missing");
    if (!cryptoKey) {
      try {
        const raw = bytes(K);
        if (raw.length !== 32) throw new Error("invalid key length");
        cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
      } catch (_) { throw error("decrypt", "Decryption failed"); }
    }
    return cryptoKey;
  }
  async function decrypt(envelope) {
    if (!envelope || envelope.v !== 1 || !envelope.n || !envelope.c) throw error("decrypt", "Encrypted data expected");
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(envelope.n) }, await key(), bytes(envelope.c));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (_) { throw error("decrypt", "Decryption failed"); }
  }
  async function restore() {
    // localStorage is synchronous and the primary path; IDB only supplements it.
    const savedD = storage(false, D_KEY), savedK = storage(false, K_KEY);
    if (savedD && savedK) { remember({ d: savedD, k: savedK }); return true; }
    try {
      const saved = await idb("read");
      if (saved && saved.d && saved.k) { remember(saved); return true; }
      if (savedD && savedK) { remember({ d: savedD, k: savedK }); return true; }
    } catch (_) {}
    if (savedD && savedK) { remember({ d: savedD, k: savedK }); return true; }
    return false;
  }
  function showConnect(message) {
    const view = document.getElementById("view");
    document.getElementById("error-row").hidden = true;
    document.getElementById("snapshot-row").hidden = true;
    document.getElementById("search-bar").hidden = true;
    view.innerHTML = `<div class="page"><section class="connect-screen" aria-labelledby="connect-title"><div class="empty-icon" aria-hidden="true">○</div><h1 id="connect-title">Connect your desk</h1><p>Paste your private desk link. It stays on this device.</p><form id="connect-form" novalidate><label for="desk-link">Private desk link</label><input id="desk-link" type="text" inputmode="url" placeholder="Paste your private desk link" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><p id="connect-error" class="connect-error" role="alert" ${message ? "" : "hidden"}></p><button class="btn" type="submit" id="connect-submit">Connect</button></form></section></div>`;
    const form = document.getElementById("connect-form"), input = document.getElementById("desk-link");
    const errorEl = document.getElementById("connect-error");
    if (message) { errorEl.textContent = message; errorEl.hidden = false; }
    form.addEventListener("submit", async e => {
      e.preventDefault();
      errorEl.hidden = true;
      const button = document.getElementById("connect-submit");
      button.disabled = true; input.disabled = true; button.textContent = "Connecting…";
      let values;
      try {
        // Validate before committing and clearing the secure fragment.
        values = parseLink(input.value, location.href);
        const parsed = new URL(values.full);
        const response = await fetch(`https://raw.githubusercontent.com/frenzyggs/us-metals-desk/data/d/${encodeURIComponent(values.d)}/state.json?_=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw error("link", "The desk data could not be found. Check that you pasted the complete original link.");
        const envelope = await response.json();
        const previousD = D, previousK = K;
        remember(values);
        try { await decrypt(envelope); } catch (err) { D = previousD; K = previousK; cryptoKey = null; throw err; }
        await manifest(values.full);
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
        await restore();
        onConnect();
      } catch (err) {
        // Generic error by design: never include the pasted URL or recovered values.
        const safeMessage = err.kind === "link" ? err.message : "";
        const msg = err.kind === "decrypt" || err.name === "OperationError" ? "Cannot decrypt with this link. Paste the complete original private link or request a new one." : (safeMessage && !/[#?]d=|[#?&]k=/.test(safeMessage) ? safeMessage : "Could not connect. Check your connection and paste the original private link again.");
        input.value = ""; errorEl.textContent = msg; errorEl.hidden = false;
        button.disabled = false; input.disabled = false; button.textContent = "Connect";
        await restore().catch(() => {});
      }
    });
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  }
  async function forget() {
    storage(true, D_KEY, null); storage(true, K_KEY, null);
    document.cookie = D_KEY + "=; Path=" + cookiePath() + "; Max-Age=0; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    try { await idb("delete"); } catch (_) {}
    try { if (dbPromise) (await dbPromise).close(); } catch (_) {}
    dbPromise = null; D = null; K = null; cryptoKey = null;
    revokeManifest();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    showConnect();
  }
  window.DeskConnection = {
    parse: parseLink,
    get d() { return D; }, get k() { return K; },
    has: () => !!(D && K),
    decrypt, restore, showConnect, forget, resetKey,
    initialize(handler) {
      onConnect = handler;
      // Manifest JSON is cached alongside the shell, so Blob creation never needs network.
      fetch(new URL("manifest.json", import.meta.url), { cache: "no-store" })
        .then(r => { if (!r.ok) throw new Error("manifest unavailable"); return r.text(); })
        .then(text => idb("write", text, "manifest")).catch(() => {});
      // Read raw fragment once before replacing it; never include credentials in strings shown to users.
      if (location.hash) {
        let values;
        try { values = parseLink(location.href); } catch (_) { values = null; }
        if (values) {
          const injecting = manifest(values.full);
          remember(values);
          history.replaceState(null, "", location.pathname + location.search);
          Promise.resolve(injecting).then(() => restore());
          return Promise.resolve(true);
        }
        // An old path may have only d; preserve it, but never reconstruct a key.
        try {
          const d = new URLSearchParams(location.hash.slice(1)).get("d");
          if (d) storage(true, D_KEY, d);
        } catch (_) {}
        history.replaceState(null, "", location.pathname + location.search);
      } else if (storage(false, D_KEY) || legacyCookie()) {
        // Create a keyed manifest for browsers that install from a later reconnect, too.
        if (storage(false, K_KEY)) manifest(location.pathname + location.search + "#d=" + encodeURIComponent(storage(false, D_KEY)) + "&k=" + encodeURIComponent(storage(false, K_KEY)));
      }
      storage(true, D_KEY, storage(false, D_KEY) || legacyCookie());
      return restore();
    },
  };
})();
