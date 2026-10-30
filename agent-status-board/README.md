# Aden Studio · Office status board

Pixel-office view of agent status. The floor follows the approved Office v2 wire: team mats (內容 / 求職 / 工程 / 研究 / CEO), a wood walkway, and a pantry / lounge / ping-pong column. Sprites walk between a desk and those amenity seats. `sprites/*.png` are the characters (`sprites/mapping.json` is the older sheet index).

## How to open

`status.json` is loaded with `fetch`, so use a local HTTP server (opening the file directly falls back to the sample embedded in `status-board.html`):

```bash
cd agent-status-board
python3 -m http.server 8080
```

Then open [http://localhost:8080/](http://localhost:8080/) (folder `index.html` redirects to the board) or [http://localhost:8080/status-board.html](http://localhost:8080/status-board.html).

## GitHub Pages

After this folder is on `main` and the existing Pages workflow deploys:

https://andy038hk-creator.github.io/ai-aden-web-app/agent-status-board/status-board.html

The folder URL redirects to the same page:

https://andy038hk-creator.github.io/ai-aden-web-app/agent-status-board/

## Updating live data

The board polls `status.json` every 5 minutes over HTTPS (`cache: "no-store"`). The 4h sync still owns that file: commit an updated `status.json` to `main`; once Pages republishes, open boards pick up the new file on the next poll. A failed poll keeps the last good copy. If the first fetch fails, the page shows the sample embedded in `status-board.html` (it can lag the file). **載入 JSON** reads a local file and pauses polling until **重新讀取**.

No new required fields. Optional ones below are read when present and ignored by older sync jobs.

## Where agents walk

Destinations are chosen in the browser from the current `status.json`. They do not teleport: a coarse 10px grid A* (walkway cells cheaper, desks and solid furniture blocked) plus a short string-pull produces the path. A status change that picks a new seat replans from where the sprite already is.

| Situation | Where they go | Badge |
| --- | --- | --- |
| `working` / `busy` / `active` | That agent's named desk | green `working` |
| CONFIRM (see below) | Their desk | pulsing `CONFIRM` |
| `idle` / `waiting` / `bored` / `rest` / `completed` / `done` | A free amenity seat | quiet `idle` / `bored` / `done`, or `>4h` if stale |
| No matching desk, but they should be working | A visitor stand near the aisle | same as working |

Amenity choice, stable for the browser session so a poll does not reshuffle everyone:

- Prefer the lounge (sofa, armchair, pouf, floor).
- Sometimes the pantry (bar stools / snack side), about 3 in 10.
- Rarely ping-pong, about 1 in 10.
- `bored` prefers the lounge.
- Seats are claimed so two agents do not stand on the same pixel. Extra people overflow along the lounge floor.

Stale is a badge, not a destination. `lastSeen`, else `lastActive`, else `lastCompleted`, else `updated_at`, older than 4 hours → `>4h`. Working and CONFIRM stay at the desk with a small pip. Idle-like states already sit in an amenity, and the main badge becomes `>4h`.

CONFIRM (desk, loudest) when any of these hold and the agent is not in a resting override:

- `status` is `confirm`, `needs_confirm`, or `waiting_confirm`
- optional `confirm: true`
- `status` or `task` matches `CONFIRM`, `等 Aden`, `待拍板`, `等你拍板`, `等你確認`, `待確認`, `要你確認`

`等下一輪` is not CONFIRM.

Optional overrides (sync does not have to send them):

- `zone`: `desk` | `lounge` | `pantry` | `ping` | `amenity`
- `resting: true` (or `status` `rest` / `resting`) forces an amenity even if `working`
- `lastSeen`: alias for `lastActive` when you want a distinct timestamp

`prefers-reduced-motion` places sprites on their seat without the walk.

## Week / month tabs

本週 and 本月 stay behind the click tabs. They still read `week` and `month` on each agent.

Weekly completion counts reset every Monday 00:00 Asia/Hong_Kong. A `week.weekStart` that is missing or not this Monday (`YYYY-MM-DD`) is ignored, and the bars, totals, active days, and minutes show zero.

Monthly completion counts reset at 00:00 Asia/Hong_Kong on the 1st. A `month.monthStart` that is missing or not this month's first day (`YYYY-MM-01`) is ignored, and 本月完成 shows zero.

An open board re-zeroes those tabs at the boundary even before the next fetch. `completedByDay` shorter than seven entries is padded (Monday first).
