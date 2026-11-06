// US Metals Desk — Step 8. Black iOS, Plan B static hosting.
// Data arrives encrypted as {v:1,n,c}; the AES key stays only in the URL fragment.
// Broker URLs are rendered only from desk JSON produced by links.py, never built here.
(function () {
  "use strict";
  const STORE_D = "desk_us_d";
  const PLAN_B = "Not saved: change it in the desk chat (STEP 9)";
  const GH_RAW = "https://raw.githubusercontent.com/frenzyggs/us-metals-desk/data/";
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const NAMES = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
  const COLOR = { scanner: "var(--cyan)", auditor: "var(--text)", analyst: "var(--yellow)", executor: "var(--green)", risk: "var(--pink)" };
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = id => document.getElementById(id);
  const view = $("view");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const finite = v => v != null && Number.isFinite(Number(v));
  const money = v => !finite(v) ? "–" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => !finite(v) ? "–" : (Number(v) > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
  const num = (v, digits = 2) => !finite(v) ? "–" : Number(v).toFixed(digits);
  const compact = v => !finite(v) ? "–" : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v));
  const clsPnl = v => finite(v) && Number(v) < 0 ? "red" : "green";

  function appCookiePath() {
    const p = location.pathname;
    return (p.endsWith("/") ? p : p.replace(/[^/]+$/, "")) || "/";
  }
  function readStore(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function writeStore(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function readCookie(n) {
    for (const p of (document.cookie || "").split("; ")) {
      if (p.startsWith(n + "=")) { try { return decodeURIComponent(p.slice(n.length + 1)); } catch (_) { return null; } }
    }
    return null;
  }
  function rememberD(d) {
    if (!d) return;
    writeStore(STORE_D, d);
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = STORE_D + "=" + encodeURIComponent(d) + "; Path=" + appCookiePath() + "; Max-Age=31536000; SameSite=Lax" + secure;
  }
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("d")) rememberD(hash.get("d"));
  const D = hash.get("d") || readStore(STORE_D) || readCookie(STORE_D);
  const K = hash.get("k") || null;
  if (D && !hash.get("d")) history.replaceState(null, "", location.pathname + location.search + "#d=" + encodeURIComponent(D) + (K ? "&k=" + encodeURIComponent(K) : ""));

  function b64ToBytes(s) {
    try {
      const pad = "=".repeat((4 - (s.length % 4)) % 4);
      const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
      return Uint8Array.from(bin, c => c.charCodeAt(0));
    } catch (_) { throw Object.assign(new Error("invalid key"), { kind: "decrypt" }); }
  }
  let cryptoKey = null;
  async function getKey() {
    if (!D) throw Object.assign(new Error("Private desk link required"), { kind: "missing" });
    if (!K) throw Object.assign(new Error("Decryption key required"), { kind: "key" });
    if (!cryptoKey) {
      try { cryptoKey = await crypto.subtle.importKey("raw", b64ToBytes(K), "AES-GCM", false, ["decrypt"]); }
      catch (_) { throw Object.assign(new Error("invalid key"), { kind: "key" }); }
    }
    return cryptoKey;
  }
  async function get(file) {
    const url = GH_RAW + "d/" + encodeURIComponent(D) + "/" + file + "?_=" + Date.now();
    let response;
    try { response = await fetch(url, { cache: "no-store" }); }
    catch (_) { throw Object.assign(new Error("Network unavailable"), { kind: "network" }); }
    if (!response.ok) throw Object.assign(new Error("Data request returned " + response.status), { kind: "http", status: response.status });
    let envelope;
    try { envelope = await response.json(); }
    catch (_) { throw Object.assign(new Error("Invalid data response"), { kind: "data" }); }
    if (!envelope || envelope.v !== 1 || !envelope.n || !envelope.c) {
      throw Object.assign(new Error("Encrypted data expected"), { kind: "decrypt" });
    }
    try {
      const iv = b64ToBytes(envelope.n), ct = b64ToBytes(envelope.c);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await getKey(), ct);
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (_) { throw Object.assign(new Error("Decryption failed"), { kind: "decrypt" }); }
  }
  async function optional(file) { try { return await get(file); } catch (e) { if (e.status === 404) return null; throw e; } }

  const S = {
    loaded: false, error: null, lastGood: null, lastSuccess: null, nextPoll: 0, poll: 60,
    state: null, chart: null, activity: null, account: null, settings: null, decisions: {},
    range: "LIVE", tab: "home", screen: null, screenRequest: 0, liveDialog: false,
  };
  let built = null;
  const rows = () => (S.activity && (S.activity.rows || S.activity.items)) || [];
  const isPaper = () => (((S.state || S.account || {}).mode) || "PAPER") === "PAPER";
  const brokerName = () => {
    const b = (S.state || S.account || {}).broker || "tradingview";
    return b === "tradingview" ? "TradingView" : b;
  };
  const handle = () => (S.state || S.account || {}).broker_handle || "ValHD";
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.setAttribute("role", "status"); t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function externalLink(url, label, cls = "") {
    // Validate a supplied URL; no construction or host inference occurs in the client.
    if (!url || !/^https:\/\/[^\s]+$/i.test(url)) return `<span class="${cls} sec">Link unavailable</span>`;
    return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-external>${esc(label)}</a>`;
  }
  const TIME_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const DATE_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" });
  function clockParts(ts) {
    return TIME_PARTS.formatToParts(new Date(ts * 1000)).reduce((o,p) => (o[p.type]=p.value,o),{});
  }
  function fmtTime(ts) {
    if (!finite(ts)) return "–";
    let ms = Number(ts) < 1e12 ? Number(ts)*1000 : Number(ts);
    if (typeof ts === "string" && /^[0-9]{4}-/.test(ts)) ms = Date.parse(ts);
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "–";
    return d.toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", year:"numeric",day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", " ·") + " AMS";
  }

  async function poll() {
    try {
      const st = await get("state.json");
      S.poll = finite(st.poll_seconds) ? Math.max(15, Number(st.poll_seconds)) : 60;
      const [ch, act, acc, set, ...dec] = await Promise.all([
        get(`chart/${S.range}.json`).catch(() => get("chart.json")),
        get("activity.json"), get("account.json"), get("settings.json"),
        ...AGENTS.map(a => optional(`agents/${a}/decisions.json`)),
      ]);
      AGENTS.forEach((a, i) => { S.decisions[a] = (dec[i] && (dec[i].decisions || dec[i].items)) || []; });
      Object.assign(S, { state: st, chart: ch, activity: act, account: acc, settings: set, loaded: true, error: null });
      const hb = Number(st.heartbeat_ts != null ? st.heartbeat_ts : st.heartbeat);
      if (Number.isFinite(hb)) S.lastGood = hb > 1e12 ? hb / 1000 : hb;
      S.lastSuccess = Date.now() / 1000;
      if (S.screen) loadScreenData(S.screen);
    } catch (e) {
      S.error = e;
      // Keep the last good snapshot visible, with a prominent offline/error banner.
    }
    S.nextPoll = Date.now() + S.poll * 1000;
    renderStatus(); render();
    setTimeout(poll, S.poll * 1000);
  }

  function dataState() {
    if (!D) return "no-link";
    if (!K) return "missing-key";
    if (S.error) return S.error.kind === "decrypt" || S.error.kind === "key" ? "decrypt" : "offline";
    const staleAfter = finite(S.state && S.state.stale_after_s) ? Number(S.state.stale_after_s) : 720;
    if (!S.loaded) return "loading";
    const age = Date.now() / 1000 - (S.lastGood || S.lastSuccess || 0);
    return age > Math.max(staleAfter, S.poll * 4) ? "stale" : "ok";
  }
  function renderStatus() {
    const row = $("error-row"), snap = $("snapshot-row"), state = dataState();
    row.className = "error-row" + (state === "stale" ? " stale" : "");
    const messages = {
      "no-link": "No desk data · open the private link supplied by the desk.",
      "missing-key": "Cannot decrypt · the private link's key is missing. Open the full link again.",
      decrypt: "Cannot decrypt desk data · check that the full private link, including its key, was used.",
      offline: "Desk offline · showing the last available snapshot; retrying automatically.",
      stale: "Data stale · the publisher has not sent a fresh heartbeat. Last snapshot remains visible.",
    };
    row.hidden = state === "ok" || state === "loading";
    row.textContent = messages[state] || "";
    snap.hidden = !S.lastGood;
    if (S.lastGood) snap.textContent = (state === "ok" ? "Updated " : "Last update ") + fmtTime(S.lastGood);
  }
  function emptyPage(title, body, action = "") {
    return `<div class="page"><div class="empty-state"><div class="empty-icon" aria-hidden="true">○</div><h1>${esc(title)}</h1><p>${esc(body)}</p>${action}</div></div>`;
  }
  function loadingCards(n = 5) { return `<div class="page">${'<div class="sk row-sk"></div>'.repeat(n)}</div>`; }
  function go(tab) {
    S.tab = tab; S.screen = null; S.liveDialog = false; built = null;
    closeLiveDialog(false); render(); scrollTo(0, 0);
  }
  function render() {
    $("nav-title").textContent = "Grok Bot ›";
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab && !S.screen));
    $("nav-avatar").textContent = (handle()[0] || "V").toUpperCase();
    $("nav-back").hidden = !S.screen;
    if (S.screen) { renderDetail(); return; }
    if (dataState() === "no-link" || dataState() === "missing-key") {
      view.innerHTML = emptyPage("Private desk link required", "Ask the desk for the full private link. Do not share its decryption key."); return;
    }
    if (!S.loaded && S.error) {
      const decrypt = dataState() === "decrypt";
      const noData = S.error.status === 404;
      view.innerHTML = emptyPage(decrypt ? "Cannot open encrypted data" : noData ? "No desk data yet" : "Desk data unavailable",
        decrypt ? "The link may be incomplete or its key may be wrong. No market values have been substituted." : noData ? "The publisher has not created a snapshot here. No prices, audits or fills have been substituted." : "The desk could not be reached. Retry, or come back when the publisher is online.",
        `<button class="btn" data-act="retry">Try again</button>`); return;
    }
    if (S.tab === "home") renderHome();
    else if (S.tab === "agents") renderAgents();
    else if (S.tab === "activity") renderActivity();
    else if (S.tab === "account") renderAccount();
  }

  function setOdo(el, text) {
    const chars = [...text];
    if (el.dataset.value === text) return;
    const old = el.dataset.value;
    el.dataset.value = text;
    el.setAttribute("aria-label", text);
    const oldDigits = old ? [...old].filter(c => /\d/.test(c)) : [];
    let digitIndex = 0;
    el.innerHTML = chars.map(ch => {
      if (!/\d/.test(ch)) return `<span class="punct" aria-hidden="true">${esc(ch)}</span>`;
      const index = digitIndex++, from = Number(oldDigits[index] || 0), to = Number(ch);
      return `<span class="d" aria-hidden="true"><span class="strip" data-to="${to}" style="transform:translateY(-${from * 1.05}em)">${[0,1,2,3,4,5,6,7,8,9].map(n => `<span>${n}</span>`).join("")}</span></span>`;
    }).join("");
    el.querySelectorAll(".strip").forEach(el => {
      const to = Number(el.dataset.to || 0);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = `translateY(-${to * 1.05}em)`; }));
    });
  }
  function chartPoints() {
    return (((S.chart || {}).points || (S.chart || {}).series) || []).map(p => {
      const t = Array.isArray(p) ? p[0] : (p.t != null ? p.t : p.ts), v = Array.isArray(p) ? p[1] : (p.v != null ? p.v : p.value);
      return [t > 1e12 ? t / 1000 : t, v];
    }).filter(p => finite(p[0]) && finite(p[1]));
  }
  function chartMarks() {
    return (((S.chart || {}).marks) || []).map((m, i) => {
      const kind = m.kind || "bought";
      let color = "#0a84ff", label = "Bought " + (m.symbol || "");
      if (/sold/i.test(kind)) { color = "#00d35a"; label = "Sold " + (m.symbol || ""); }
      if (/stop/i.test(kind)) { color = "#ff453a"; label = "Stopped " + (m.symbol || ""); }
      return { ts: m.ts > 1e12 ? m.ts / 1000 : m.ts, label, color, key: kind + m.symbol + m.ts + i };
    });
  }
  function agentCard(a) {
    const cards = (S.state || {}).cards || {}, head = `<div class="who"><i style="background:${COLOR[a]}"></i>${NAMES[a]}</div>`;
    let title = "Waiting", body = `<p class="sec">No decisions yet</p>`, foot = "";
    if (a === "scanner") {
      const info = cards.scanner || {}, feed = info.feed || (S.state || {}).feed || [];
      title = `${info.watching || 0} watching`;
      body = feed.length ? `<ul class="feed">${feed.slice(0,4).map(f => `<li class="${f.verdict === "pass" ? "passed" : "killed"}"><span class="n">${esc(f.symbol)} · rvol ${num(f.rvol)}</span><span class="r">${f.verdict === "pass" ? "→ auditor" : esc(f.reason || f.verdict || "cut")}</span></li>`).join("")}</ul>` : `<p class="sec">Listening for candidates</p>`;
    } else if (a === "auditor") {
      const layers = (cards.auditor || {}).layers || [];
      title = layers.length ? (layers.some(l => l.status === "red") ? "Rejected" : layers.every(l => l.status === "ok") ? "Clear" : "Checked") : "No audit yet";
      body = `<div class="strips">${Array.from({length:8},(_,i) => { const l=layers[i]||{}; return `<div class="strip-l ${l.status === "red" ? "bad" : l.status === "ok" ? "ok" : ""}">${i+1}</div>`; }).join("")}</div><p class="sec">${layers.length ? "Latest saved 8-layer result" : "Waiting for a Scanner pass"}</p>`;
    } else if (a === "analyst") {
      const d = (cards.analyst || {}).latest;
      title = d ? "Latest score" : "Score";
      body = `<canvas class="ring" id="ring" data-score="${d ? esc(d.score) : ""}" data-pass="${d && d.pass ? "true" : "false"}"></canvas>`;
    } else if (a === "executor") {
      const d = (cards.executor || {}).latest;
      title = d ? d.symbol : "Ready";
      body = d ? `<p class="sec">${esc(d.status || "signal")} · ${money(d.size_usd)} · ${fmtTime(d.ts)}</p>${externalLink(d.link, `Open on ${brokerName()} →`, "cardlink")}` : `<p class="sec">No signal yet. The desk never places broker orders.</p>`;
    } else {
      const opens = (cards.risk || {}).open_positions || [];
      title = opens.length ? "Guarding" : "Nothing open";
      body = opens.length ? opens.slice(0,3).map(p => `<button class="position-link" data-symbol="${esc(p.symbol)}"><span>${esc(p.symbol)}</span><span class="orange">stop ${money(p.stop_price)}</span></button>`).join("") : `<div class="pills"><span class="pill mono">stop —</span><span class="pill mono">trail —</span></div>`;
    }
    return `<div class="acard" data-go="agents">${head}<h3>${esc(title)}</h3><div class="body">${body}</div><div class="foot">${foot}</div></div>`;
  }
  function renderHome() {
    if (!S.loaded) { view.innerHTML = `<div class="page"><div class="sk big-sk"></div><div class="sk line-sk"></div><div class="sk card-sk"></div></div>`; return; }
    if (built !== "home") {
      view.innerHTML = `<div class="page"><div class="balance-row"><span class="big odo" id="bal"></span><span id="paper"></span></div>
        <div class="today" id="today"></div><div class="chart-wrap"><canvas class="line" id="line"></canvas><div class="chart-empty" id="chart-empty" hidden></div></div>
        <div class="ranges">${RANGES.map(r => `<button data-range="${r}" class="${S.range === r ? "on" : ""}">${r}</button>`).join("")}</div>
        <div class="mark-key"><span class="blue">● Bought</span><span class="green">● Sold</span><span class="red">● Stopped</span></div>
        <div class="section-h"><span>Agents</span></div><div class="carousel" id="carousel"></div>
        <div class="section-h"><span>Activity</span><button data-go="activity">See all</button></div><ul class="rows" id="home-act"></ul></div>`;
      built = "home";
    }
    const st = S.state || {}, bal = st.balance != null ? st.balance : st.stack;
    setOdo($("bal"), money(bal));
    $("paper").innerHTML = isPaper() ? `<span class="badge-paper">PAPER</span>` : "";
    $("today").innerHTML = `<span class="${clsPnl(st.today_pnl_pct)}">${pct(st.today_pnl_pct)} today</span><span class="mult ${finite(st.multiplier) && st.multiplier < 1 ? "down" : ""}">${num(st.multiplier)}×</span>`;
    document.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("on", b.dataset.range === S.range));
    const points = chartPoints();
    $("chart-empty").hidden = points.length > 0; $("chart-empty").textContent = "No equity history in this range yet — not a forecast";
    DeskChart.line($("line"), points, chartMarks(), { startValue: points.length ? points[0][1] : bal });
    const scroll = $("carousel").scrollLeft;
    $("carousel").innerHTML = AGENTS.map(agentCard).join(""); $("carousel").scrollLeft = scroll;
    const ring = $("ring"); if (ring) DeskChart.ring(ring, ring.dataset.score === "" ? null : Number(ring.dataset.score), ring.dataset.pass === "true");
    const items = rows().slice(0,5);
    $("home-act").innerHTML = items.length ? items.map(actRow).join("") : `<li class="empty">No activity yet — Scanner decisions will appear here</li>`;
  }
  function activityRoute(it) {
    const reject = /reject/i.test(it.title || "") || it.kind === "audit";
    if (reject && it.symbol) return `data-audit="${esc(it.symbol)}"`;
    return it.symbol ? `data-symbol="${esc(it.symbol)}"` : "";
  }
  function actRow(it) {
    const route = activityRoute(it), title = it.title || it.kind || "Event";
    const sub = [it.agent, it.subtitle, fmtTime(it.ts)].filter(Boolean).join(" · ");
    const value = it.value || "";
    return `<li><button class="row ${route ? "link" : ""}" ${route}><div class="main"><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div><div class="v ${/sold/i.test(it.kind) ? "green" : /stop/i.test(it.kind) ? "red" : ""}">${esc(value)}</div>${route ? '<span class="chevron">›</span>' : ""}</button></li>`;
  }
  function renderActivity() {
    built = null;
    if (!S.loaded) { view.innerHTML = loadingCards(8); return; }
    const items = rows();
    view.innerHTML = `<div class="page"><div class="section-h"><span>Activity</span><span class="section-count">${items.length}</span></div><p class="note">Tap a symbol for prices. Rejections open the 8-layer audit.</p><ul class="rows">${items.length ? items.map(actRow).join("") : '<li class="empty">Nothing yet — candidates, rejects and PAPER events land here</li>'}</ul></div>`;
  }
  function isToday(ts) {
    if (!ts) return false;
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(ts));
    if (!match) return false;
    const parts = DATE_PARTS.formatToParts(new Date()).reduce((o,p) => (o[p.type]=p.value,o),{});
    return match[1] === parts.year && match[2] === parts.month && match[3] === parts.day;
  }
  function decRow(a, d) {
    const verdict = a === "auditor" ? (d.passed ? "pass" : "reject") : a === "analyst" ? num(d.score,0) : d.verdict || d.status || d.exit_reason || "";
    const reason = d.reason || d.setup_class || d.model || d.mode || "saved decision";
    const route = a === "auditor" ? `data-audit="${esc(d.symbol)}"` : d.symbol ? `data-symbol="${esc(d.symbol)}"` : "";
    return `<li><button class="row link" ${route}><div class="main"><div class="t">${esc(d.symbol || "—")}</div><div class="s">${esc(reason)} · ${fmtTime(d.ts || d.opened_at)}</div></div><div class="v">${esc(verdict)}</div><span class="chevron">›</span></button></li>`;
  }
  function renderAgents() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk agent-sk"></div>'.repeat(5)}</div>`; return; }
    const open = Number((S.state || {}).open_positions || (S.account || {}).open_positions || 0);
    view.innerHTML = `<div class="page"><div class="section-h"><span>Agents</span><span class="section-count">Plan B read-only</span></div>${AGENTS.map(a => {
      const status = ((S.state || {}).agents || {})[a] || "idle", decs = S.decisions[a] || [], count = decs.filter(d => isToday(d.ts || d.opened_at)).length;
      const locked = a === "risk" && open > 0, on = status !== "paused";
      return `<section class="fcard agent-${a}"><div class="hd"><span class="agent-dot" style="background:${COLOR[a]}"></span><span class="name">${NAMES[a]}</span><span class="sec num">${count} today</span>
        <button class="switch-hit" data-act="pause" data-agent="${a}" role="switch" aria-checked="${on}" aria-label="${on ? "Pause" : "Resume"} ${NAMES[a]}" ${locked ? 'aria-disabled="true"' : ""}><span class="switch ${on ? "on" : ""}" ${locked ? 'aria-disabled="true"' : ""}></span></button></div>
        <div class="agent-status"><span class="status-dot ${status === "paused" ? "paused" : status === "running" ? "running" : ""}"></span>${esc(status)}${locked ? ` · locked with ${open} open position${open === 1 ? "" : "s"}` : ""}</div>
        <ul class="rows dec">${decs.length ? decs.slice(0,20).map(d => decRow(a,d)).join("") : `<li class="empty small-empty">${a === "scanner" ? "Listening for candidates" : a === "auditor" ? "No symbol taken apart yet" : "No decisions yet"}</li>`}</ul>
        <button class="smallbtn" data-go="account">Read-only settings</button></section>`;
    }).join("")}<p class="note">Switches snap back. Pause and resume in desk chat (STEP 9).</p></div>`;
  }
  function setRow(label, value) {
    let val = value == null ? "–" : typeof value === "object" ? JSON.stringify(value) : value === true ? "true" : value === false ? "false" : String(value);
    return `<button class="row" data-act="readonly"><div class="main"><div class="t setting-key">${esc(label)}</div></div><span class="sec setting-value">${esc(val)}</span></button>`;
  }
  function settingGroup(title, obj) {
    return `<div class="group-h">${esc(title)}</div><div class="group">${Object.entries(obj || {}).filter(([k]) => !/token|key|secret|password|webhook/i.test(k)).map(([k,v]) => setRow(k,v)).join("") || '<p class="empty">No settings available</p>'}</div>`;
  }
  function renderAccount() {
    built = null;
    if (!S.loaded) { view.innerHTML = loadingCards(8); return; }
    const acc = S.account || {}, set = S.settings || {}, mode = acc.mode || (set.desk || {}).mode || "PAPER";
    view.innerHTML = `<div class="page"><div class="section-h"><span>Account</span><span class="section-count">Read-only</span></div>
      <div class="group"><div class="mode-row"><div class="main"><div class="t">Mode</div><div class="s">LIVE requires typing LIVE</div></div><div class="seg">${["PAPER","LIVE"].map(m => `<button data-act="mode" data-mode="${m}" aria-pressed="${mode === m}" class="${mode === m ? "on" : ""}">${m}</button>`).join("")}</div></div>
      <div class="row"><div class="main"><div class="t">Stack</div><div class="s">${isPaper() ? "PAPER starting balance" : "LIVE stack"}</div></div><span class="sec">${money(acc.stack)}</span></div>
      <button class="row link" data-act="profile"><div class="main"><div class="t">Broker profile</div><div class="s">${esc(brokerName())} · @${esc(handle())}</div></div><span class="chevron">›</span></button>
      <div class="row"><div class="main"><div class="t">Broker help</div><div class="s">External ${esc(brokerName())} site</div></div>${externalLink(acc.signup_url,"Open →","smallbtn")}</div>
      <div class="row"><div class="main"><div class="t">Notifier</div><div class="s">Alerts are sent by the desk</div></div><span class="green">${esc(acc.notifier || "–")} · ${esc(acc.notifier_status || "")}</span></div>
      <div class="row"><div class="main"><div class="t">Hosting</div><div class="s">Encrypted data branch; chat-controlled settings</div></div><span class="sec">Plan ${esc(acc.plan || "B")}</span></div></div>
      ${settingGroup("Desk", set.desk)}${settingGroup("Data", set.data)}${settingGroup("Session", set.session_windows)}
      ${settingGroup("Scanner", set.scanner)}${settingGroup("Auditor", set.auditor)}${settingGroup("Analyst", set.analyst)}
      ${settingGroup("Executor", set.executor)}${settingGroup("Risk", set.risk)}
      <p class="note">Settings are never changed by this app. Tap any value or mode to see the chat command reminder.</p></div>`;
  }

  function openLiveDialog() {
    S.liveDialog = true;
    const dialog = $("live-dialog");
    if (dialog.open) return;
    dialog.showModal(); $("live-input").value = ""; $("live-error").hidden = true;
    setTimeout(() => $("live-input").focus(), 50);
  }
  function closeLiveDialog(snap = true) {
    const d = $("live-dialog"); if (d && d.open) d.close();
    S.liveDialog = false;
    if (snap) toast(PLAN_B);
    const live = document.querySelector('[data-mode="LIVE"]'); if (live) { live.classList.remove("on"); live.setAttribute("aria-pressed","false"); }
  }
  function confirmLive() {
    if ($("live-input").value !== "LIVE") { $("live-error").hidden = false; return; }
    closeLiveDialog(true);
  }
  function openProfile() {
    const url = (S.account || {}).broker_profile_url || "";
    if (url.startsWith("#account/")) {
      $("profile-title").textContent = brokerName() + " · @" + handle();
      $("profile-dialog").showModal();
    } else if (url) toast("Broker profile link unavailable on this host.");
  }
  async function goSymbol(symbol) {
    if (!symbol) return;
    const request = ++S.screenRequest;
    S.screen = { type: "symbol", symbol, loading: true, data: null, audit: null, interval: "1m", error: null };
    built = null; render(); scrollTo(0,0);
    await loadScreenData(S.screen, request);
  }
  async function goAudit(symbol) {
    if (!symbol) return;
    const request = ++S.screenRequest;
    S.screen = { type: "auditor", symbol, loading: true, data: null, error: null };
    built = null; render(); scrollTo(0,0);
    await loadScreenData(S.screen, request);
  }
  async function loadScreenData(screen, request) {
    if (!screen || S.screen !== screen) return;
    const id = request || ++S.screenRequest;
    const type = screen.type, symbol = screen.symbol;
    try {
      const data = await get(`${type === "symbol" ? "symbol" : "audit"}/${encodeURIComponent(symbol)}.json`);
      if (S.screen !== screen || id !== S.screenRequest) return;
      screen.data = data; screen.error = null;
    } catch (e) { if (S.screen === screen && id === S.screenRequest) screen.error = e; }
    if (S.screen === screen && id === S.screenRequest) { screen.loading = false; render(); }
  }
  function renderDetail() {
    const s = S.screen;
    $("nav-title").textContent = s.type === "symbol" ? s.symbol : "Auditor";
    if (s.loading && !s.data) { view.innerHTML = loadingCards(8); return; }
    if (s.error && !s.data) {
      const missing = s.error.status === 404;
      view.innerHTML = emptyPage(missing ? (s.type === "auditor" ? "No audit yet" : "No symbol data yet") : (dataState() === "decrypt" ? "Cannot decrypt symbol data" : "Detail unavailable"),
        missing ? (s.type === "auditor" ? `${s.symbol} was stopped before Auditor, or Auditor has not run yet. No layers have been invented.` : `${s.symbol} has no persisted quote or bar snapshot yet.`) : "The desk could not provide this detail. Try again without losing the rest of your snapshot.",
        `<button class="btn" data-act="retry-detail">Try again</button>`); return;
    }
    if (s.type === "symbol") renderSymbol(s);
    else renderAuditor(s);
  }
  function renderSymbol(s) {
    const d = s.data || {}, q = d.quote || {}, stats = d.stats || {}, pos = d.position;
    const bars = ((d.bars || {})[s.interval] || {}), cs = bars.bars || [];
    const spreadLabel = stats.spread_bps == null ? "spread unchecked" : num(stats.spread_bps,1) + " bps";
    const action = d.action || (pos ? "Sell" : "Buy");
    const button = externalLink(d.broker_url, `${action} on ${brokerName()}`, `btn ${action === "Sell" ? "green" : ""}`);
    view.innerHTML = `<div class="page"><div class="coin-h"><span class="nm">${esc(d.symbol || s.symbol)}</span>${isPaper() ? '<span class="badge-paper">PAPER</span>' : ""}</div>
      <p class="symbol-name">${esc(d.name || "Symbol snapshot")}</p><div class="symbol-price num">${money(q.last)}</div>
      <div class="quote-note sec">${q.ts ? `Scanner quote · ${fmtTime(q.ts)}` : "No persisted quote yet"}</div>
      <div class="ranges symbol-ranges"><button data-bar="1m" class="${s.interval === "1m" ? "on" : ""}">1m · session</button><button data-bar="1d" class="${s.interval === "1d" ? "on" : ""}">1d · 3 months</button></div>
      <div class="candle-wrap"><canvas class="candles" id="candles"></canvas>${cs.length ? "" : `<div class="candles-empty">${bars.error ? "Yahoo bars unavailable" : "No candles returned"}<br><span>${esc(bars.error || "No replacement values shown")}</span></div>`}</div>
      <div class="chart-source sec">${bars.available ? `${esc(bars.provider || "Yahoo")} · ${cs.length} ${bars.provider === "fixture" ? "visual fixture" : "real"} ${s.interval} bars` : "Bars unavailable on the free source"}</div>
      <div class="stats"><div class="stat"><div class="k">20-day average dollar volume</div><div class="v">${compact(stats.adv_usd)}</div></div>
      <div class="stat"><div class="k">Spread</div><div class="v spread-value ${stats.spread_bps == null ? "orange" : ""}">${esc(spreadLabel)}</div></div>
      <div class="stat"><div class="k">Relative volume</div><div class="v">${finite(stats.rvol) ? num(stats.rvol)+"×" : "–"}</div></div>
      <div class="stat"><div class="k">Gap</div><div class="v">${pct(stats.gap_pct)}</div></div></div>
      ${pos ? `<section class="exitcard"><div class="section-h exit-h"><span>Position exit</span><span class="orange">Guarding</span></div>
        <div class="kv"><span class="sec">Entry</span><span>${money(pos.entry_price)}</span></div><div class="kv"><span class="sec">Current exit / stop</span><span class="orange">${money(pos.stop_price)}</span></div>
        <div class="kv"><span class="sec">Peak</span><span>${money(pos.peak_price)}</span></div><div class="kv"><span class="sec">Trailing</span><span>${pos.trail_active ? "active" : "not yet active"}</span></div>
        <p class="note">Orange dashed line: the latest stop saved by Risk. Sell opens your broker; it does not submit an order.</p></section>` : `<div class="empty-inline">No open PAPER position · no exit line to show</div>`}
      ${button}<p class="broker-note">Opens the desk-supplied ${esc(brokerName())} link. No order is placed by this app.</p>
      <button class="text-button" data-audit="${esc(s.symbol)}">View latest 8-layer audit →</button></div>`;
    DeskChart.candles($("candles"), cs.map(b => [b.ts,b.open,b.high,b.low,b.close,b.volume]), pos && finite(pos.stop_price) ? Number(pos.stop_price) : null);
  }
  function normalizeLayers(d) {
    const incoming = (d || {}).layers || [], byN = {};
    incoming.forEach(l => { byN[Number(l.n || l.layer)] = l; });
    return Array.from({length:8}, (_,i) => byN[i+1] || { n:i+1, name:["Listing & type","Halt / LULD / SSR","Float & locate","Dilution / SI","Liquidity & spread","Session timing","News / fraud flags","Metals / squeeze stress"][i], status:"not_checked", value:"not checked", ms:0 });
  }
  function renderAuditor(s) {
    const d = s.data || {}, layers = normalizeLayers(d);
    const red = layers.findIndex(l => l.status === "red");
    view.innerHTML = `<div class="page"><div class="coin-h"><span class="nm">Auditor</span><span class="pill">${esc(s.symbol)}</span></div>
      <div class="verdict ${d.passed ? "green" : "red"}">${d.passed ? "All 8 layers passed" : "Rejected"}</div>
      <p class="audit-reason">${esc(d.reason || (d.passed ? "Ready for Analyst" : "One red layer ends the check"))}</p><p class="note">${fmtTime(d.ts)} · ${red >= 0 ? "Stopped at first red; later layers were not checked." : "Eight ordered checks; no override."}</p>
      <div class="discs" id="discs"><div class="beam" id="beam" aria-hidden="true"></div>${layers.map((l,i) => `<div class="disc ${l.status === "red" ? "bad" : l.status === "ok" ? "ok" : "grey"}" data-disc="${i}"><span>${i+1}</span></div>`).join("")}</div>
      <div class="group audit-layers">${layers.map(l => `<div class="audit-layer ${l.status === "red" ? "failed" : ""}"><div class="layer-top"><span>${l.n}. ${esc(l.name)}</span><span class="mono">${finite(l.ms) ? Number(l.ms).toFixed(2) : "0.00"} ms</span></div><div class="layer-note">${esc(l.value || (l.status === "not_checked" ? "not checked" : l.status))}</div></div>`).join("")}</div>
      <button class="btn" data-symbol="${esc(s.symbol)}">Back to ${esc(s.symbol)}</button><p class="note spread-explain">“spread unchecked” is not a measured pass. Free quote data has no bid/ask; the approved PAPER policy applies.</p></div>`;
    animateBeam(!!d.passed);
  }
  function animateBeam(passed) {
    const beam = $("beam"), discs = [...document.querySelectorAll("[data-disc]")];
    if (!beam || !discs.length) return;
    const indexes = discs.map((el,i) => ({el,i})).filter(x => !x.el.classList.contains("grey") || passed).map(x => x.i);
    if (!indexes.length) { beam.hidden = true; return; }
    const move = i => { const r = discs[i].getBoundingClientRect(), p = $("discs").getBoundingClientRect(); beam.style.top = (r.top-p.top)+"px"; beam.style.height = r.height+"px"; };
    if (reduced()) { move(indexes[indexes.length-1]); beam.classList.add("visible"); return; }
    let step = 0;
    const next = () => {
      if (!S.screen || S.screen.type !== "auditor" || !document.contains(beam)) return;
      move(indexes[step]); beam.classList.add("visible");
      if (++step < indexes.length) setTimeout(next, 360);
    };
    setTimeout(next, 120);
  }

  document.addEventListener("click", async e => {
    if (e.target.closest("[data-external]")) { e.stopPropagation(); return; }
    const t = e.target.closest("[data-tab],[data-go],[data-act],[data-range],[data-symbol],[data-audit],[data-bar]");
    if (!t) return;
    if (t.dataset.tab) go(t.dataset.tab);
    else if (t.dataset.go) go(t.dataset.go);
    else if (t.dataset.symbol) await goSymbol(t.dataset.symbol);
    else if (t.dataset.audit) await goAudit(t.dataset.audit);
    else if (t.dataset.bar) { if (S.screen) { S.screen.interval = t.dataset.bar; render(); } }
    else if (t.dataset.range) {
      S.range = t.dataset.range;
      try { S.chart = await get(`chart/${S.range}.json`); S.error = null; } catch (err) { S.error = err; }
      renderStatus(); render();
    } else if (t.dataset.act === "pause") {
      const sw = t.querySelector(".switch"), original = sw.classList.contains("on"), agent = t.dataset.agent;
      if (sw.getAttribute("aria-disabled") === "true") { toast("Risk can't be paused while a position is open."); return; }
      sw.classList.toggle("on", !original); t.setAttribute("aria-checked", String(!original));
      setTimeout(() => { sw.classList.toggle("on", original); t.setAttribute("aria-checked",String(original)); toast(PLAN_B); }, 260);
    } else if (t.dataset.act === "mode") {
      if (t.dataset.mode === "LIVE") {
        // Only the dialog may be LIVE-highlighted. Published mode remains unchanged.
        t.classList.add("pending"); openLiveDialog();
      } else toast(PLAN_B);
    } else if (t.dataset.act === "live-confirm") confirmLive();
    else if (t.dataset.act === "live-cancel") closeLiveDialog(true);
    else if (t.dataset.act === "readonly") toast(PLAN_B);
    else if (t.dataset.act === "profile") openProfile();
    else if (t.dataset.act === "profile-close") $("profile-dialog").close();
    else if (t.dataset.act === "retry") location.reload();
    else if (t.dataset.act === "retry-detail") { S.screen.loading = true; S.screen.error = null; render(); loadScreenData(S.screen); }
  });
  $("nav-avatar").onclick = () => go("account");
  $("nav-title").onclick = () => go("home");
  $("nav-back").onclick = () => go("activity");
  $("nav-bell").onclick = () => toast("Notifications arrive in Discord. No new in-app alerts.");
  $("nav-search").onclick = () => { const bar=$("search-bar"); bar.hidden=!bar.hidden; if(!bar.hidden) $("search-input").focus(); };
  $("search-input").oninput = () => {
    const q = $("search-input").value.trim().toUpperCase();
    const saved = ((S.state || {}).symbols || []), watch = (((S.settings || {}).scanner || {}).watchlists) || [];
    const list = [...new Set([...saved, ...watch])].filter(s => s.includes(q)).slice(0,12);
    $("search-results").innerHTML = !q ? "" : list.length ? list.map(s => `<li><button class="row link" data-symbol="${esc(s)}"><div class="main"><div class="t">${esc(s)}</div><div class="s">${saved.includes(s) ? "Saved desk snapshot" : "Watchlist · bars when available"}</div></div><span class="chevron">›</span></button></li>`).join("") : '<li class="empty">No matching watchlist symbols</li>';
  };
  $("live-input").addEventListener("keydown", e => { if (e.key === "Enter") confirmLive(); });
  $("live-dialog").addEventListener("cancel", e => { e.preventDefault(); closeLiveDialog(true); });
  $("live-dialog").addEventListener("click", e => { if (e.target === $("live-dialog")) closeLiveDialog(true); });
  $("profile-dialog").addEventListener("click", e => { if (e.target === $("profile-dialog")) $("profile-dialog").close(); });
  addEventListener("resize", () => { if (S.screen && S.screen.data) render(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  renderStatus(); poll();
})();
