// STEP 8 charts on <canvas>, devicePixelRatio aware. No data is ever invented here.
(function () {
  const C = { green: "#00d35a", red: "#ff453a", blue: "#0a84ff", orange: "#ff9f0a", sep: "rgba(84,84,88,0.55)",
    sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", card2: "#2c2c2e" };
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FONT = '13px "SF Pro Text",-apple-system,system-ui,sans-serif';

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    return { c, w, h };
  }

  // ---- Home line: #00d35a, gradient fill under the line, dashed start line, marks above the line.
  const lineState = new WeakMap();
  function line(canvas, points, marks, opts) {
    opts = opts || {};
    const prev = lineState.get(canvas) || { n: 0, markKeys: new Set() };
    const grew = points.length > prev.n && prev.n > 0 && !reduced();
    const newMarks = (marks || []).filter(m => !prev.markKeys.has(m.key));
    lineState.set(canvas, { n: points.length, markKeys: new Set((marks || []).map(m => m.key)) });
    const t0 = performance.now();
    const frame = now => {
      const k = grew ? Math.min(1, (now - t0) / 250) : 1;            // new point slides in over 250ms
      const mk = reduced() ? 1 : Math.min(1, (now - t0) / 200);      // marks fade in over 200ms
      drawLine(canvas, points, marks || [], opts, k, mk, new Set(newMarks.map(m => m.key)));
      if (k < 1 || mk < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function drawLine(canvas, points, marks, opts, k, mk, fresh) {
    const { c, w, h } = setup(canvas);
    const top = 84, bottom = h - 12;
    if (!points || points.length === 0) {           // empty: dashed start line only
      c.strokeStyle = C.ter; c.setLineDash([4, 4]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, (top + bottom) / 2); c.lineTo(w, (top + bottom) / 2); c.stroke(); c.setLineDash([]);
      return;
    }
    const start = opts.startValue != null ? opts.startValue : points[0][1];
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]).concat([start]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 === x0) { x0 -= 30; x1 += 30; }
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { lo -= 1; hi += 1; }
    const n = points.length;
    // slide: the last point travels from the previous x to its own x
    const X = (t, i) => {
      const base = (t - x0) / (x1 - x0) * w;
      if (k < 1 && i === n - 1 && n > 1) { const px = (points[n - 2][0] - x0) / (x1 - x0) * w; return px + (base - px) * k; }
      return base;
    };
    const Y = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
    // dashed line at the start value
    c.strokeStyle = C.ter; c.setLineDash([4, 4]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, Y(start)); c.lineTo(w, Y(start)); c.stroke(); c.setLineDash([]);
    // gradient fill under the line
    const g = c.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
    c.beginPath(); points.forEach((p, i) => i ? c.lineTo(X(p[0], i), Y(p[1])) : c.moveTo(X(p[0], i), Y(p[1])));
    c.lineTo(X(points[n - 1][0], n - 1), bottom); c.lineTo(X(points[0][0], 0), bottom); c.closePath();
    c.fillStyle = g; c.fill();
    c.beginPath(); points.forEach((p, i) => i ? c.lineTo(X(p[0], i), Y(p[1])) : c.moveTo(X(p[0], i), Y(p[1])));
    c.strokeStyle = C.green; c.lineWidth = 2; c.lineJoin = "round"; c.stroke();
    // marks above the line; never overlap: a later mark moves up a row
    c.font = FONT; c.textBaseline = "middle";
    const rows = [];
    marks.slice().sort((a, b) => a.ts - b.ts).forEach(m => {
      if (m.ts < x0 || m.ts > x1) return;
      const mx = (m.ts - x0) / (x1 - x0) * w, tw = c.measureText(m.label).width + 16;
      const left = Math.max(0, Math.min(w - tw, mx - tw / 2));
      let row = 0;
      while ((rows[row] || []).some(([a, b]) => left < b + 4 && left + tw > a - 4)) row++;
      (rows[row] = rows[row] || []).push([left, left + tw]);
      const yy = Math.max(12, top - 14 - row * 24);   // row 0 just above the plot, a later mark moves up a row
      c.globalAlpha = fresh.has(m.key) ? mk : 1;
      c.fillStyle = "#1c1c1e"; roundRect(c, left, yy - 10, tw, 20, 10); c.fill();
      c.fillStyle = m.color; c.fillText(m.label, left + 8, yy);
      c.globalAlpha = 1;
    });
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---- Coin candles: 1-minute OHLC [t,o,h,l,c,volume_m5]; volume bar = change of volume.m5
  function candles(canvas, cs, exitLine) {
    const { c, w, h } = setup(canvas);
    const vh = 50, top = 10, bottom = h - vh - 10;
    if (!cs || !cs.length) {
      c.fillStyle = C.sec; c.font = FONT; c.textAlign = "center"; c.fillText("No candles yet", w / 2, h / 2); c.textAlign = "left";
      return;
    }
    const vals = cs.flatMap(k => [k[2], k[3]]).concat(exitLine != null ? [exitLine] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi *= 1.01; lo *= 0.99; }
    const Y = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
    const n = cs.length, step = w / Math.max(n, 20), bw = Math.max(2, step * 0.6);
    const dv = cs.map((k, i) => i && k[5] != null && cs[i - 1][5] != null ? Math.max(0, k[5] - cs[i - 1][5]) : 0);
    const vmax = Math.max(1, ...dv);
    cs.forEach((k, i) => {
      const x = w - (n - i) * step + step / 2, up = k[4] >= k[1], col = up ? C.green : C.red;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, Y(k[2])); c.lineTo(x, Y(k[3])); c.stroke();
      const yo = Y(k[1]), yc = Y(k[4]);
      c.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      const vb = dv[i] / vmax * (vh - 4);
      c.globalAlpha = 0.5; c.fillRect(x - bw / 2, h - 4 - vb, bw, vb); c.globalAlpha = 1;
    });
    if (exitLine != null) {   // orange dashed "Risk trailing stop" at the current exit line
      c.strokeStyle = C.orange; c.setLineDash([6, 4]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, Y(exitLine)); c.lineTo(w, Y(exitLine)); c.stroke(); c.setLineDash([]);
      c.fillStyle = C.orange; c.font = FONT; const ly = Y(exitLine); c.textBaseline = ly < 20 ? "top" : "bottom"; c.fillText("Risk trailing stop", 4, ly < 20 ? ly + 3 : ly - 3); c.textBaseline = "alphabetic";
    }
  }

  // ---- Analyst score ring 0-100, green from the gate score
  function ring(canvas, score, green) {
    const { c, w, h } = setup(canvas);
    const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    c.lineWidth = 10; c.lineCap = "round";
    c.strokeStyle = C.card2; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    if (score != null) {
      c.strokeStyle = green ? C.green : "#ffd60a";
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, score)) / 100); c.stroke();
    }
    c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
    c.font = '600 34px "SF Pro Display",-apple-system,system-ui,sans-serif';
    c.fillText(score == null ? "–" : String(score), cx, cy); c.textAlign = "left";
  }

  window.DeskChart = { line, candles, ring, draw: (cv, pts) => line(cv, pts || [], []) };
})();
