/* Aden Studio office board.
   Polls status.json (the 4h sync file) every 5 minutes and walks sprites
   between desks and amenity seats. Geometry and destination rules live in
   office-layout.js. */
(function () {
  "use strict";

  var sim = window.OfficeSim;
  var POLL_MS = 5 * 60 * 1000;
  var WEEK_STALE_TIP = "新一週已歸零（上週數據已過期）";
  var MONTH_STALE_TIP = "新一月已歸零（上月數據已過期）";
  var DAY_ZH = ["一", "二", "三", "四", "五", "六", "日"];
  var CHIP_RANK = { confirm: 0, working: 1, done: 2, idle: 3, bored: 3, stale: 4 };
  var TEAM_RANK = { ceo: 0, eng: 1, content: 2, research: 3, jobs: 4, guest: 5 };

  var actors = new Map();
  var sticky = new Map();
  var grid = null;
  var currentData = null;
  var dataSource = "none";
  var pollFailed = false;
  var pollTimer = null;
  var prevAgents = null;
  var sessionEvents = [];
  var renderedMonday = "";
  var renderedMonth = "";
  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) { reduceMotion = false; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function hkTime(iso) {
    var d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  }

  function hkStamp(date) {
    var d = date || new Date();
    var fmt = new Intl.DateTimeFormat("zh-HK", {
      timeZone: "Asia/Hong_Kong",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    return fmt.format(d);
  }

  function propHTML(p) {
    var style = [];
    if (p.right != null) style.push("right:" + p.right + "%");
    else style.push("left:" + p.l + "%");
    style.push("top:" + p.t + "%");
    if (p.wPct != null) style.push("width:" + p.wPct + "%");
    else if (p.w) style.push("width:" + p.w + "px");
    if (p.h) style.push("height:" + p.h + "px");
    var title = p.title ? ' title="' + esc(p.title) + '"' : "";
    return '<div class="prop ' + esc(p.cls) + '" style="' + style.join(";") + '"' + title + "></div>";
  }

  function renderFloor() {
    var room = document.getElementById("room");
    var parts = [];
    parts.push(
      '<div class="wall">' +
        '<div class="wall-prop shelf" style="left:18px"></div>' +
        '<div class="wall-prop shelf" style="left:78px"></div>' +
        '<div class="wall-prop door"></div>' +
        '<div class="wall-prop clock">⏱</div>' +
        '<div class="wall-prop window">window</div>' +
      "</div>"
    );
    sim.ZONES.forEach(function (z) {
      parts.push(
        '<div class="zone ' + z.cls + '" style="left:' + z.l + "%;top:" + z.t +
        "%;width:" + z.w + "%;height:" + z.h + '%">' +
        '<span class="zlabel">' + esc(z.label) + "</span>"
      );
      if (z.id === "pantry") parts.push('<div class="prop zone-sign">茶水間</div>');
      if (z.id === "lounge") parts.push('<div class="prop zone-sign">休息室</div>');
      sim.PROPS.forEach(function (p) {
        if (p.zone === z.id) parts.push(propHTML(p));
      });
      parts.push("</div>");
    });
    parts.push('<div class="walk"></div><div class="walk-h"></div><div class="walk-label">WALKWAY</div>');
    sim.DESKS.forEach(function (d) {
      parts.push(
        '<div class="desk" data-id="' + esc(d.id) + '" data-team="' + esc(d.team) +
        '" style="left:' + d.left + "%;top:" + d.top + '%">' +
          '<div class="nameplate">' + esc(d.name) + "</div>" +
          '<div class="top"></div>' +
          '<div class="monitor"></div>' +
          '<div class="chair"></div>' +
        "</div>"
      );
    });
    parts.push('<div id="actors"></div>');
    room.innerHTML = parts.join("");
  }

  function fitRoom() {
    var wrap = document.getElementById("floor-wrap");
    var room = document.getElementById("room");
    if (!wrap || !room) return;
    var scale = Math.min(1, wrap.clientWidth / sim.ROOM_W);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var visualW = sim.ROOM_W * scale;
    var left = Math.max(0, (wrap.clientWidth - visualW) / 2);
    room.style.transform = "scale(" + scale + ")";
    room.style.left = left + "px";
    wrap.style.height = (sim.ROOM_H * scale + 24) + "px";
  }

  function chipLabel(chip) {
    return ({
      confirm: "CONFIRM",
      working: "working",
      idle: "idle",
      bored: "bored",
      done: "done",
      stale: ">4h",
    })[chip] || chip;
  }

  function dotClass(chip) {
    if (chip === "confirm" || chip === "working" || chip === "stale") return chip;
    return "idle";
  }

  function badgeHTML(plan) {
    var html = '<span class="badge ' + esc(plan.chip) + '">' + esc(chipLabel(plan.chip)) + "</span>";
    if (plan.stale && plan.chip !== "stale") html += '<span class="badge stale pip">&gt;4h</span>';
    return html;
  }

  function avoidSet(exceptId) {
    var set = new Set();
    actors.forEach(function (actor, id) {
      if (id === exceptId) return;
      var cellX = Math.floor(actor.x / sim.CELL);
      var cellY = Math.floor(actor.y / sim.CELL);
      set.add(cellY * (sim.ROOM_W / sim.CELL) + cellX);
    });
    return set;
  }

  function poseFor(destKey) {
    return String(destKey || "").indexOf("desk:") === 0 ? "sit" : "rest";
  }

  function paintLabels(actor) {
    var plan = actor.plan;
    var el = actor.el;
    el.dataset.chip = plan.chip;
    el.dataset.dest = plan.destKey;
    el.dataset.zone = plan.zone || "";
    el.dataset.team = sim.teamOf(plan.agent);
    el.title = (plan.agent.task || plan.status || "");
    el.querySelector(".nm").textContent = sim.shortName(plan.agent);
    el.querySelector(".badges").innerHTML = badgeHTML(plan);
    var zzz = el.querySelector(".zzz");
    zzz.hidden = !(plan.badge === "bored" && plan.kind === "amenity");
  }

  function spawn(plan, now) {
    var start = reduceMotion ? { x: plan.x, y: plan.y } : sim.introPoint(plan.agent.id, plan.kind);
    var path = reduceMotion ? [] : (sim.findPath(grid, start, plan) || [{ x: plan.x, y: plan.y }]);
    var el = document.createElement("div");
    el.className = "actor";
    el.dataset.id = plan.agent.id;
    el.innerHTML =
      '<div class="tag"><span class="nm"></span><span class="badges"></span></div>' +
      '<div class="sprite-wrap"><img class="sprite" alt="" /><div class="fallback" hidden></div></div>' +
      '<div class="shadow"></div>' +
      '<span class="zzz" hidden>Zzz</span>';
    var img = el.querySelector("img");
    img.alt = sim.shortName(plan.agent);
    img.src = "sprites/" + encodeURIComponent(plan.agent.id) + ".png";
    img.addEventListener("error", function () {
      img.hidden = true;
      el.querySelector(".fallback").hidden = false;
    });
    el.addEventListener("click", function () {
      var row = document.querySelector('.agent-row[data-id="' + cssEscape(plan.agent.id) + '"]');
      if (!row) return;
      document.querySelectorAll(".agent-row.flash").forEach(function (r) { r.classList.remove("flash"); });
      row.classList.add("flash");
      row.scrollIntoView({ block: "nearest" });
    });
    document.getElementById("actors").appendChild(el);
    return {
      el: el,
      x: start.x,
      y: start.y,
      path: path,
      pathIndex: 0,
      destKey: plan.destKey,
      dest: { x: plan.x, y: plan.y },
      pauseUntil: now + (sim.hash(plan.agent.id) % 700),
      face: 1,
      walkPhase: sim.hash(plan.agent.id) % 12,
      pose: reduceMotion ? poseFor(plan.destKey) : "pause",
      plan: plan,
      speed: 74 + (sim.hash(plan.agent.id + ":spd") % 22),
    };
  }

  function syncActors(plans, now) {
    var seen = new Set();
    plans.forEach(function (plan) {
      var id = String(plan.agent.id);
      seen.add(id);
      var actor = actors.get(id);
      if (!actor) {
        actor = spawn(plan, now);
        actors.set(id, actor);
      } else if (actor.destKey !== plan.destKey) {
        var from = { x: actor.x, y: actor.y };
        var path = reduceMotion ? [] : (sim.findPath(grid, from, plan, avoidSet(id)) || [{ x: plan.x, y: plan.y }]);
        actor.path = path;
        actor.pathIndex = 0;
        actor.destKey = plan.destKey;
        actor.dest = { x: plan.x, y: plan.y };
        actor.pauseUntil = now + 80;
        if (reduceMotion) {
          actor.x = plan.x;
          actor.y = plan.y;
          actor.pose = poseFor(plan.destKey);
        }
      } else {
        actor.dest = { x: plan.x, y: plan.y };
      }
      actor.plan = plan;
      paintLabels(actor);
    });
    Array.from(actors.keys()).forEach(function (id) {
      if (seen.has(id)) return;
      actors.get(id).el.remove();
      actors.delete(id);
      sticky.delete(id);
    });
  }

  function stepActor(actor, dt, now) {
    if (reduceMotion) {
      actor.x = actor.dest.x;
      actor.y = actor.dest.y;
      actor.pose = poseFor(actor.destKey);
      return;
    }
    if (actor.pauseUntil && now < actor.pauseUntil) {
      actor.pose = "pause";
      return;
    }
    var path = actor.path;
    if (!path || actor.pathIndex >= path.length) {
      actor.x = actor.dest.x;
      actor.y = actor.dest.y;
      actor.pose = poseFor(actor.destKey);
      actor.face = 1;
      return;
    }
    var target = path[actor.pathIndex];
    var dx = target.x - actor.x;
    var dy = target.y - actor.y;
    var dist = Math.hypot(dx, dy);
    if (dist < 1.4) {
      actor.x = target.x;
      actor.y = target.y;
      actor.pathIndex++;
      if (actor.pathIndex < path.length && actor.pathIndex % 3 === 0) {
        actor.pauseUntil = now + 120 + (sim.hash(actor.plan.agent.id + ":p" + actor.pathIndex) % 280);
      }
      return;
    }
    var step = Math.min(dist, actor.speed * dt);
    actor.x += (dx / dist) * step;
    actor.y += (dy / dist) * step;
    actor.walkPhase += step;
    if (Math.abs(dx) > 2) actor.face = dx < 0 ? -1 : 1;
    actor.pose = "walk";
  }

  function paintActor(actor, now) {
    var bob = 0;
    if (actor.pose === "walk") bob = Math.sin(actor.walkPhase / 5) * 2.6;
    else if (actor.pose === "sit") bob = 2 + Math.sin(now / 700) * 0.35;
    else bob = Math.sin(now / 820 + actor.walkPhase) * 0.7;
    var face = (actor.pose === "sit" || actor.pose === "rest") ? 1 : (actor.face || 1);
    actor.el.style.left = actor.x + "px";
    actor.el.style.top = actor.y + "px";
    actor.el.style.zIndex = String(20 + Math.round(actor.y));
    actor.el.classList.toggle("seated", actor.pose === "sit");
    actor.el.classList.toggle("walking", actor.pose === "walk");
    var wrap = actor.el.querySelector(".sprite-wrap");
    wrap.style.transform = "scaleX(" + face + ") translateY(" + bob.toFixed(2) + "px)";
    var shadow = actor.el.querySelector(".shadow");
    var squash = actor.pose === "walk" ? (0.72 + Math.abs(Math.sin(actor.walkPhase / 5)) * 0.38) : 1;
    shadow.style.transform = "scaleX(" + squash.toFixed(2) + ")";
  }

  function paintDesks() {
    document.querySelectorAll(".desk").forEach(function (el) {
      var id = el.dataset.id;
      var actor = actors.get(id);
      var plan = actor && actor.plan;
      var seated = !!(actor && actor.pose === "sit" && actor.destKey === "desk:" + id &&
        Math.hypot(actor.dest.x - actor.x, actor.dest.y - actor.y) < 8);
      el.classList.toggle("occupied", seated);
      el.classList.toggle("hot", !!(plan && plan.chip === "confirm" && plan.kind === "desk"));
      var mon = el.querySelector(".monitor");
      var workingHere = !!(plan && plan.badge === "working" && plan.kind === "desk");
      var confirmHere = !!(plan && plan.badge === "confirm" && plan.kind === "desk");
      mon.classList.toggle("on", workingHere);
      mon.classList.toggle("confirm", confirmHere && !workingHere);
    });
  }

  function noteChanges(agents) {
    if (!prevAgents) {
      prevAgents = agents.map(function (a) { return Object.assign({}, a); });
      return;
    }
    var prev = new Map(prevAgents.map(function (a) { return [a.id, a]; }));
    var t = new Date();
    agents.forEach(function (a) {
      var p = prev.get(a.id);
      if (!p) return;
      if ((p.status || "") !== (a.status || "") || (p.task || "") !== (a.task || "")) {
        sessionEvents.unshift({
          t: t.toISOString(),
          text: sim.shortName(a) + " · " + (a.status || "") + " · " + (a.task || ""),
        });
      }
    });
    sessionEvents = sessionEvents.slice(0, 8);
    prevAgents = agents.map(function (a) { return Object.assign({}, a); });
  }

  function renderTeam(plans) {
    var rows = plans.slice().sort(function (a, b) {
      var c = (CHIP_RANK[a.chip] == null ? 9 : CHIP_RANK[a.chip]) - (CHIP_RANK[b.chip] == null ? 9 : CHIP_RANK[b.chip]);
      if (c) return c;
      var ta = TEAM_RANK[sim.teamOf(a.agent)] == null ? 9 : TEAM_RANK[sim.teamOf(a.agent)];
      var tb = TEAM_RANK[sim.teamOf(b.agent)] == null ? 9 : TEAM_RANK[sim.teamOf(b.agent)];
      if (ta !== tb) return ta - tb;
      return sim.shortName(a.agent).localeCompare(sim.shortName(b.agent), "zh");
    });
    var host = document.getElementById("team-list");
    if (!rows.length) {
      host.innerHTML = '<div class="stat-sub">等待狀態資料…</div>';
      return;
    }
    host.innerHTML = rows.map(function (p) {
      var team = sim.TEAM_LABEL[sim.teamOf(p.agent)] || "";
      var task = p.agent.task || "";
      var body = p.chip === "confirm"
        ? '<div class="meta">⚠ ' + esc(task || "等 CONFIRM") + "</div>"
        : '<div class="task">' + esc(task || p.status || "") +
            (p.stale && p.chip !== "stale" ? ' <span class="stale-pip">&gt;4h</span>' : "") +
          "</div>";
      return (
        '<div class="agent-row' + (p.chip === "confirm" ? " hot" : "") + '" data-id="' + esc(p.agent.id) + '">' +
          '<div class="dot ' + dotClass(p.chip) + '"></div>' +
          "<div><div class=\"name\">" + esc(sim.shortName(p.agent) + (team ? " · " + team : "")) + "</div>" +
          body + "</div></div>"
      );
    }).join("");
  }

  function renderActivity(agents) {
    var host = document.getElementById("activity");
    var historical = agents.slice().sort(function (a, b) {
      return Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0);
    });
    var html = sessionEvents.slice(0, 3).map(function (ev) {
      return '<div class="act-item session"><span class="t">' + esc(hkTime(ev.t)) + '</span><span class="b">' + esc(ev.text) + "</span></div>";
    }).join("");
    html += historical.slice(0, 6).map(function (a) {
      var task = a.task || a.status || "";
      return '<div class="act-item"><span class="t">' + esc(hkTime(a.updated_at)) + "</span><span class=\"b\">" +
        esc(sim.shortName(a) + " · " + task) + "</span></div>";
    }).join("");
    host.innerHTML = html || '<div class="stat-sub">暫無動態</div>';
  }

  function renderStats(agents, now) {
    var rows = agents.map(function (a) {
      return { a: a, w: sim.weekView(a, now), m: sim.monthView(a, now) };
    });
    var maxW = 1;
    var maxM = 1;
    var maxDay = 1;
    rows.forEach(function (r) {
      if (r.w.total > maxW) maxW = r.w.total;
      if (r.m.total > maxM) maxM = r.m.total;
      r.w.days.forEach(function (n) { if (n > maxDay) maxDay = n; });
    });
    var weekRows = rows.slice().sort(function (a, b) {
      return b.w.total - a.w.total || (b.w.minutes || 0) - (a.w.minutes || 0) ||
        sim.shortName(a.a).localeCompare(sim.shortName(b.a), "zh");
    });
    var weekStale = weekRows.some(function (r) { return r.w.stale; });
    var weekStart = weekRows.length ? weekRows[0].w.weekStart : "";
    var weekHtml = "";
    if (weekStale) weekHtml += '<div class="tab-note">' + esc(WEEK_STALE_TIP) + "</div>";
    weekHtml += '<div class="stat-sub" style="margin-bottom:8px">週一 00:00 HKT 歸零' +
      (weekStart ? " · " + esc(weekStart) : "") + "</div>";
    weekHtml += weekRows.map(function (r) {
      var pct = Math.round((r.w.total / maxW) * 100);
      var bits = ["活躍 " + r.w.active + "/7"];
      if (r.w.minutesLabel) bits.push(r.w.minutesLabel);
      var tip = sim.shortName(r.a) + " · 本週 " + r.w.total + " · " +
        r.w.days.map(function (n, i) { return DAY_ZH[i] + n; }).join(" ") +
        (r.w.stale ? " · " + WEEK_STALE_TIP : "");
      var spark = r.w.days.map(function (n, i) {
        var h = n ? Math.max(3, Math.round((n / maxDay) * 12)) : 2;
        return '<span title="' + esc(DAY_ZH[i] + " " + n) + '"><i class="' + (n ? "" : "z") +
          '" style="height:' + h + 'px"></i><b>' + DAY_ZH[i] + "</b></span>";
      }).join("");
      return (
        '<div class="stat-row" title="' + esc(tip) + '">' +
          '<div class="stat-top"><span class="who">' + esc(sim.shortName(r.a)) + '</span>' +
          '<span class="num' + (r.w.total ? "" : " zero") + '">' + r.w.total + "</span></div>" +
          '<div class="stat-sub">' + esc(bits.join(" · ")) + "</div>" +
          '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="spark">' + spark + "</div></div>"
      );
    }).join("");
    document.getElementById("tab-week").innerHTML = weekHtml || '<div class="stat-sub">暫無資料</div>';

    var monthRows = rows.slice().sort(function (a, b) {
      return b.m.total - a.m.total || sim.shortName(a.a).localeCompare(sim.shortName(b.a), "zh");
    });
    var monthStale = monthRows.some(function (r) { return r.m.stale; });
    var monthStart = monthRows.length ? monthRows[0].m.monthStart : "";
    var monthHtml = "";
    if (monthStale) monthHtml += '<div class="tab-note">' + esc(MONTH_STALE_TIP) + "</div>";
    monthHtml += '<div class="stat-sub" style="margin-bottom:8px">每月 1 日 00:00 HKT 歸零' +
      (monthStart ? " · " + esc(monthStart) : "") + "</div>";
    monthHtml += monthRows.map(function (r) {
      var pct = Math.round((r.m.total / maxM) * 100);
      var tip = sim.shortName(r.a) + " · 本月 " + r.m.total +
        (r.m.stale ? " · " + MONTH_STALE_TIP : "") +
        (r.m.monthStart ? " · " + r.m.monthStart : "");
      return (
        '<div class="stat-row" title="' + esc(tip) + '">' +
          '<div class="stat-top"><span class="who">' + esc(sim.shortName(r.a)) + '</span>' +
          '<span class="num' + (r.m.total ? "" : " zero") + '">' + r.m.total + "</span></div>" +
          '<div class="bar"><i style="width:' + pct + '%"></i></div></div>'
      );
    }).join("");
    document.getElementById("tab-month").innerHTML = monthHtml || '<div class="stat-sub">暫無資料</div>';
  }

  function updateSourceNote() {
    var el = document.getElementById("source-note");
    if (!el) return;
    if (dataSource === "fetch" && pollFailed) {
      el.textContent = "status.json 暫時讀唔到，仍然顯示上一份";
    } else if (dataSource === "fetch") {
      el.textContent = "status.json · 每 5 分鐘";
    } else if (dataSource === "file") {
      el.textContent = "本地 JSON（poll 暫停）";
    } else if (dataSource === "embedded") {
      el.textContent = "fetch 失敗，顯示內嵌 sample";
    } else {
      el.textContent = "等待狀態資料…";
    }
  }

  function applyData(data) {
    currentData = data;
    var now = Date.now();
    renderedMonday = sim.hkWeekMondayISO(now);
    renderedMonth = sim.hkMonthStartISO(now);
    var agents = Array.isArray(data.agents) ? data.agents.filter(function (a) { return a && a.id != null; }) : [];
    noteChanges(agents);
    var plans = sim.planDestinations(agents, now, sticky);
    syncActors(plans, performance.now());
    renderTeam(plans);
    renderActivity(agents);
    renderStats(agents, now);
    paintDesks();
    updateSourceNote();
  }

  function readEmbedded() {
    try {
      var raw = document.getElementById("embedded-sample").textContent;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.agents)) throw new Error("shape");
      return data;
    } catch (err) {
      return { updated_at: null, agents: [] };
    }
  }

  async function tryFetch() {
    try {
      var res = await fetch("status.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (!data || !Array.isArray(data.agents)) throw new Error("bad shape");
      dataSource = "fetch";
      pollFailed = false;
      applyData(data);
      return true;
    } catch (err) {
      return false;
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      if (dataSource === "file") return;
      var ok = await tryFetch();
      if (!ok && dataSource === "fetch") {
        pollFailed = true;
        updateSourceNote();
      }
    }, POLL_MS);
  }

  async function loadInitial() {
    var ok = await tryFetch();
    if (!ok) {
      dataSource = "embedded";
      applyData(readEmbedded());
    }
    startPoll();
  }

  function renderClock() {
    var el = document.getElementById("hk-clock");
    if (el) el.textContent = hkStamp(new Date());
    if (!currentData) return;
    var monday = sim.hkWeekMondayISO();
    var month = sim.hkMonthStartISO();
    if ((renderedMonday && monday !== renderedMonday) || (renderedMonth && month !== renderedMonth)) {
      applyData(currentData);
    }
  }

  function bindChrome() {
    document.querySelectorAll(".tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".tabs button").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".tab-pane").forEach(function (p) {
          p.classList.toggle("show", p.id === "tab-" + btn.dataset.tab);
        });
      });
    });
    document.getElementById("file-input").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.agents)) throw new Error("agents missing");
          dataSource = "file";
          pollFailed = false;
          applyData(data);
        } catch (err) {
          window.alert("JSON 讀取失敗：" + err.message);
        }
      };
      reader.readAsText(file);
    });
    document.getElementById("btn-reload").addEventListener("click", function () {
      dataSource = "none";
      loadInitial();
    });
    window.addEventListener("resize", fitRoom);
  }

  var lastFrame = 0;
  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    actors.forEach(function (actor) { stepActor(actor, dt, now); });
    actors.forEach(function (actor) { paintActor(actor, now); });
    paintDesks();
    requestAnimationFrame(frame);
  }

  renderFloor();
  fitRoom();
  grid = sim.buildGrid();
  bindChrome();
  renderClock();
  setInterval(renderClock, 1000);
  loadInitial();
  requestAnimationFrame(frame);

  window.__office = {
    actors: actors,
    sim: sim,
    applyData: applyData,
    snapshot: function () {
      return Array.from(actors.values()).map(function (a) {
        return {
          id: a.plan.agent.id,
          x: Math.round(a.x),
          y: Math.round(a.y),
          destX: Math.round(a.dest.x),
          destY: Math.round(a.dest.y),
          pose: a.pose,
          chip: a.plan.chip,
          kind: a.plan.kind,
          zone: a.plan.zone,
          destKey: a.destKey,
          dist: Math.round(Math.hypot(a.dest.x - a.x, a.dest.y - a.y)),
        };
      });
    },
  };
})();
