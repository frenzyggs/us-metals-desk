// US Metals Desk — Plan B shell (GitHub Pages + encrypted data branch).
// #d=DATA_PATH&k=DATA_KEY in the URL fragment only (never query string; k never persisted).
// Data: raw.githubusercontent.com/.../data/d/{D}/… AES-GCM envelopes {v,n,c}.
// Broker URLs come only from published JSON (links.py on the desk).
(function () {
  "use strict";
  const STORE_D = "desk_us_d";
  const PLAN_B = "Not saved: change it in the desk chat (STEP 9)";
  const PUSH_INTERVAL_S = 180;          // data branch force-push cadence
  const STALE_AFTER_S = PUSH_INTERVAL_S * 4; // 12 minutes
  const DEFAULT_POLL_S = 60;
  const GH_RAW = "https://raw.githubusercontent.com/frenzyggs/us-metals-desk/data/";

  function appCookiePath() {
    const path = location.pathname;
    return (path.endsWith("/") ? path : path.replace(/[^/]+$/, "")) || "/";
  }
  function readStore(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeStore(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  function readCookie(name) {
    const prefix = name + "=";
    const parts = document.cookie ? document.cookie.split("; ") : [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].lastIndexOf(prefix, 0) === 0) {
        try { return decodeURIComponent(parts[i].slice(prefix.length)); } catch (e) { return null; }
      }
    }
    return null;
  }
  function writeCookie(name, value) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = name + "=" + encodeURIComponent(value) + "; Path=" + appCookiePath() +
      "; Max-Age=31536000; SameSite=Lax" + secure;
  }
  function remember(key, value) { if (!value) return; writeStore(key, value); writeCookie(key, value); }
  function recall(key) {
    const local = readStore(key), baked = readCookie(key);
    if (local) { if (local !== baked) writeCookie(key, local); return local; }
    if (baked) { writeStore(key, baked); return baked; }
    return null;
  }

  const h = new URLSearchParams(location.hash.slice(1));
  const hashD = h.get("d");
  const hashK = h.get("k"); // AES key — fragment only, never localStorage/cookie
  if (hashD) remember(STORE_D, hashD);
  const D = hashD || recall(STORE_D);
  let K = hashK || null; // session-only
  if (D && (!hashD || (K && !h.get("k")))) {
    const next = new URLSearchParams();
    next.set("d", D);
    if (K) next.set("k", K);
    history.replaceState(null, "", location.pathname + location.search + "#" + next.toString());
  }

  function b64ToBytes(s) {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function importKey(kB64) {
    const raw = b64ToBytes(kB64);
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  }
  async function decryptEnvelope(env, key) {
    if (!env || env.v !== 1 || !env.n || !env.c) throw new Error("bad envelope");
    const iv = b64ToBytes(env.n);
    const ct = b64ToBytes(env.c);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  const onPages = /github\.io$/i.test(location.hostname);
  function fileUrl(f) {
    const q = "?_=" + Date.now();
    if (onPages) {
      return GH_RAW + "d/" + encodeURIComponent(D) + "/" + f + q;
    }
    return new URL("d/" + encodeURIComponent(D) + "/" + f + q, new URL("./", location.href)).toString();
  }
  let _cryptoKey = null;
  async function getKey() {
    if (!K) throw Object.assign(new Error("missing k"), { status: 401 });
    if (!_cryptoKey) _cryptoKey = await importKey(K);
    return _cryptoKey;
  }
  async function get(f) {
    const r = await fetch(fileUrl(f), { cache: "no-store" });
    if (!r.ok) { const e = new Error(String(r.status)); e.status = r.status; throw e; }
    const body = await r.json();
    // ciphertext envelope or legacy plaintext (local smoke)
    if (body && body.v === 1 && body.n && body.c) {
      return decryptEnvelope(body, await getKey());
    }
    return body;
  }
  async function tryGet(f) { try { return await get(f); } catch (e) { if (e.status === 404) return null; throw e; } }

  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const NAMES = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
  const COLOR = { scanner: "var(--cyan)", auditor: "var(--text)", analyst: "var(--yellow)", executor: "var(--green)", risk: "var(--pink)" };
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const S = {
    loaded: false, error: false, lastGood: null, nextPoll: 0, poll: DEFAULT_POLL_S,
    state: null, chart: null, activity: null, account: null, settings: null,
    decisions: {}, range: "LIVE", tab: "home", screen: null,
  };
  let built = null;

  const $ = id => document.getElementById(id);
  const view = $("view");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = v => v == null || v === "" ? "–" :
    "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
  const isPaper = () => ((S.state && S.state.mode) || (S.account && S.account.mode) || "PAPER") === "PAPER";
  const brokerName = () => {
    const b = (S.state && S.state.broker) || (S.account && S.account.broker) || "tradingview";
    return b === "tradingview" ? "TradingView" : String(b);
  };
  const handle = () => (S.state && S.state.broker_handle) || (S.account && S.account.broker_handle) || "ValHD";

  function activityRows() {
    const a = S.activity || {};
    return a.rows || a.items || [];
  }

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function setOdo(el, text) {
    if (!el) return;
    if (el.dataset.len === String(text.length) && el.textContent.replace(/\s/g, "") === text.replace(/\s/g, "")) return;
    el.dataset.len = String(text.length);
    el.textContent = text;
  }

  // Day boundary 17:00 Europe/Amsterdam
  function dayStart(nowSec) {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(nowSec * 1000)).reduce((o, x) => (o[x.type] = +x.value, o), {});
    const mins = p.hour * 60 + p.minute;
    const since17 = ((mins - 17 * 60) + 24 * 60) % (24 * 60);
    return nowSec - (since17 * 60 + p.second);
  }

  async function poll() {
    if (!D) { S.loaded = false; S.error = true; render(); return; }
    try {
      const st = await get("state.json");
      S.poll = st.poll_seconds || ((S.settings && S.settings.publish && S.settings.publish.interval_s) || DEFAULT_POLL_S);
      const [ch, act, acc, set, ...dec] = await Promise.all([
        get(`chart/${S.range}.json`).catch(() => get("chart.json")),
        get("activity.json"),
        get("account.json"),
        get("settings.json"),
        ...AGENTS.map(a => tryGet(`agents/${a}/decisions.json`)),
      ]);
      AGENTS.forEach((a, i) => {
        const payload = dec[i];
        S.decisions[a] = (payload && (payload.decisions || payload.items)) || [];
      });
      Object.assign(S, { state: st, chart: ch, activity: act, account: acc, settings: set, loaded: true, error: false });
      const hb = Number(st.heartbeat_ts != null ? st.heartbeat_ts : st.heartbeat);
      if (Number.isFinite(hb)) S.lastGood = hb > 1e12 ? hb / 1000 : hb;
      else if (st.heartbeat_iso) {
        const t = Date.parse(st.heartbeat_iso);
        if (Number.isFinite(t)) S.lastGood = t / 1000;
      }
    } catch (e) {
      S.error = true;
    }
    S.nextPoll = Date.now() + S.poll * 1000;
    render();
    setTimeout(poll, S.poll * 1000);
  }

  function renderError() {
    const row = $("error-row");
    const snap = $("snapshot-row");
    const now = Date.now() / 1000;
    const stale = S.loaded && Number.isFinite(S.lastGood) &&
      (now - S.lastGood) > Math.max(STALE_AFTER_S, S.poll * 4);
    const offline = !D || (onPages && !K) || S.error || stale;
    if (offline) {
      row.hidden = false;
      const n = Math.max(1, Math.ceil((S.nextPoll - Date.now()) / 1000));
      const when = S.lastGood ? new Date(S.lastGood * 1000).toLocaleTimeString() : "never";
      if (!D) row.textContent = "Desk offline · add #d=…&k=… fragment (Plan B)";
      else if (!K) row.textContent = "Desk offline · missing decryption key (#k=…)";
      else if (S.error) row.textContent = `Desk offline · retrying in ${n}s · last update ${when}`;
      else row.textContent = `Desk offline · publish stale · last update ${when}`;
    } else row.hidden = true;
    if (S.loaded && S.lastGood && !offline) {
      snap.hidden = false;
      snap.textContent = "Updated " + new Date(S.lastGood * 1000).toLocaleTimeString();
    } else snap.hidden = true;
  }

  function go(tab) { S.tab = tab; S.screen = null; built = null; render(); scrollTo(0, 0); }

  function render() {
    renderError();
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
    $("bell-dot").hidden = true;
    const av = $("nav-avatar");
    if (av) av.textContent = (handle().slice(0, 1) || "V").toUpperCase();
    if (!D) {
      view.innerHTML = `<div class="page"><p class="empty">Open with the private link fragment <span class="mono">#d=…&amp;k=…</span> from the desk. The key stays in the fragment only.</p></div>`;
      return;
    }
    if (S.tab === "home") renderHome();
    else if (S.tab === "agents") renderAgents();
    else if (S.tab === "activity") renderActivity();
    else if (S.tab === "account") renderAccount();
  }

  function stackValue() {
    const st = S.state || {}, acc = S.account || {};
    return st.stack != null ? st.stack : (acc.stack != null ? acc.stack : null);
  }

  function todayAndMult() {
    const st = S.state || {};
    const today = st.today_pnl_pct != null ? Number(st.today_pnl_pct) : 0;
    const mult = st.multiplier != null ? Number(st.multiplier) : 1;
    return { today, mult };
  }

  function chartPoints() {
    const pts = (S.chart && (S.chart.points || S.chart.series)) || [];
    return pts.map(p => {
      if (Array.isArray(p)) return [p[0], p[1]];
      const t = p.t != null ? p.t : p.ts;
      const v = p.v != null ? p.v : p.value;
      return [t > 1e12 ? t / 1000 : t, v];
    }).filter(p => p[0] != null && p[1] != null);
  }

  function chartMarks() {
    return ((S.chart && S.chart.marks) || []).map((m, i) => {
      let label = m.label || m.kind || "mark", color = "#0a84ff";
      if (m.kind === "bought" || /bought/i.test(label)) { color = "#0a84ff"; label = label.startsWith("Bought") ? label : "Bought " + (m.symbol || ""); }
      else if (m.kind === "sold" || /sold/i.test(label)) color = "#00d35a";
      else if (m.kind === "stopped" || /stop/i.test(label)) color = "#ff453a";
      const ts = m.ts > 1e12 ? m.ts / 1000 : m.ts;
      return { ts, label, color, key: (m.key || (m.kind + (m.symbol || "") + ts + i)) };
    });
  }

  function renderHome() {
    if (!S.loaded) {
      view.innerHTML = `<div class="page"><div class="sk big-sk"></div><div class="sk line-sk"></div><div class="sk card-sk"></div>${'<div class="sk row-sk"></div>'.repeat(5)}</div>`;
      built = null; return;
    }
    if (built !== "home") {
      view.innerHTML = `<div class="page">
        <div class="balance-row"><span class="big odo" id="bal"></span><span id="paper"></span></div>
        <div class="today" id="today"></div>
        <div class="chart-wrap"><canvas class="line" id="line"></canvas><div class="chart-empty" id="chart-empty" hidden>Waiting for the first trade</div></div>
        <div class="ranges" id="ranges">${RANGES.map(r => `<button class="tap" data-range="${r}">${r}</button>`).join("")}</div>
        <div class="section-h"><span id="agents-h">Agents</span></div>
        <div class="carousel" id="carousel"></div>
        <div class="section-h"><span>Activity</span><button data-go="activity">See all</button></div>
        <ul class="rows" id="home-act"></ul></div>`;
      built = "home";
      $("ranges").onclick = async e => {
        const r = e.target.dataset.range; if (!r) return;
        S.range = r;
        try { S.chart = await get(`chart/${r}.json`); } catch (err) { S.error = true; }
        render();
      };
    }
    const bal = stackValue();
    if (bal == null) { $("bal").textContent = "$–"; delete $("bal").dataset.len; }
    else setOdo($("bal"), money(bal));
    $("paper").innerHTML = isPaper() ? `<span class="badge-paper">PAPER</span>` : "";
    const tm = todayAndMult();
    $("today").innerHTML =
      `<span class="${tm.today >= 0 ? "green" : "red"}">${pct(tm.today)}</span>` +
      `<span class="mult">${tm.mult.toFixed(2)}×</span>`;
    document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.range === S.range));
    const pts = chartPoints();
    $("chart-empty").hidden = pts.length > 0;
    const start = pts.length ? pts[0][1] : bal;
    DeskChart.line($("line"), pts, chartMarks(), { startValue: start });
    const agents = (S.state && S.state.agents) || {};
    const running = Object.values(agents).filter(v => v === "running" || v === "idle").length;
    $("agents-h").textContent = `Agents · ${running} ready`;
    const sl = $("carousel").scrollLeft;
    $("carousel").innerHTML = AGENTS.map(cardHTML).join("");
    $("carousel").scrollLeft = sl;
    afterCards();
    const items = activityRows().slice(0, 5);
    $("home-act").innerHTML = items.length ? items.map(actRow).join("") :
      `<li class="empty">Nothing yet — candidates will show here</li>`;
  }

  function cardHTML(a) {
    const head = `<div class="who"><i style="background:${COLOR[a]}"></i>${NAMES[a]}</div>`;
    let title = "", body = "", foot = "";
    if (a === "scanner") {
      title = "Watching";
      const feed = ((S.state && S.state.feed) || []).slice(-4).reverse();
      body = feed.length
        ? `<ul class="feed">${feed.map(f => `<li class="passed"><span class="n">${esc(f.text || f.symbol || "")}</span><span class="r">→ auditor</span></li>`).join("")}</ul>`
        : `<p class="sec">Listening for candidates</p>`;
    } else if (a === "auditor") {
      title = "Clear";
      body = `<div class="strips">${[1,2,3,4,5,6,7,8].map(n => `<div class="strip-l">${n}</div>`).join("")}</div>
        <div><span class="sec">No symbol taken apart yet</span></div>`;
    } else if (a === "analyst") {
      title = "Score";
      body = `<canvas class="ring" id="ring"></canvas>`;
    } else if (a === "executor") {
      title = "Ready";
      body = `<p class="sec">No trade yet — Buy on ${esc(brokerName())} when a setup clears</p>`;
    } else if (a === "risk") {
      title = "Nothing open";
      body = `<div style="display:flex;gap:8px;flex-wrap:wrap">
        <span class="pill mono">stop —</span><span class="pill mono">trail —</span></div>`;
    }
    return `<div class="acard" data-go="agents">${head}<h3>${esc(title)}</h3><div class="body">${body}</div><div class="foot">${foot}</div></div>`;
  }

  function afterCards() {
    const ring = $("ring");
    if (ring) DeskChart.ring(ring, null, false);
  }

  function actRow(it) {
    const title = it.title || it.kind || "event";
    const sub = it.subtitle || [it.agent, it.symbol].filter(Boolean).join(" · ");
    const val = it.value || "";
    const cls = /sold/i.test(it.kind || "") ? "green" : /stop/i.test(it.kind || "") ? "red" : "";
    return `<li class="row"><div class="main"><div class="t">${esc(title)}</div>
      <div class="s">${esc(sub)}</div></div><div class="v ${cls}">${esc(val)}</div></li>`;
  }

  function renderActivity() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk row-sk"></div>'.repeat(8)}</div>`; return; }
    const items = activityRows();
    view.innerHTML = `<div class="page"><div class="section-h"><span>Activity</span></div>
      <ul class="rows">${items.length ? items.map(actRow).join("") :
        `<li class="empty">Nothing yet — rejects and fills land here</li>`}</ul></div>`;
  }

  function decRow(a, d) {
    const sym = d.symbol || d.name || "—";
    const reason = d.reason || d.status || d.exit_reason || "";
    const verdict = d.verdict || (d.pass === true ? "pass" : d.pass === false ? "reject" : "") || "";
    return `<li class="row"><div class="main"><div class="t">${esc(sym)}</div>
      <div class="s">${esc(reason)}</div></div><div class="v">${esc(verdict)}</div></li>`;
  }

  function renderAgents() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk card-sk"></div>'.repeat(5)}</div>`; return; }
    const open = 0;
    view.innerHTML = `<div class="page">` + AGENTS.map(a => {
      const status = ((S.state && S.state.agents) || {})[a] || "idle";
      const decs = S.decisions[a] || [];
      const locked = a === "risk" && open > 0;
      const empty = a === "scanner" ? "Listening for candidates"
        : a === "auditor" ? "No symbol taken apart yet" : "Nothing yet tonight";
      return `<section class="fcard"><div class="hd"><span class="status-dot ${status === "paused" ? "paused" : "running"}"></span>
        <span class="name">${NAMES[a]}</span>
        <span class="sec num">${decs.length} today</span>
        <button class="switch-hit" data-act="pause" data-agent="${a}" aria-label="Pause or resume ${NAMES[a]}">
          <span class="switch ${status === "paused" ? "" : "on"}" ${locked ? 'aria-disabled="true"' : ""}></span>
        </button></div>
        <div class="sec" style="font-size:13px">${esc(status)}${locked ? " · locked while a position is open" : ""}</div>
        <ul class="rows dec">${decs.length ? decs.slice(0, 20).map(d => decRow(a, d)).join("") :
          `<li class="empty">${empty}</li>`}</ul>
        <button class="smallbtn" data-go="account">Settings</button></section>`;
    }).join("") + `</div>`;
  }

  function settingGroup(title, rows) {
    return `<div class="group-h">${esc(title)}</div><div class="group">${rows}</div>`;
  }
  function setRow(label, value) {
    return `<div class="row" data-act="readonly"><div class="main"><div class="t">${esc(label)}</div></div>
      <span class="sec">${esc(value)}</span></div>`;
  }

  function renderAccount() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk row-sk"></div>'.repeat(6)}</div>`; return; }
    const acc = S.account || {};
    const set = S.settings || {};
    const desk = set.desk || {};
    const scan = set.scanner || {};
    const risk = set.risk || {};
    const mode = acc.mode || desk.mode || "PAPER";
    view.innerHTML = `<div class="page">
      <div class="section-h"><span>Account</span></div>
      <div class="group">
        <div class="row"><div class="main"><div class="t">Mode</div><div class="s">LIVE requires typing LIVE in desk chat</div></div>
          <div class="seg">${["PAPER", "LIVE"].map(m =>
            `<button data-act="mode" data-mode="${m}" class="${mode === m ? "on" : ""}">${m}</button>`).join("")}</div></div>
        <div class="row" id="live-confirm" hidden>
          <input class="field" id="live-input" placeholder="Type LIVE" autocomplete="off">
          <button class="smallbtn" data-act="liveConfirm">Confirm</button></div>
        <div class="row"><div class="main"><div class="t">Stack</div>
          <div class="s">${mode === "LIVE" ? "Set with “stack N” in chat" : "PAPER balance"}</div></div>
          <span class="sec">${money(acc.stack != null ? acc.stack : desk.paper_start_stack)}</span></div>
        <div class="row"><div class="main"><div class="t">Broker</div>
          <div class="s">Open / Buy / Sell on ${esc(brokerName())}</div></div>
          <span class="sec">${esc(handle())}</span></div>
        <div class="row"><div class="main"><div class="t">Notifier</div></div>
          <span class="sec">${esc(acc.notifier || desk.notifier || "—")}</span></div>
        <div class="row"><div class="main"><div class="t">Plan</div>
          <div class="s">Settings are read-only here</div></div>
          <span class="sec">${esc(acc.plan || "B")}</span></div>
      </div>
      ${settingGroup("Scanner", [
        setRow("min_price_usd", scan.min_price_usd),
        setRow("min_adv_usd", scan.min_adv_usd),
        setRow("max_spread_bps", scan.max_spread_bps),
        setRow("min_rvol", scan.min_rvol),
        setRow("spread_unknown_policy", (scan.spread_unknown_policy && scan.spread_unknown_policy.enabled) ? "on · " + (scan.spread_unknown_policy.tag || "") : "off"),
      ].join(""))}
      ${settingGroup("Risk", [
        setRow("stop_pct", risk.stop_pct),
        setRow("trail_on_pct", risk.trail_on_pct),
        setRow("trail_giveback_pct", risk.trail_giveback_pct),
        setRow("daily_loss_limit_pct", risk.daily_loss_limit_pct),
      ].join(""))}
      <p class="note">Toggles snap back on Plan B. Change settings in the desk chat (STEP 9).</p>
    </div>`;
  }

  // events
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab],[data-go],[data-act],[data-range]");
    if (!t) return;
    if (t.dataset.tab) go(t.dataset.tab);
    else if (t.dataset.go) go(t.dataset.go);
    else if (t.dataset.act === "pause") {
      const sw = t.querySelector(".switch");
      if (!sw) return;
      if (sw.getAttribute("aria-disabled") === "true") { toast("Risk can't be paused while a position is open."); return; }
      sw.classList.toggle("on");
      setTimeout(() => { sw.classList.toggle("on"); toast(PLAN_B); }, 250);
    } else if (t.dataset.act === "mode") {
      if (t.dataset.mode === "LIVE") {
        const box = $("live-confirm"); if (box) { box.hidden = false; $("live-input").focus(); }
      } else toast(PLAN_B);
    } else if (t.dataset.act === "liveConfirm") {
      if (($("live-input") || {}).value !== "LIVE") { toast("Type LIVE to confirm."); return; }
      $("live-input").value = ""; $("live-confirm").hidden = true; toast(PLAN_B);
    } else if (t.dataset.act === "readonly") {
      toast(PLAN_B);
    }
  });
  $("nav-avatar").onclick = () => go("account");
  $("nav-title").onclick = () => go("home");
  $("nav-search").onclick = () => {
    const bar = $("search-bar");
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("search-input").focus();
  };
  $("search-input").oninput = () => {
    const q = $("search-input").value.trim().toUpperCase();
    const wl = ((((S.settings || {}).scanner) || {}).watchlists) || [];
    const hits = q ? wl.filter(s => s.includes(q)).slice(0, 12) : [];
    $("search-results").innerHTML = hits.map(s =>
      `<li class="row"><div class="main"><div class="t">${esc(s)}</div><div class="s">Watchlist · Open on ${esc(brokerName())}</div></div></li>`
    ).join("") || (q ? `<li class="empty">No symbols</li>` : "");
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  poll();
})();
