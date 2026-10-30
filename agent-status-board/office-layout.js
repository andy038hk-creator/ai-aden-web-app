/* Office v2 floor geometry, status → destination rules, and a coarse-grid walk.
   The room is a fixed 920×620 design space (the page scales it as a whole).
   Week / month helpers keep the existing Asia/Hong_Kong reset contract. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OfficeSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ROOM_W = 920;
  var ROOM_H = 620;
  var CELL = 10;
  var COLS = ROOM_W / CELL;
  var ROWS = ROOM_H / CELL;
  var STALE_MS = 4 * 60 * 60 * 1000;
  var HK_TZ = "Asia/Hong_Kong";
  var CONFIRM_RE = /confirm|等\s*aden|待拍板|等你拍板|等你確認|待確認|要你確認/i;

  var TEAM_LABEL = {
    research: "研究",
    content: "內容",
    eng: "工程",
    jobs: "求職",
    ceo: "CEO",
    guest: "客席",
  };

  var ZONES = [
    { id: "research", cls: "research", l: 4, t: 11, w: 32, h: 16, label: "研究 · 阿呆 / Fund / 師兄" },
    { id: "ceo", cls: "ceo", l: 38, t: 12, w: 18, h: 14, label: "CEO · 朗朗" },
    { id: "content", cls: "content", l: 4, t: 28, w: 28, h: 36, label: "內容 · 阿靚 / 阿書 / 阿影" },
    { id: "eng", cls: "eng", l: 36, t: 28, w: 26, h: 36, label: "工程 · 阿TOM / MECH" },
    { id: "jobs", cls: "jobs", l: 4, t: 68, w: 22, h: 26, label: "求職 · 阿補 / 弘仔" },
    { id: "pantry", cls: "pantry", l: 75, t: 12, w: 22, h: 28, label: "茶水間" },
    { id: "lounge", cls: "lounge", l: 75, t: 44, w: 22, h: 28, label: "休息室" },
    { id: "ping", cls: "ping", l: 75, t: 76, w: 22, h: 18, label: "玩樂角" },
  ];

  function rx(pct) { return pct / 100 * ROOM_W; }
  function ry(pct) { return pct / 100 * ROOM_H; }

  function zoneBox(id) {
    var z = null;
    for (var i = 0; i < ZONES.length; i++) if (ZONES[i].id === id) z = ZONES[i];
    if (!z) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: rx(z.l), y: ry(z.t), w: rx(z.w), h: ry(z.h) };
  }

  function makeDesk(id, name, team, left, top) {
    var x = rx(left);
    var y = ry(top);
    var w = 70;
    var h = 62;
    return {
      id: id,
      name: name,
      team: team,
      left: left,
      top: top,
      x: x,
      y: y,
      w: w,
      h: h,
      stand: { x: x + w / 2, y: y + h - 2 },
      block: { x: x + 6, y: y + 8, w: 58, h: 32 },
      chair: { x: x + 14, y: y + 44, w: 42, h: 16 },
    };
  }

  var DESKS = [
    makeDesk("adai", "阿呆", "research", 5, 13),
    makeDesk("fund", "Fund", "research", 14, 13),
    makeDesk("shixiong", "師兄", "research", 23, 13),
    makeDesk("langlang", "朗朗", "ceo", 41, 15),
    makeDesk("ashu", "阿書", "content", 5, 36),
    makeDesk("aying", "阿影", "content", 15, 36),
    makeDesk("aqing", "阿靚", "content", 10, 52),
    makeDesk("atom", "阿TOM", "eng", 37, 36),
    makeDesk("mech", "MECH", "eng", 49, 36),
    makeDesk("hongzai", "弘仔", "jobs", 5, 75),
    makeDesk("abu", "阿補", "jobs", 15, 75),
  ];

  var DESK_BY_ID = {};
  DESKS.forEach(function (d) { DESK_BY_ID[d.id] = d; });

  /* Props share the wire's zone-relative placement. block:true keeps the walk off furniture.
     Sofa inset leaves the front cushion as a seat. */
  var PROPS = [
    { zone: "pantry", cls: "counter", l: 8, t: 20, wPct: 82, h: 20, block: true },
    { zone: "pantry", cls: "coffee", l: 12, t: 6, w: 18, h: 20, block: true, title: "咖啡機" },
    { zone: "pantry", cls: "kettle", l: 26, t: 9, w: 14, h: 14, block: true, title: "水壺" },
    { zone: "pantry", cls: "mugs", l: 40, t: 11, w: 22, h: 10, title: "杯" },
    { zone: "pantry", cls: "microwave", l: 56, t: 8, w: 26, h: 18, block: true, title: "微波爐" },
    { zone: "pantry", cls: "toaster", l: 76, t: 11, w: 16, h: 12, block: true, title: "多士爐" },
    { zone: "pantry", cls: "fridge", l: 6, t: 38, w: 22, h: 40, block: true, title: "雪櫃" },
    { zone: "pantry", cls: "cooler", l: 22, t: 40, w: 24, h: 38, block: true, title: "飲水機" },
    { zone: "pantry", cls: "sink", l: 40, t: 48, w: 22, h: 14, block: true, title: "洗手盆" },
    { zone: "pantry", cls: "dishes", l: 56, t: 50, w: 18, h: 12, title: "碗碟架" },
    { zone: "pantry", cls: "snack", l: 74, t: 38, w: 22, h: 28, block: true, title: "零食架" },
    { zone: "pantry", cls: "high-table", l: 36, t: 68, w: 32, h: 18, block: true, title: "吧枱" },
    { zone: "pantry", cls: "fruit", l: 42, t: 64, w: 16, h: 10, title: "生果盤" },
    { zone: "pantry", cls: "stool", l: 26, t: 76, w: 12, h: 14, title: "高凳" },
    { zone: "pantry", cls: "stool", l: 58, t: 76, w: 12, h: 14, title: "高凳" },
    { zone: "pantry", cls: "plant", right: 6, t: 70, w: 16, h: 18 },

    { zone: "lounge", cls: "art", l: 38, t: 10, w: 26, h: 18, title: "掛畫" },
    { zone: "lounge", cls: "lamp", l: 68, t: 14, w: 8, h: 28, block: true, title: "落地燈" },
    { zone: "lounge", cls: "sofa", l: 6, t: 28, w: 78, h: 28, block: true, inset: { b: 16 }, title: "梳化" },
    { zone: "lounge", cls: "armchair", l: 70, t: 34, w: 28, h: 24, block: true, title: "單人椅" },
    { zone: "lounge", cls: "coffee-table", l: 26, t: 48, w: 38, h: 20, block: true, title: "茶几" },
    { zone: "lounge", cls: "mag", l: 30, t: 46, w: 12, h: 9, title: "雜誌" },
    { zone: "lounge", cls: "remote", l: 46, t: 52, w: 10, h: 5, title: "遙控" },
    { zone: "lounge", cls: "bookshelf", l: 4, t: 56, w: 20, h: 36, block: true, title: "書架" },
    { zone: "lounge", cls: "plant-stand", l: 78, t: 58, w: 14, h: 10, title: "花架" },
    { zone: "lounge", cls: "plant tall", l: 80, t: 42, w: 14, h: 24 },
    { zone: "lounge", cls: "pouf", l: 48, t: 70, w: 24, h: 16, title: "懶人櫈" },

    { zone: "ping", cls: "ping-table", l: 18, t: 22, w: 64, h: 36, block: true },
  ];

  function propRect(p) {
    var z = zoneBox(p.zone);
    var w = p.wPct != null ? (p.wPct / 100) * z.w : p.w;
    var h = p.h;
    var x = p.right != null
      ? z.x + z.w - (p.right / 100) * z.w - w
      : z.x + (p.l / 100) * z.w;
    var y = z.y + (p.t / 100) * z.h;
    return { x: x, y: y, w: w, h: h };
  }

  function blockRect(p) {
    var r = propRect(p);
    var i = p.inset || {};
    var l = i.l || 0, t = i.t || 0, ri = i.r || 0, b = i.b || 0;
    return { x: r.x + l, y: r.y + t, w: Math.max(0, r.w - l - ri), h: Math.max(0, r.h - t - b) };
  }

  function spot(id, zoneId, l, t) {
    var z = zoneBox(zoneId);
    return {
      id: id,
      zone: zoneId,
      x: Math.round((z.x + (l / 100) * z.w) * 10) / 10,
      y: Math.round((z.y + (t / 100) * z.h) * 10) / 10,
    };
  }

  /* Seats sit on open floor inside each amenity, off the walkway and off solid props. */
  var SPOTS = [
    spot("sofa-l", "lounge", 13, 41),
    spot("sofa-r", "lounge", 40, 41),
    spot("armchair", "lounge", 90, 64),
    spot("pouf", "lounge", 54, 84),
    spot("lounge-floor", "lounge", 19, 92),
    spot("pantry-l", "pantry", 14, 93),
    spot("pantry-c", "pantry", 40, 93),
    spot("pantry-r", "pantry", 65, 93),
    spot("pantry-snack", "pantry", 91, 93),
    spot("ping-l", "ping", 8, 42),
    spot("ping-r", "ping", 64, 42),
    spot("ping-near", "ping", 34, 78),
  ];

  function hash(str) {
    var h = 2166136261;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function lastActiveMs(agent) {
    if (!agent) return null;
    var raw = agent.lastSeen || agent.lastActive || agent.lastCompleted || agent.updated_at;
    if (!raw) return null;
    var t = Date.parse(raw);
    return isNaN(t) ? null : t;
  }

  function visualState(agent, now) {
    var status = String((agent && agent.status) || "idle").trim().toLowerCase();
    var task = String((agent && agent.task) || "");
    var explicit = String((agent && (agent.zone || agent.place)) || "").trim().toLowerCase();
    var blob = status + "\n" + task;
    var last = lastActiveMs(agent);
    var stale = last != null && (now - last) > STALE_MS;
    var resting = !!(agent && (agent.resting === true || status === "rest" || status === "resting"));
    var confirm = !!(agent && (
      agent.confirm === true ||
      status === "confirm" ||
      status === "needs_confirm" ||
      status === "waiting_confirm" ||
      CONFIRM_RE.test(blob)
    ));

    var badge = "idle";
    if (status === "working" || status === "busy" || status === "active") badge = "working";
    else if (confirm) badge = "confirm";
    else if (status === "bored") badge = "bored";
    else if (status === "completed" || status === "done" || status === "done_recent") badge = "done";

    var kind = "amenity";
    if (resting || explicit === "lounge" || explicit === "pantry" || explicit === "ping" || explicit === "amenity") {
      kind = "amenity";
    } else if (explicit === "desk") {
      kind = "desk";
    } else if (badge === "working" || badge === "confirm") {
      kind = "desk";
    }

    var chip = badge;
    if (badge !== "confirm" && badge !== "working" && stale) chip = "stale";

    return {
      badge: badge,
      chip: chip,
      stale: stale,
      kind: kind,
      status: status,
      confirm: confirm,
      explicit: explicit,
    };
  }

  function preference(agent, vis) {
    var explicit = String((agent && agent.zone) || "").toLowerCase();
    var zones;
    if (explicit === "lounge" || explicit === "pantry" || explicit === "ping") {
      zones = [explicit, "lounge", "pantry", "ping"].filter(function (z, i, arr) {
        return arr.indexOf(z) === i;
      });
    } else {
      var roll = hash(agent.id + ":zone") % 100;
      if (vis && vis.badge === "bored") zones = ["lounge", "pantry", "ping"];
      else if (roll < 10) zones = ["ping", "lounge", "pantry"];
      else if (roll < 38) zones = ["pantry", "lounge", "ping"];
      else zones = ["lounge", "pantry", "ping"];
    }
    var list = [];
    zones.forEach(function (z) {
      var group = SPOTS.filter(function (s) { return s.zone === z; }).slice();
      group.sort(function (a, b) {
        var d = hash(agent.id + ":" + a.id) - hash(agent.id + ":" + b.id);
        return d || a.id.localeCompare(b.id);
      });
      list.push.apply(list, group);
    });
    return list;
  }

  function spotPlan(agent, vis, spotRec) {
    return {
      agent: agent,
      badge: vis.badge,
      chip: vis.chip,
      stale: vis.stale,
      kind: "amenity",
      status: vis.status,
      destKey: "spot:" + spotRec.id,
      spotId: spotRec.id,
      zone: spotRec.zone,
      x: spotRec.x,
      y: spotRec.y,
    };
  }

  function planDestinations(agents, now, sticky) {
    var list = Array.isArray(agents) ? agents : [];
    var memory = sticky || new Map();
    var taken = new Set();
    var plans = [];
    var amenity = [];
    var visitors = 0;

    list.forEach(function (agent) {
      if (!agent || agent.id == null) return;
      var vis = visualState(agent, now || Date.now());
      var desk = DESK_BY_ID[agent.id];
      if (vis.kind === "desk" && desk) {
        plans.push({
          agent: agent,
          badge: vis.badge,
          chip: vis.chip,
          stale: vis.stale,
          kind: "desk",
          status: vis.status,
          destKey: "desk:" + desk.id,
          spotId: desk.id,
          zone: desk.team,
          x: desk.stand.x,
          y: desk.stand.y,
        });
        return;
      }
      if (vis.kind === "desk" && !desk) {
        var vx = 420 + (visitors % 4) * 28;
        var vy = 168 + Math.floor(visitors / 4) * 22;
        visitors++;
        plans.push({
          agent: agent,
          badge: vis.badge,
          chip: vis.chip,
          stale: vis.stale,
          kind: "desk",
          status: vis.status,
          destKey: "visitor:" + agent.id,
          spotId: "visitor:" + agent.id,
          zone: "guest",
          x: vx,
          y: vy,
        });
        return;
      }
      amenity.push({ agent: agent, vis: vis });
    });

    var need = [];
    amenity.forEach(function (item) {
      var prev = memory.get(item.agent.id);
      var spotRec = null;
      for (var i = 0; i < SPOTS.length; i++) if (SPOTS[i].id === prev) spotRec = SPOTS[i];
      var explicit = item.vis.explicit;
      var zoneOk = !explicit || explicit === "amenity" || explicit === "desk" || (spotRec && explicit === spotRec.zone);
      if (spotRec && zoneOk && !taken.has(spotRec.id)) {
        taken.add(spotRec.id);
        plans.push(spotPlan(item.agent, item.vis, spotRec));
      } else {
        need.push(item);
      }
    });

    need.sort(function (a, b) { return String(a.agent.id).localeCompare(String(b.agent.id)); });
    need.forEach(function (item) {
      var prefs = preference(item.agent, item.vis);
      var spotRec = null;
      for (var i = 0; i < prefs.length; i++) {
        if (!taken.has(prefs[i].id)) { spotRec = prefs[i]; break; }
      }
      if (!spotRec) {
        var n = taken.size;
        spotRec = {
          id: "overflow-" + item.agent.id,
          zone: "lounge",
          x: 724 + (n % 3) * 26,
          y: 424 + Math.floor(n / 3) * 16,
        };
      }
      taken.add(spotRec.id);
      memory.set(item.agent.id, spotRec.id);
      plans.push(spotPlan(item.agent, item.vis, spotRec));
    });

    return plans;
  }

  function aisleCost(x, y) {
    if (x >= 294 && x <= 338 && y >= 150 && y <= 575) return 1;
    if (y >= 278 && y <= 318 && x >= 36 && x <= 700) return 1;
    if (x >= 630 && x <= 688 && y >= 160 && y <= 575) return 1;
    return 2;
  }

  function pointIn(x, y, r) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  function rectsTouch(ax, ay, aw, ah, b) {
    return ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
  }

  function obstacleRects() {
    var rects = [{ x: 0, y: 0, w: ROOM_W, h: 96, id: "wall" }];
    DESKS.forEach(function (d) { rects.push({ x: d.block.x, y: d.block.y, w: d.block.w, h: d.block.h, id: "desk-" + d.id }); });
    PROPS.forEach(function (p) {
      if (!p.block) return;
      var r = blockRect(p);
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, id: p.cls });
    });
    return rects;
  }

  function buildGrid() {
    var blocks = obstacleRects();
    var grid = [];
    for (var r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (var c = 0; c < COLS; c++) {
        var x = c * CELL;
        var y = r * CELL;
        var cx = x + CELL / 2;
        var cy = y + CELL / 2;
        var blocked = false;
        for (var i = 0; i < blocks.length; i++) {
          if (rectsTouch(x, y, CELL, CELL, blocks[i])) { blocked = true; break; }
        }
        if (blocked) {
          grid[r][c] = 0;
          continue;
        }
        var cost = aisleCost(cx, cy);
        for (var k = 0; k < DESKS.length; k++) {
          if (pointIn(cx, cy, DESKS[k].chair)) cost = Math.max(cost, 5);
        }
        grid[r][c] = cost;
      }
    }
    DESKS.forEach(function (d) { forceWalkable(grid, d.stand.x, d.stand.y); });
    SPOTS.forEach(function (s) { forceWalkable(grid, s.x, s.y); });
    return grid;
  }

  function forceWalkable(grid, x, y) {
    var cell = cellOf(x, y);
    if (!grid[cell.r] || grid[cell.r][cell.c] == null) return;
    if (grid[cell.r][cell.c] === 0) return;
    grid[cell.r][cell.c] = 1;
  }

  function cellOf(x, y) {
    var c = Math.floor(x / CELL);
    var r = Math.floor(y / CELL);
    if (c < 0) c = 0;
    if (r < 0) r = 0;
    if (c > COLS - 1) c = COLS - 1;
    if (r > ROWS - 1) r = ROWS - 1;
    return { c: c, r: r };
  }

  function cellCenter(cell) {
    return { x: cell.c * CELL + CELL / 2, y: cell.r * CELL + CELL / 2 };
  }

  function nearestWalkable(grid, cell) {
    if (grid[cell.r][cell.c]) return cell;
    for (var rad = 1; rad < 12; rad++) {
      for (var dr = -rad; dr <= rad; dr++) {
        for (var dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          var r = cell.r + dr;
          var c = cell.c + dc;
          if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
          if (grid[r][c]) return { c: c, r: r };
        }
      }
    }
    return null;
  }

  var DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  function astar(grid, start, goal, avoid) {
    if (!grid[start.r][start.c] || !grid[goal.r][goal.c]) return null;
    function key(c, r) { return r * COLS + c; }
    var open = [start];
    var gScore = new Map();
    var fScore = new Map();
    var came = new Map();
    var inOpen = new Set();
    var sk = key(start.c, start.r);
    gScore.set(sk, 0);
    fScore.set(sk, Math.hypot(start.c - goal.c, start.r - goal.r));
    inOpen.add(sk);
    var guard = 0;
    while (open.length && guard++ < COLS * ROWS * 8) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) {
        var fi = fScore.get(key(open[i].c, open[i].r));
        var fb = fScore.get(key(open[bi].c, open[bi].r));
        if (fi < fb) bi = i;
      }
      var cur = open.splice(bi, 1)[0];
      var ck = key(cur.c, cur.r);
      inOpen.delete(ck);
      if (cur.c === goal.c && cur.r === goal.r) {
        var path = [cur];
        var k = ck;
        while (came.has(k)) {
          var prev = came.get(k);
          path.push(prev);
          k = key(prev.c, prev.r);
        }
        path.reverse();
        return path;
      }
      for (var d = 0; d < DIRS.length; d++) {
        var dc = DIRS[d][0], dr = DIRS[d][1];
        var nc = cur.c + dc, nr = cur.r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        var stepCost = grid[nr][nc];
        if (!stepCost) continue;
        if (dc !== 0 && dr !== 0 && (!grid[cur.r][nc] || !grid[nr][cur.c])) continue;
        var nk = key(nc, nr);
        var extra = 0;
        if (avoid && avoid.has(nk) && !(nc === goal.c && nr === goal.r)) extra = 6;
        var diag = dc !== 0 && dr !== 0 ? 1.4142 : 1;
        var tg = gScore.get(ck) + diag * ((stepCost + extra + grid[cur.r][cur.c]) / 2);
        if (tg + 1e-6 < (gScore.has(nk) ? gScore.get(nk) : 1e15)) {
          came.set(nk, cur);
          gScore.set(nk, tg);
          fScore.set(nk, tg + Math.hypot(nc - goal.c, nr - goal.r));
          if (!inOpen.has(nk)) {
            open.push({ c: nc, r: nr });
            inOpen.add(nk);
          }
        }
      }
    }
    return null;
  }

  function lineClear(grid, a, b) {
    var dist = Math.hypot(b.x - a.x, b.y - a.y);
    var steps = Math.max(1, Math.ceil(dist / 4));
    for (var i = 0; i <= steps; i++) {
      var x = a.x + (b.x - a.x) * (i / steps);
      var y = a.y + (b.y - a.y) * (i / steps);
      var cell = cellOf(x, y);
      if (!grid[cell.r][cell.c]) return false;
    }
    return true;
  }

  function stringPull(grid, pts) {
    if (pts.length <= 2) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var next = i + 1 < pts.length ? pts[i + 1] : null;
      if (!next || !lineClear(grid, out[out.length - 1], next)) out.push(pts[i]);
    }
    var last = pts[pts.length - 1];
    var tail = out[out.length - 1];
    if (tail.x !== last.x || tail.y !== last.y) out.push(last);
    return out;
  }

  function findPath(grid, from, to, avoid) {
    if (!grid || !from || !to) return null;
    var start = nearestWalkable(grid, cellOf(from.x, from.y));
    var goal = nearestWalkable(grid, cellOf(to.x, to.y));
    if (!start || !goal) return null;
    var cells = astar(grid, start, goal, avoid || null);
    if (!cells || !cells.length) return null;
    var pts = cells.map(cellCenter);
    pts[0] = { x: from.x, y: from.y };
    pts[pts.length - 1] = { x: to.x, y: to.y };
    return stringPull(grid, pts);
  }

  function introPoint(id, kind) {
    var h = hash(String(id));
    if (kind === "desk") {
      return { x: 306 + (h % 4) * 8, y: 188 + (h % 8) * 16 };
    }
    return { x: 548 + (h % 5) * 24, y: 196 + (h % 8) * 26 };
  }

  function isWalkable(grid, x, y) {
    var cell = cellOf(x, y);
    return !!(grid[cell.r] && grid[cell.r][cell.c]);
  }

  function pathLength(path) {
    if (!path || path.length < 2) return 0;
    var n = 0;
    for (var i = 1; i < path.length; i++) n += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return n;
  }

  /* —— Week / month (Monday 00:00 and the 1st, Asia/Hong_Kong) —— */

  function hkWeekMondayISO(date) {
    var d = date instanceof Date ? date : new Date(date || Date.now());
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: HK_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    var map = {};
    fmt.formatToParts(d).forEach(function (p) {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    var wdIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday];
    if (wdIdx == null || !map.year) return "";
    var back = wdIdx === 0 ? 6 : wdIdx - 1;
    var utc = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
    utc.setUTCDate(utc.getUTCDate() - back);
    var y = utc.getUTCFullYear();
    var m = String(utc.getUTCMonth() + 1).padStart(2, "0");
    var day = String(utc.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function hkMonthStartISO(date) {
    var d = date instanceof Date ? date : new Date(date || Date.now());
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: HK_TZ,
      year: "numeric",
      month: "2-digit",
    });
    var map = {};
    fmt.formatToParts(d).forEach(function (p) {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    if (!map.year || !map.month) return "";
    return map.year + "-" + map.month + "-01";
  }

  function freshWeekZeros(monday, stale) {
    return {
      weekStart: monday || null,
      completedByDay: [0, 0, 0, 0, 0, 0, 0],
      completedTotal: 0,
      activeDays: 0,
      workingMinutes: 0,
      stale: !!stale,
    };
  }

  function normalizeWeek(week, now) {
    var monday = hkWeekMondayISO(now);
    var start = week && week.weekStart != null ? String(week.weekStart).trim().slice(0, 10) : "";
    if (!monday || !week || typeof week !== "object" || start !== monday) {
      return freshWeekZeros(monday, true);
    }
    var days = Array.isArray(week.completedByDay) ? week.completedByDay.slice(0, 7) : null;
    if (days) {
      while (days.length < 7) days.push(0);
      days = days.map(function (n) {
        var v = Number(n);
        return isNaN(v) || v < 0 ? 0 : Math.floor(v);
      });
    }
    var total = week.completedTotal;
    if (total == null && days) total = days.reduce(function (a, b) { return a + b; }, 0);
    if (total != null) {
      total = Number(total);
      if (isNaN(total) || total < 0) total = 0;
      else total = Math.floor(total);
    }
    var active = week.activeDays;
    if (active == null && days) active = days.filter(function (n) { return n > 0; }).length;
    var mins = week.workingMinutes == null ? null : Number(week.workingMinutes);
    if (mins != null && (isNaN(mins) || mins < 0)) mins = 0;
    return {
      weekStart: monday,
      completedByDay: days,
      completedTotal: total,
      activeDays: active == null || isNaN(Number(active)) ? null : Number(active),
      workingMinutes: mins,
      stale: false,
    };
  }

  function normalizeMonth(month, now) {
    var start = hkMonthStartISO(now);
    var given = month && month.monthStart != null ? String(month.monthStart).trim().slice(0, 10) : "";
    if (!start || !month || typeof month !== "object" || given !== start) {
      return { monthStart: start || null, completedTotal: 0, stale: true };
    }
    var total = Number(month.completedTotal);
    if (isNaN(total) || total < 0) total = 0;
    else total = Math.floor(total);
    return { monthStart: start, completedTotal: total, stale: false };
  }

  function formatWorkMinutes(mins) {
    if (mins == null || isNaN(mins)) return null;
    var m = Math.max(0, Math.floor(mins));
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    var r = m % 60;
    return r ? (h + "h" + r + "m") : (h + "h");
  }

  function weekView(agent, now) {
    var w = normalizeWeek(agent && agent.week, now);
    var days = w.completedByDay || [0, 0, 0, 0, 0, 0, 0];
    var total = w.completedTotal != null ? w.completedTotal : days.reduce(function (a, b) { return a + b; }, 0);
    var active = (w.activeDays != null && !isNaN(Number(w.activeDays)))
      ? Number(w.activeDays)
      : days.filter(function (n) { return n > 0; }).length;
    return {
      days: days,
      total: total || 0,
      active: active,
      minutes: w.workingMinutes,
      minutesLabel: formatWorkMinutes(w.workingMinutes),
      stale: !!w.stale,
      weekStart: w.weekStart,
    };
  }

  function monthView(agent, now) {
    var m = normalizeMonth(agent && agent.month, now);
    return {
      total: m.completedTotal || 0,
      stale: !!m.stale,
      monthStart: m.monthStart,
    };
  }

  function shortName(agent) {
    if (!agent) return "?";
    var desk = DESK_BY_ID[agent.id];
    if (desk) return desk.name;
    var name = String(agent.name || agent.id || "?");
    return name.split(" - ")[0].split(" · ")[0];
  }

  function teamOf(agent) {
    var desk = agent && DESK_BY_ID[agent.id];
    return desk ? desk.team : "guest";
  }

  return {
    ROOM_W: ROOM_W,
    ROOM_H: ROOM_H,
    CELL: CELL,
    STALE_MS: STALE_MS,
    TEAM_LABEL: TEAM_LABEL,
    ZONES: ZONES,
    DESKS: DESKS,
    DESK_BY_ID: DESK_BY_ID,
    PROPS: PROPS,
    SPOTS: SPOTS,
    hash: hash,
    visualState: visualState,
    planDestinations: planDestinations,
    buildGrid: buildGrid,
    findPath: findPath,
    introPoint: introPoint,
    isWalkable: isWalkable,
    pathLength: pathLength,
    aisleCost: aisleCost,
    propRect: propRect,
    blockRect: blockRect,
    obstacleRects: obstacleRects,
    hkWeekMondayISO: hkWeekMondayISO,
    hkMonthStartISO: hkMonthStartISO,
    normalizeWeek: normalizeWeek,
    normalizeMonth: normalizeMonth,
    weekView: weekView,
    monthView: monthView,
    formatWorkMinutes: formatWorkMinutes,
    shortName: shortName,
    teamOf: teamOf,
    lastActiveMs: lastActiveMs,
  };
});
