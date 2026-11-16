# The radar-2 value model

How this entry turns the sealed DefiLlama snapshot (as of 2026-11-14) into a ranked board of
protocols that record no token of their own. Everything below is computed by `lib/model.ts` at run
time from the snapshot itself; the dashboard carries the same constants and the same calibration
table (both are written into `data.js` by the same computation that writes `board.json`), and every
board row carries its own decomposition, so any single value on the board can be checked by hand.

## The formula

```
implied_value_usd = TVL x category_multiple x growth_factor x maturity_factor
```

rounded to whole dollars, minimum $1. Rows sort by implied value descending; ties break by TVL
descending, then slug ascending. One function scores every row. No protocol's name is ever
special-cased — a row's value depends only on its TVL, its category, its 7-day TVL change and its
listing date.

## The category multiple — calibrated on the snapshot's own launches

A launch that has not happened is priced off launches that have. The calibration set is the **129
protocols in the snapshot that carry a market cap** (a recorded cap of exactly $0 is DefiLlama's
way of writing "no market cap" — 15 rows carry one and do not calibrate; the single row carrying a
−$1 placeholder cap stays in the set as recorded and moves no median). For each category:

```
raw median   = median(mcap / TVL) over the category's calibration rows
multiple     = clamp( w x raw median + (1 - w) x global median,  0.02,  2.5 ),   w = n / (n + 8)
```

The global median mcap/TVL across the 129 is **0.2049** (p25 0.0441, p75 1.0435 — the dispersion is
wide, which is exactly why the shrinkage and the clamp exist). A category with no calibration rows
takes the global median, 0.2049.

| Category | n | Raw median | Multiple used |
| --- | ---: | ---: | ---: |
| AI Agents | 2 | 0.6047 | 0.2849 |
| Basis Trading | 7 | 0.6544 | 0.4147 |
| Bridge | 6 | 0.5567 | 0.3557 |
| Canonical Bridge | 8 | 0.7464 | 0.4756 |
| CDP | 3 | 0.1687 | 0.1950 |
| CEX | 9 | 0.0748 | 0.1360 |
| Chain | 1 | 3.0264 | 0.5184 |
| Collateral Management | 1 | 12.1602 | 1.5333 |
| Cross Chain Bridge | 4 | 1.2205 | 0.5434 |
| DOR | 1 | 0.0898 | 0.1921 |
| Decentralized AI | 1 | 2.0604 | 0.4111 |
| Derivatives | 2 | 2.1619 | 0.5963 |
| Dexs | 11 | 0.3424 | 0.2845 |
| Dual-Token Stablecoin | 1 | 0.0316 | 0.1857 |
| Indexes | 3 | 0.1477 | 0.1893 |
| Launchpad | 1 | 0.1306 | 0.1966 |
| Lending | 15 | 0.1324 | 0.1576 |
| Leveraged Farming | 1 | 0.1725 | 0.2013 |
| Liquid Restaking | 2 | 0.1828 | 0.2005 |
| Liquid Staking | 9 | 0.0406 | 0.1179 |
| Liquidity Manager | 1 | 0.0150 | 0.1838 |
| NFT Marketplace | 1 | 2.0017 | 0.4046 |
| Onchain Capital Allocator | 2 | 0.0125 | 0.1664 |
| Options | 1 | 1.5145 | 0.3504 |
| Payments | 2 | 0.1813 | 0.2002 |
| Prediction Market | 1 | 400.2045 | 2.5000 |
| Privacy | 3 | 0.9691 | 0.4133 |
| RWA | 9 | 0.2748 | 0.2419 |
| Restaking | 2 | 0.0246 | 0.1689 |
| Risk Curators | 1 | 2.9747 | 0.5127 |
| Staking Pool | 2 | 0.0018 | 0.1643 |
| Token Locker | 2 | 9.5204 | 2.0680 |
| Yield | 10 | 0.1802 | 0.1912 |
| Yield Aggregator | 4 | 0.1510 | 0.1869 |

