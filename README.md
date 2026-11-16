[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/nothing010101/makefun-frontend/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/nothing010101/makefun-frontend/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

# Leanboard

A fast, lean frontend for [make.fun](https://make.fun/bounty/makefun-frontend-01) — built for the "Build the best make.fun frontend" bounty ($500 + entry fees, 20 paid places).

Static files, no build step, no framework, no sign-in. It reads make.fun's public API alone and shows all four surfaces, each reachable by a link and by its own URL:

- **Board** (`#/`): the live bounties with each one's live pot, entry fee, time left and entries — type-to-filter, sort by closing / pot / entries / newest, open-only toggle.
- **Bounty page** (`#/bounty/<slug>`): summary, live pot, entry fee, deadline, rewards table (prize + fee share), description, full rules, latest entries.
- **Leaderboard** (`#/bounty/<slug>/leaderboard`): the bounty's ranked entries, virtualized — only the rows around your scroll position are in the page, so a 3,000-row board costs ~40 rows of DOM. Filter by handle or title.
- **Profile** (`#/u/<handle>`): an account's public profile — record (entered / placed / won / best place / prize) and its entries.

## Why it is fast

- **First load is one file.** `app/index.html` carries its CSS inline and boots with a dynamic `import('./app.js')`, so the app module loads after the first load and is not in it. First load: 1 file, ~1 KB gzipped.
- **API answers are cached and revalidated.** Responses are kept in memory, reused fresh for 60 s, then revalidated with `If-None-Match` (the API's ETags are bound to the minute) — an unchanged answer costs a 304 and no body. One request per view.
- **No images, fonts or third-party code are loaded at all.** System font stack, inline CSS, one module.

## Run

```sh
node serve.ts   # serve app/ locally, then open http://localhost:8080
```

Any static file server works with `app/` at its root. To build the submission output:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Files

- `app/index.html` — shell, inline CSS, boot (dynamic import)
- `app/app.js` — the whole app: ETag-cached API client, hash router, four views, virtualized leaderboard
- `main.ts` — entry program: copies `app/` + `screenshots/` to `/output`, writes `dossier.json`
- `vendor/makefun-frontend.ts` — the kit's dossier library, unchanged
- `screenshots/` — 3 screenshots of the running app on live make.fun data
