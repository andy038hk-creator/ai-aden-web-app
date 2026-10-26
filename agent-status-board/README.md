# Pixel Office Agent Status Board

Self-contained pixel-office view of agent status. Sprites are base64-embedded in `status-board.html`. The PNGs in `sprites/` (plus `sprites/mapping.json`) are the fallback paths.

## How to open

`status.json` is loaded with `fetch`, so use a local HTTP server (opening the file directly can fail the poll and fall back to the sample baked into the HTML):

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

The board polls `status.json` every 5 seconds over HTTPS (`cache: "no-store"`). Commit an updated `status.json` to `main`; once Pages republishes, open boards pick up the new file on the next poll. If that fetch fails, the page keeps showing the sample embedded in `status-board.html`.

Weekly completion counts reset every Monday 00:00 Asia/Hong_Kong. A `week.weekStart` that is missing or not this Monday (`YYYY-MM-DD`) is ignored, and the desk bars, totals, and 本週工作量排行 show zero.
