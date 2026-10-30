"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sim = require("./office-layout.js");

const grid = sim.buildGrid();
const failures = [];

function check(cond, msg) {
  if (!cond) failures.push(msg);
}

sim.DESKS.forEach((d) => {
  check(sim.isWalkable(grid, d.stand.x, d.stand.y), "desk stand blocked " + d.id);
  const intro = sim.introPoint(d.id, "desk");
  check(sim.isWalkable(grid, intro.x, intro.y), "desk intro blocked " + d.id + " " + intro.x + "," + intro.y);
  const path = sim.findPath(grid, intro, d.stand);
  check(path && sim.pathLength(path) > 30, "no desk path " + d.id + " len=" + (path ? sim.pathLength(path) : 0));
});

for (let i = 0; i < sim.SPOTS.length; i++) {
  for (let j = i + 1; j < sim.SPOTS.length; j++) {
    const a = sim.SPOTS[i];
    const b = sim.SPOTS[j];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    check(d >= 40, `spots too close ${a.id} ${b.id} ${d.toFixed(1)}`);
  }
}
sim.SPOTS.forEach((s) => {
  check(sim.isWalkable(grid, s.x, s.y), "spot blocked " + s.id + " " + s.x + "," + s.y);
  check(sim.aisleCost(s.x, s.y) > 1, "spot sits on walkway " + s.id);
  const intro = sim.introPoint(s.id, "amenity");
  check(sim.isWalkable(grid, intro.x, intro.y), "amenity intro blocked " + intro.x + "," + intro.y);
  const path = sim.findPath(grid, intro, s);
  check(path && sim.pathLength(path) > 24, "no amenity path " + s.id);
});

sim.DESKS.forEach((d) => {
  sim.SPOTS.forEach((s) => {
    const path = sim.findPath(grid, d.stand, s);
    check(!!path, "unreachable " + d.id + " → " + s.id);
  });
});

const blocks = sim.obstacleRects();
sim.SPOTS.forEach((s) => {
  blocks.forEach((b) => {
    const inside = s.x >= b.x && s.x < b.x + b.w && s.y >= b.y && s.y < b.y + b.h;
    check(!inside, s.id + " inside " + b.id);
  });
});

const now = Date.parse("2026-10-30T12:00:00+08:00");
const fresh = "2026-10-30T11:00:00+08:00";
const old = "2026-10-30T06:00:00+08:00";
const sticky = new Map();
const sample = [
  { id: "atom", status: "working", task: "build", lastActive: fresh },
  { id: "hongzai", status: "idle", task: "等下一輪", lastActive: fresh },
  { id: "langlang", status: "idle", task: "等 Aden 拍板", lastActive: fresh },
  { id: "fund", status: "bored", task: "bored", lastActive: old },
  { id: "ashu", status: "completed", task: "已交", lastActive: fresh },
  { id: "aying", status: "rest", task: "休息", lastActive: fresh },
  { id: "mech", status: "working", task: "ship", resting: true, lastActive: fresh },
  { id: "adai", status: "idle", task: "待命", zone: "ping", lastActive: fresh },
  { id: "aqing", status: "waiting", task: "queued", lastActive: fresh },
  { id: "newbie", name: "New", status: "working", task: "guest", lastActive: fresh },
];
const plan = sim.planDestinations(sample, now, sticky);
const byId = Object.fromEntries(plan.map((p) => [p.agent.id, p]));

check(byId.atom.kind === "desk" && byId.atom.chip === "working" && !byId.atom.stale, "atom desk working");
check(byId.hongzai.kind === "amenity" && byId.hongzai.chip === "idle", "hongzai amenity idle, 等下一輪 is not CONFIRM");
check(byId.langlang.kind === "desk" && byId.langlang.chip === "confirm" && byId.langlang.destKey === "desk:langlang", "langlang confirm at CEO desk");
check(byId.fund.kind === "amenity" && byId.fund.chip === "stale" && byId.fund.badge === "bored", "fund stale amenity");
check(byId.ashu.kind === "amenity" && byId.ashu.chip === "done", "completed without confirm rests");
check(byId.aying.kind === "amenity", "rest status amenity");
check(byId.mech.kind === "amenity", "resting:true leaves the desk");
check(byId.adai.zone === "ping", "zone ping override");
check(byId.aqing.kind === "amenity" && byId.aqing.chip === "idle", "waiting is amenity");
check(byId.newbie.destKey.indexOf("visitor:") === 0, "unknown working agent uses a visitor stand");

const ids = plan.filter((p) => p.kind === "amenity").map((p) => p.spotId);
check(new Set(ids).size === ids.length, "amenity spots are unique");