Two rows of this table deserve a reader's suspicion, and get it here rather than in fine print.
**Prediction Market** rests on a single comparable whose token trades at 400x its on-platform TVL
(a prediction market's TVL is just the collateral in open markets; its token prices the franchise,
not the float). Shrinkage pulls 400.20 to 44.6 and the clamp caps it at 2.5 — the multiple is the
cap, not the comparable, and every Prediction Market row on the board shows `n = 1` beside it.
**Risk Curators**, the board's largest category by TVL, also rests on a single comparable (raw
median 2.9747, shrunk by its 1/9 weight to 0.5127). The shrinkage is doing visible work in both
cases; neither category's raw median is ever used directly.

## The growth factor

```
growth_factor = 1 + clamp(change_7d, -50, +100) / 100 x 0.4        (range 0.80 – 1.40)
```

An unreported change (4 protocols in the snapshot) is neutral: the factor is exactly 1.0, stated
here rather than hidden. Why a tilt at all, and why this size: in the calibration set, median
mcap/TVL rises across the well-populated momentum bins — 0.148 for protocols whose TVL fell
5–20% in the week, 0.275 for those down less than 5%, 0.300 for those flat-to-rising — so the
market does pay something for momentum. But those bins are confounded (one down week in a falling
market is not a quality signal), and the extreme bins hold single-digit counts, so the weight is
kept at 0.4 — deliberately below the house starter model's 0.5, with tighter clamps (−50/+100
against its −60/+120). A week of TVL weather can move a value by at most ±40%; it can never
outrank a category multiple or a TVL difference of real size.

## The maturity factor

```
maturity_factor = 0.7 + 0.3 x min(age_days, 1095) / 1095            (range 0.70 – 1.00)
```

Age is days from the protocol's listing date to the snapshot date. When the snapshot reports no
listing date (7 of the board's 198 rows), the factor — and only the factor — borrows the board's
median known age, **418 days**; the row still shows its age as unreported. Why this shape: the
calibration cross-section shows **no monotone age premium** — median mcap/TVL by age bin runs
0.159 (6–12 months), 0.362 (1–2 years), 0.125 (2–3 years), 0.169 (3 years+) — so a steep or long
ramp would be fitting noise. The factor is kept shallow on purpose: it encodes one narrow claim,
that a protocol which has operated for years with no token has demonstrated the survival a launch
needs, and it can move a value by at most x0.70–x1.00 — never enough to outrank a multiple or a
TVL gap. It saturates at three years.

## What the board covers, and why

The board holds **198 rows**: all 40 watchlist slugs, plus the 158 other protocols that pass the
same test the house applies to the watchlist — records no token; is not a wrapped, staked or
bridged product of a token that already trades (categories Bridge, Canonical Bridge, Liquid
Staking, Liquid Restaking, Restaked BTC, or a name carrying the whole word wrapped, staked or
staking); is not an exchange (category CEX or an exchange's name as a prefix); does not end in a
version marker — applied at **any TVL**, not just above the $50M floor. The starter board caps its
early rows at a top-160-by-TVL sample under weaker exclusions; this board instead takes the whole
eligible universe the snapshot offers, so "early" here means "everything that could still launch
a token of its own", and nothing eligible is missing merely for being small. Protocols that
already trade are shown apart in the dashboard's live view at the market's own values and are
never ranked by the model.

## The honest limits

- The calibration set is 129 protocols, and some categories the board leans on have one or two
  comparables. Shrinkage and the clamp bound the damage, and every row prints its category's `n`,
  but a multiple with n = 1 is an argument, not a measurement.
- mcap/TVL is a ratio of two noisy figures: TVL is counted differently across protocols, and a
  token's market cap prices float, speculation and unlock schedules this snapshot cannot see. The
  model claims an order of magnitude and a ranking, not a price.
- The growth and maturity factors are priors disciplined by the cross-section, not fitted
  coefficients; their amplitudes are chosen small because the data supports their direction more
  strongly than their size.
- "Records no token" is the snapshot's statement, not a promise: a protocol may have announced,
  issued on another venue, or abandoned any launch. The board ranks the snapshot's world as of
  2026-11-14, and says so.
