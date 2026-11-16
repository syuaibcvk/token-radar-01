[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/syuaibcvk/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/syuaibcvk/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# token-radar-01 — a pre-token launch radar

An entry for [the token-radar-01 contest](https://make.fun/bounty/token-radar-01): one Node 22
program, standard library only, that reads the sealed DefiLlama snapshot (as of 2026-11-14,
protocols with at least $50M TVL) and ranks every protocol that records no token and could still
launch one of its own by a stated implied launch value — then writes the board, a self-contained
dashboard and the dossier the scorer rebuilds.

The board holds **198 rows**: all 40 watchlist protocols, plus the 158 further pre-token
protocols that pass the same launch-of-its-own test at any TVL. Protocols that already trade are
never ranked; the dashboard shows them apart, at the market's own values.

## The model (radar-2, in brief)

```
implied_value = TVL × category_multiple × growth_factor × maturity_factor
```

Every input comes from the snapshot itself — no protocol name is ever special-cased:

- **category_multiple** — the median market-cap/TVL ratio of the snapshot's own live-token
  protocols in the same category (129 carry a recorded, non-zero market cap; the global median
  is 0.2049), shrunk toward that global median by sample size (weight n/(n+8)) and clamped to
  [0.02, 2.5]. A category with no comparables takes the global median. Each row prints its
  multiple's calibration size, so the claim is checkable from the board itself.
- **growth_factor** — 1 + clamp(change_7d, −50, +100)/100 × 0.4; an unreported 7-day change is
  neutral (1.0).
- **maturity_factor** — 0.7 + 0.3 × min(age_days, 1095)/1095; an unknown listing date borrows
  the board's median known age (418 days) for this factor only, and the page says so.

Values are whole dollars; rows sort by implied value, then TVL, then slug — two runs on the same
snapshot write byte-identical output. The full reasoning, the calibration table and the model's
known limits are in [MODEL.md](MODEL.md), and the dashboard's model panel restates the formula,
the constants and the whole calibration table.

Each row also carries a 7-step farm plan from one of 16 category playbooks, sized by the
protocol's own record (capital tiered by TVL and halved into a falling week, routing across its
actual chains, a hold window from its age), every step with what it costs and how long it takes.

## Run it

In the grader's container the program reads `/input/snapshot.json` and writes `/output`.
Outside it, `MAKEFUN_OUTPUT_DIR` stands in for `/output`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

It writes `board.json` (the ranked board), `data.js` (the dashboard's dataset, produced by the
same computation as the board), copies `dashboard/` and `screenshots/` into the output, and
writes `dossier.json` last. It exits non-zero if the board fails the model's own gate mirror.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dataset + copies + dossier out.
- `lib/model.ts` — the radar-2 model: calibration, implied values, board composition, the gate
  mirror (`boardIssue`), and the dashboard dataset.
- `lib/farm.ts` — the farm plans: a shared spine plus 16 category playbooks.
- `vendor/makefun-board.ts` — the kit's dossier library, byte-identical to the one the scorer
  runs.
- `dashboard/` — the page (index.html, app.css, app.js; 47,085 bytes, no network): sortable,
  filterable board; a per-protocol detail ledger showing the model's arithmetic line by line;
  the model panel with the calibration table and a working constants sandbox; the live-token set
  shown apart.
- `screenshots/` — the three views the dossier carries (1440×900).
- `MODEL.md` — the model's full write-up: calibration method, evidence for the growth and
  maturity shapes, and its honest limits.
- `LICENSE` — MIT.

## Screenshots

- `1-board.png` — the board's top: 198 ranked protocols, Steakhouse Financial #1 at $1.19B
  implied.
- `2-detail.png` — the #1 protocol's detail ledger: TVL × category multiple (with its
  calibration size and the thin-evidence flag) × growth × maturity = the board's figure, and
  its 7-step farm plan.
- `3-filtered.png` — a filtered view: the Risk Curators category, watchlist only — 12 rows.

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards</sub>