const again = sim.planDestinations(sample, now, sticky);
again.forEach((p) => {
  check(p.destKey === byId[p.agent.id].destKey, "sticky dest changed " + p.agent.id);
});

sample.find((a) => a.id === "fund").status = "working";
delete sample.find((a) => a.id === "fund").resting;
const after = sim.planDestinations(sample, now, sticky);
const afterBy = Object.fromEntries(after.map((p) => [p.agent.id, p]));
check(afterBy.fund.kind === "desk", "fund returns to desk when working");
["hongzai", "ashu", "aying", "adai", "aqing"].forEach((id) => {
  check(afterBy[id].destKey === byId[id].destKey, "others keep seats when fund leaves " + id);
});

check(sim.hkWeekMondayISO("2026-10-25T16:00:00.000Z") === "2026-10-26", "HKT Monday boundary");
check(sim.hkWeekMondayISO("2026-10-25T15:59:59.999Z") === "2026-10-19", "1ms before Monday stays previous week");
check(sim.hkMonthStartISO("2026-10-31T16:00:00.000Z") === "2026-11-01", "HKT month boundary");

const weekNow = new Date("2026-10-30T04:00:00.000Z");
const padded = sim.normalizeWeek({
  weekStart: "2026-10-26",
  completedByDay: [0, 1, 0, 0, 2],
  completedTotal: 3,
  activeDays: 2,
  workingMinutes: 90,
}, weekNow);
check(padded.stale === false && padded.completedByDay.length === 7 && padded.completedByDay[4] === 2, "pad short week arrays");
check(padded.completedTotal === 3 && padded.activeDays === 2, "week totals kept");

const staleWeek = sim.normalizeWeek({
  weekStart: "2026-10-19",
  completedByDay: [4, 4, 4, 4, 4, 4, 4],
  completedTotal: 28,
  workingMinutes: 400,
}, weekNow);
check(staleWeek.stale === true && staleWeek.completedTotal === 0 && staleWeek.completedByDay.every((n) => n === 0), "stale week zeros");

const monthOk = sim.normalizeMonth({ monthStart: "2026-10-01", completedTotal: 20 }, weekNow);
check(monthOk.stale === false && monthOk.completedTotal === 20, "current month kept");
const monthOld = sim.normalizeMonth({ monthStart: "2026-09-01", completedTotal: 9 }, weekNow);
check(monthOld.stale === true && monthOld.completedTotal === 0, "previous month zeros");

const live = JSON.parse(fs.readFileSync(path.join(__dirname, "status.json"), "utf8"));
const liveNow = Date.parse("2026-10-30T08:24:00.000Z");
const livePlan = sim.planDestinations(live.agents, liveNow, new Map());
const liveBy = Object.fromEntries(livePlan.map((p) => [p.agent.id, p]));
check(liveBy.atom.kind === "desk" && liveBy.atom.badge === "working", "live atom works at desk");
check(liveBy.langlang.chip === "confirm" && liveBy.langlang.kind === "desk", "live langlang confirm desk");
check(liveBy.abu.kind === "amenity" && liveBy.abu.chip === "stale", "live abu stale amenity");
check(liveBy.mech.kind === "amenity", "live mech idle amenity");
const liveSpots = livePlan.filter((p) => p.kind === "amenity").map((p) => p.spotId);
check(new Set(liveSpots).size === liveSpots.length, "live amenity spots unique");
livePlan.forEach((p) => {
  const intro = sim.introPoint(p.agent.id, p.kind);
  const path = sim.findPath(grid, intro, p);
  check(path && sim.pathLength(path) > 20, "live path " + p.agent.id);
});

if (failures.length) {
  console.error(failures.join("\n"));
  console.error("--- amenity column (x 660-910, # blocked . aisle , floor) ---");
  for (let y = 70; y < 600; y += 10) {
    let row = String(y).padStart(3, " ") + " ";
    for (let x = 660; x < 910; x += 10) {
      const c = Math.floor(x / 10);
      const r = Math.floor(y / 10);
      const v = grid[r][c];
      row += v === 0 ? "#" : v === 1 ? "." : v >= 5 ? "c" : ",";
    }
    console.error(row);
  }
  process.exit(1);
}

console.log("office-layout ok", {
  desks: sim.DESKS.length,
  spots: sim.SPOTS.length,
  live: livePlan.map((p) => p.agent.id + ":" + p.chip + ":" + (p.kind === "desk" ? "desk" : p.zone + "/" + p.spotId)).join(" | "),
});
