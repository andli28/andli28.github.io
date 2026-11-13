// Interactive simulation for <IterativeBatching />.
// Ported from a standalone page: everything is looked up inside `root`, so the
// widget can't collide with the rest of the site.

const NS = "http://www.w3.org/2000/svg";
const BASE = { 128: { P: 41, S1: 34 }, 1536: { P: 413, S1: 40 } };

export function mountIterativeBatching(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const uid = Math.random().toString(36).slice(2, 8);
  const $ = id => root.querySelector(`[data-ib="${id}"]`);
  const st = {
    arrival: "burst",
    prompt: 128,
    tokens: 64,
    m4: 1.14,
    speed: 1,
    t: 0,
    playing: false,
  };
  let sims = null;
  let xMax = 1;
  const views = {};

  function fmt(ms) {
    if (ms < 1000) return Math.round(ms) + " ms";
    return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + " s";
  }
  function stepCost(b) {
    const S1 = BASE[st.prompt].S1;
    return S1 * (1 + ((st.m4 - 1) * (b - 1)) / 3);
  }

  function simulate(maxB) {
    const P = BASE[st.prompt].P,
      N = 4,
      T = st.tokens;
    const cl = [];
    for (let i = 0; i < N; i++)
      cl.push({
        id: i,
        arr: st.arrival === "burst" ? 0 : i * 100,
        tok: [],
        ps: null,
        pe: null,
        end: null,
      });
    const ev = [];
    let t = 0;
    const waiting = cl.slice();
    let active = [];
    let guard = 0;
    while ((waiting.length || active.length) && guard++ < 10000) {
      while (waiting.length && active.length < maxB && waiting[0].arr <= t) {
        const c = waiting.shift();
        c.ps = t;
        ev.push({ type: "prefill", t0: t, t1: t + P, c: c.id });
        t += P;
        c.pe = t;
        c.tok.push(t);
        active.push(c);
      }
      if (!active.length) {
        t = waiting[0].arr;
        continue;
      }
      const b = active.length,
        dt = stepCost(b),
        t0 = t;
      t += dt;
      ev.push({ type: "step", t0, t1: t, b, members: active.map(c => c.id) });
      active.forEach(c => c.tok.push(t));
      active = active.filter(c => {
        if (c.tok.length >= T + 1) {
          c.end = t;
          return false;
        }
        return true;
      });
    }
    const ttft = cl.map(c => c.tok[0] - c.arr).sort((a, b) => a - b);
    const gaps = [];
    cl.forEach(c => {
      for (let i = 1; i < c.tok.length; i++) gaps.push(c.tok[i] - c.tok[i - 1]);
    });
    gaps.sort((a, b) => a - b);
    const end = Math.max(...cl.map(c => c.end));
    const total = cl.reduce((s, c) => s + c.tok.length, 0);
    return {
      cl,
      ev,
      end,
      total,
      medTTFT: (ttft[1] + ttft[2]) / 2,
      maxTTFT: ttft[3],
      medTBT: gaps[Math.floor(gaps.length / 2)],
      maxTBT: gaps[gaps.length - 1],
      thr: total / ((end - Math.min(...cl.map(c => c.arr))) / 1000),
      passes: ev.length,
      steps: ev.filter(e => e.type === "step").length,
    };
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceStep(range) {
    const raw = range / 8,
      p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  function build(key, sim) {
    const W = 960,
      L = 78,
      R = 16,
      rowH = 26,
      gap = 8,
      gpuH = 34,
      top = 6;
    const H = top + 4 * (rowH + gap) + gpuH + 30;
    const x = t => L + (t / xMax) * (W - L - R);
    const svg = el("svg", {
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": key === "serial" ? "Serial timeline" : "Batched timeline",
    });
    const defs = el("defs", {}, svg);
    const hatchId = `ib-hatch-${key}-${uid}`,
      clipId = `ib-clip-${key}-${uid}`;
    const pat = el(
      "pattern",
      {
        id: hatchId,
        width: 6,
        height: 6,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(45)",
      },
      defs
    );
    el("rect", { width: 6, height: 6, style: "fill:var(--ib-soft)" }, pat);
    el(
      "line",
      {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 6,
        style: "stroke:var(--ib-queue);stroke-width:2;opacity:.6",
      },
      pat
    );
    const cp = el("clipPath", { id: clipId }, defs);
    const clipRect = el("rect", { x: 0, y: 0, width: W, height: H }, cp);

    const step = niceStep(xMax);
    const yAxis = top + 4 * (rowH + gap) + gpuH + 6;
    for (let t = 0; t <= xMax; t += step) {
      el(
        "line",
        {
          x1: x(t),
          x2: x(t),
          y1: top,
          y2: yAxis,
          style: "stroke:var(--ib-line);stroke-width:1",
        },
        svg
      );
      const tx = el(
        "text",
        {
          x: x(t),
          y: yAxis + 16,
          "text-anchor": "middle",
          style: "fill:var(--ib-muted);font:11px var(--ib-f-mono)",
        },
        svg
      );
      tx.textContent = fmt(t);
    }
    const counts = [];
    sim.cl.forEach((_c, i) => {
      const y = top + i * (rowH + gap);
      const lt = el(
        "text",
        {
          x: 4,
          y: y + 12,
          style: "fill:var(--ib-fg);font:600 12px var(--ib-f-body)",
        },
        svg
      );
      lt.textContent = "client " + (i + 1);
      counts.push(
        el(
          "text",
          {
            x: 4,
            y: y + 25,
            style: "fill:var(--ib-muted);font:10.5px var(--ib-f-mono)",
          },
          svg
        )
      );
    });
    const gy = top + 4 * (rowH + gap);
    el(
      "text",
      {
        x: 4,
        y: gy + 15,
        style: "fill:var(--ib-fg);font:600 12px var(--ib-f-body)",
      },
      svg
    ).textContent = "GPU";
    el(
      "text",
      {
        x: 4,
        y: gy + 28,
        style: "fill:var(--ib-muted);font:10.5px var(--ib-f-body)",
      },
      svg
    ).textContent = "rows per call";
    el(
      "rect",
      {
        x: L,
        y: gy,
        width: W - L - R,
        height: gpuH,
        rx: 3,
        style: "fill:var(--ib-soft)",
      },
      svg
    );

    const g = el("g", { "clip-path": `url(#${clipId})` }, svg);
    const thr = stepCost(4) * 1.6;
    sim.cl.forEach((c, i) => {
      const y = top + i * (rowH + gap);
      if (c.ps > c.arr)
        el(
          "rect",
          {
            x: x(c.arr),
            y: y + 4,
            width: Math.max(0, x(c.ps) - x(c.arr)),
            height: rowH - 8,
            fill: `url(#${hatchId})`,
          },
          g
        );
      el(
        "rect",
        {
          x: x(c.ps),
          y,
          width: Math.max(1.5, x(c.pe) - x(c.ps)),
          height: rowH,
          rx: 2,
          style: "fill:var(--ib-prefill)",
        },
        g
      );
      el(
        "rect",
        {
          x: x(c.pe),
          y: y + 3,
          width: Math.max(0, x(c.end) - x(c.pe)),
          height: rowH - 6,
          style: "fill:var(--ib-decode-soft)",
        },
        g
      );
      for (let k = 1; k < c.tok.length; k++) {
        const a = c.tok[k - 1],
          b = c.tok[k];
        if (b - a > thr) {
          el(
            "rect",
            {
              x: x(a),
              y: y + 3,
              width: x(b) - x(a),
              height: rowH - 6,
              style: "fill:var(--ib-stall-soft)",
            },
            g
          );
          el(
            "line",
            {
              x1: x(a),
              x2: x(b),
              y1: y + rowH / 2,
              y2: y + rowH / 2,
              style: "stroke:var(--ib-stall);stroke-width:2",
            },
            g
          );
        }
      }
      const dense = (x(c.end) - x(c.pe)) / c.tok.length < 3;
      c.tok.forEach((tt, k) => {
        if (k === 0) return;
        if (dense && k % 8 !== 0 && k !== c.tok.length - 1) return;
        el(
          "line",
          {
            x1: x(tt),
            x2: x(tt),
            y1: y + 3,
            y2: y + rowH - 3,
            style: "stroke:var(--ib-decode);stroke-width:" + (dense ? 1 : 2),
          },
          g
        );
      });
      if (dense)
        el(
          "rect",
          {
            x: x(c.pe),
            y: y + rowH / 2 - 1.5,
            width: Math.max(0, x(c.end) - x(c.pe)),
            height: 3,
            style: "fill:var(--ib-decode)",
          },
          g
        );
      const fx = x(c.tok[0]),
        fy = y + rowH / 2;
      el(
        "path",
        {
          d: `M${fx} ${fy - 6}L${fx + 6} ${fy}L${fx} ${fy + 6}L${fx - 6} ${fy}Z`,
          style: "fill:var(--ib-fg);stroke:var(--ib-surface);stroke-width:1.5",
        },
        g
      );
    });
    sim.cl.forEach((c, i) => {
      const y = top + i * (rowH + gap),
        ax = x(c.arr);
      el(
        "path",
        {
          d: `M${ax - 4} ${y - 1}L${ax + 4} ${y - 1}L${ax} ${y + 5}Z`,
          style: "fill:var(--ib-muted)",
        },
        g
      );
    });
    sim.ev.forEach(e => {
      const x0 = x(e.t0),
        w = Math.max(1, x(e.t1) - x(e.t0) - 0.6);
      if (e.type === "prefill") {
        el(
          "rect",
          {
            x: x0,
            y: gy + 2,
            width: w,
            height: gpuH - 4,
            style: "fill:var(--ib-prefill)",
          },
          g
        );
        if (w > 18) {
          const t = el(
            "text",
            {
              x: x0 + w / 2,
              y: gy + gpuH / 2 + 4,
              "text-anchor": "middle",
              style: "fill:var(--ib-bg);font:600 10.5px var(--ib-f-mono)",
            },
            g
          );
          t.textContent = "P" + (e.c + 1);
        }
      } else {
        const h = ((gpuH - 4) * e.b) / 4;
        el(
          "rect",
          {
            x: x0,
            y: gy + gpuH - 2 - h,
            width: w,
            height: h,
            style: "fill:var(--ib-decode)",
          },
          g
        );
      }
    });
    const ph = el(
      "line",
      {
        x1: L,
        x2: L,
        y1: top - 4,
        y2: gy + gpuH + 2,
        style: "stroke:var(--ib-accent);stroke-width:1.5",
      },
      svg
    );
    const host = $("chart-" + key);
    host.innerHTML = "";
    host.appendChild(svg);
    views[key] = { x, clipRect, ph, counts, sim, W };
  }

  function statsHTML(sim) {
    const items = [
      ["Median TTFT", fmt(sim.medTTFT)],
      ["Worst TTFT", fmt(sim.maxTTFT)],
      ["Median TBT", fmt(sim.medTBT)],
      ["Worst TBT", fmt(sim.maxTBT)],
      ["Throughput", sim.thr.toFixed(0) + " tok/s"],
      ["All done at", fmt(sim.end)],
      ["Model calls", String(sim.passes)],
    ];
    return items
      .map(
        ([k, v]) =>
          `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`
      )
      .join("");
  }

  function explain() {
    const s = sims.serial,
      b = sims.batched,
      S1 = BASE[st.prompt].S1,
      s4 = stepCost(4);
    const pct = v => ((v / s4) * 100).toFixed(1) + "%";
    const tok = n =>
      '<div class="toks">' + '<i class="tok"></i>'.repeat(n) + "</div>";
    $("stepBars").innerHTML =
      `<div class="barrow"><span>1 row</span><div><div class="bar" style="width:${pct(S1)}"></div>${tok(1)}</div></div>
      <div class="barrow"><span>4 rows</span><div><div class="bar" style="width:${pct(s4)}"></div>${tok(4)}</div></div>`;
    const perTok1 = S1,
      perTok4 = s4 / 4;
    $("whyStep").innerHTML =
      st.m4 < 1.6
        ? `Each decode step must read all 1.1B float16 weights (about 2.2 GB) from GPU memory. That read dominates, so adding three more rows reuses it almost for free: <b>${fmt(S1)}</b> for 1 token vs <b>${fmt(s4)}</b> for 4, so each token costs <b>${fmt(perTok4)}</b> instead of ${fmt(perTok1)}. Serial needs <b>${s.steps}</b> decode calls; batched needs <b>${b.steps}</b>.`
        : `On a CPU the arithmetic itself is the bottleneck, so 4 rows cost about ${st.m4.toFixed(1)}x one row. Each token now costs <b>${fmt(perTok4)}</b> instead of ${fmt(perTok1)}, so throughput only moves from <b>${s.thr.toFixed(0)}</b> to <b>${b.thr.toFixed(0)} tok/s</b>. Batching pays only when hardware waits on memory.`;
    const P = BASE[st.prompt].P,
      D = st.tokens * S1;
    const sc = s.cl.map(c => c.tok[0] - c.arr),
      bc = b.cl.map(c => c.tok[0] - c.arr);
    const formS = ["P", "2P + D", "3P + 2D", "4P + 3D"],
      formB = ["P", "2P", "3P", "4P"];
    const burst = st.arrival === "burst";
    $("ttftTable").innerHTML =
      "<tr><th>Client</th><th>Serial TTFT</th><th>Batched TTFT</th></tr>" +
      sc
        .map(
          (v, i) =>
            `<tr><td>${i + 1}</td><td>${fmt(v)}${burst ? ' <span class="note">' + formS[i] + "</span>" : ""}</td><td>${fmt(bc[i])}${burst ? ' <span class="note">' + formB[i] + "</span>" : ""}</td></tr>`
        )
        .join("");
    $("whyTTFT").innerHTML =
      `Serial makes client 4 wait for three whole requests (each P + D, with D = ${st.tokens} steps x ${fmt(S1)} = ${fmt(D)}). Batching only makes it wait for earlier prefills. Median TTFT: <b>${fmt(s.medTTFT)} &rarr; ${fmt(b.medTTFT)}</b>, about <b>${(s.medTTFT / b.medTTFT).toFixed(0)}x</b> faster.`;
    $("stallBig").innerHTML =
      `${fmt(s.maxTBT)} &rarr; ${fmt(b.maxTBT)} <span class="note" style="font-family:var(--ib-f-body);font-weight:400">worst gap between tokens</span>`;
    $("whyStall").innerHTML =
      `Prefill is not batched, and the loop admits new requests before the next decode step. A client that already has tokens sits idle (red) through every later client's prefill (P = ${fmt(P)}). Median TBT barely moves (<b>${fmt(s.medTBT)} &rarr; ${fmt(b.medTBT)}</b>), so the cost shows up only in the tail. ${st.prompt == 1536 ? "At 1536 tokens each prefill is long, so the stall is large. Chunked prefill (Sarathi) is the fix." : "Try 1536 tokens to see the stall grow."}`;
  }

  function render(keepT) {
    sims = { serial: simulate(1), batched: simulate(4) };
    xMax = Math.max(sims.serial.end, sims.batched.end) * 1.01;
    build("serial", sims.serial);
    build("batched", sims.batched);
    $("stats-serial").innerHTML = statsHTML(sims.serial);
    $("stats-batched").innerHTML = statsHTML(sims.batched);
    explain();
    st.t = keepT ? Math.min(st.t, xMax) : xMax;
    draw();
  }

  function draw() {
    const t = st.t;
    for (const k in views) {
      const v = views[k],
        px = v.x(t);
      v.clipRect.setAttribute("width", px);
      v.ph.setAttribute("x1", px);
      v.ph.setAttribute("x2", px);
      v.sim.cl.forEach((c, i) => {
        const n = c.tok.filter(x => x <= t + 1e-6).length;
        v.counts[i].textContent = n + "/" + c.tok.length + " tok";
      });
    }
    $("clock").textContent = "t = " + fmt(t);
    $("scrub").value = Math.round((t / xMax) * 1000);
    const b = sims.batched;
    const e = b.ev.find(e => t >= e.t0 && t < e.t1);
    const on = new Set();
    let msg = "";
    const retiring = b.cl.filter(
      c =>
        c.end != null &&
        t >= c.end &&
        t - c.end < Math.max(60, stepCost(4) * 0.9)
    );
    if (t >= b.end - 1e-6) {
      on.add("L0");
      msg =
        '<strong>All 4 requests finished.</strong><span class="note">The serial run is still going if its timeline extends further right.</span>';
    } else if (!e) {
      on.add("L0");
      msg = "<strong>Idle</strong> waiting for the next request to arrive.";
    } else if (e.type === "prefill") {
      on.add("L2");
      on.add("L3");
      const dec = b.cl
        .filter(
          c => c.pe != null && c.pe <= e.t0 && (c.end == null || c.end > t)
        )
        .map(c => c.id + 1);
      msg =
        `<strong>Admit: prefilling client ${e.c + 1}</strong><span>The whole ${st.prompt}-token prompt goes through the model in one call.</span>` +
        (dec.length
          ? `<span class="note">Client${dec.length > 1 ? "s" : ""} ${dec.join(", ")} already decoding and waiting: this is the stall.</span>`
          : "");
    } else {
      on.add("L5");
      msg = `<strong>Decode step with ${e.b} row${e.b > 1 ? "s" : ""}</strong><span>Clients ${e.members.map(m => m + 1).join(", ")} each get one token from a single call (${fmt(e.t1 - e.t0)}).</span><span class="note">Caches are padded and stacked into one (${e.b}, heads, max_len, head_dim) tensor for attention.</span>`;
    }
    if (retiring.length && t < b.end) {
      on.add("L7");
      msg += `<span class="note">Client ${retiring.map(c => c.id + 1).join(", ")} finished and left the batch.</span>`;
    }
    ["L0", "L2", "L3", "L5", "L7"].forEach(id =>
      $(id).classList.toggle("on", on.has(id))
    );
    $("now").innerHTML = msg;
  }

  let last = null;
  function tick(ts) {
    if (!st.playing || !root.isConnected) {
      last = null;
      return;
    }
    if (last != null) st.t += (ts - last) * st.speed;
    last = ts;
    if (st.t >= xMax) {
      st.t = xMax;
      st.playing = false;
      $("playBtn").textContent = "Replay";
      draw();
      return;
    }
    draw();
    requestAnimationFrame(tick);
  }

  $("playBtn").addEventListener("click", () => {
    if (st.playing) {
      st.playing = false;
      $("playBtn").textContent = "Play";
      return;
    }
    if (st.t >= xMax - 1e-6) st.t = 0;
    st.playing = true;
    $("playBtn").textContent = "Pause";
    last = null;
    requestAnimationFrame(tick);
  });
  $("scrub").addEventListener("input", e => {
    st.t = (e.target.value / 1000) * xMax;
    if (!st.playing)
      $("playBtn").textContent = st.t >= xMax - 1e-6 ? "Replay" : "Play";
    draw();
  });

  function setPressed(group, v) {
    group
      .querySelectorAll("button")
      .forEach(b =>
        b.setAttribute("aria-pressed", String(b.dataset.v === String(v)))
      );
  }
  root.querySelectorAll(".seg[data-key]").forEach(group => {
    group.addEventListener("click", ev => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const k = group.dataset.key,
        v = btn.dataset.v;
      setPressed(group, v);
      if (k === "speed") {
        st.speed = parseFloat(v);
        return;
      }
      if (k === "m4preset") {
        st.m4 = parseFloat(v);
        $("m4").value = v;
        $("m4v").textContent = st.m4.toFixed(2) + "x";
      } else if (k === "arrival") st.arrival = v;
      else st[k] = parseInt(v, 10);
      render(st.playing);
    });
  });
  $("m4").addEventListener("input", e => {
    st.m4 = parseFloat(e.target.value);
    $("m4v").textContent = st.m4.toFixed(2) + "x";
    setPressed(
      root.querySelector('[data-key="m4preset"]'),
      Math.abs(st.m4 - 1.14) < 0.005
        ? "1.14"
        : Math.abs(st.m4 - 3) < 0.005
          ? "3"
          : "x"
    );
    render(st.playing);
  });

  render(false);
}
