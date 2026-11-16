// The token radar's valuation model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token of their own — every watchlist slug, plus every
// other protocol in the snapshot that passes the same "a launch of its own" test the house applies
// to the watchlist (no wrapped/staked/bridged product of another token, no exchange, no versioned
// pool), at any TVL. Protocols that already trade are never ranked: the dashboard shows them apart,
// at the market's own values.
//
// The implied value of a launch that has not happened yet is read off the launches that have:
//
//   implied = TVL x category_multiple x growth_factor x maturity_factor
//
// category_multiple is calibrated on the snapshot itself: among the protocols that carry a market
// cap, take the median mcap/TVL inside the protocol's own category, then shrink that median toward
// the global median (0.205) with weight n/(n+8), so a category with two wild comparables cannot
// shout down fifteen sober ones, and clamp the result to [0.02, 2.5]. A category with no comparable
// at all takes the global median. growth_factor tilts for the week's TVL momentum and
// maturity_factor for time survived with no token; both are deliberately shallow — the calibration
// cross-section supports their direction, not a stronger amplitude (MODEL.md shows the bins).
// Every input is a figure in the snapshot. No protocol's name is ever special-cased: one function
// scores every row, and every row carries its own arithmetic so the reader can check it.

import { farmSteps, stepText } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The model's version label: the dashboard names it and MODEL.md documents it. */
export const MODEL_VERSION = 'radar-2';

/**
 * The model's constants — the single source the dashboard copies. Changing one number here changes
 * every value on the board; there are no other numbers hidden in the code.
 */
export interface ModelConstants {
  /** Shrinkage strength: a category median is trusted with weight n/(n+shrink_k). */
  shrink_k: number;
  /** The band every category multiple is clamped into. */
  multiple_floor: number;
  multiple_cap: number;
  /** growth_factor = 1 + clamp(change_7d, floor, cap)/100 x growth_weight. */
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  /** maturity_factor = maturity_floor + maturity_range x min(age_days, maturity_days)/maturity_days. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  /** How many live-token protocols the dashboard's set-aside view carries, by market cap. */
  live_rows: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 8,
  multiple_floor: 0.02,
  multiple_cap: 2.5,
  growth_weight: 0.4,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  live_rows: 24,
};

/** One row of the calibration table: a category, its comparables, and the multiple they earn. */
export interface CalibrationRow {
  category: string;
  /** How many live protocols in this category carry a market cap. */
  n: number;
  /** Their median mcap/TVL, before shrinkage. */
  raw_median: number;
  /** The multiple the model uses: the raw median shrunk toward the global median, then clamped. */
  multiple: number;
}

/** The calibration set's summary and its per-category table, computed from the snapshot itself. */
export interface Calibration {
  /** How many protocols carry a market cap and so can calibrate (129 in this snapshot). */
  size: number;
  global_median: number;
  p25: number;
  p75: number;
  rows: CalibrationRow[];
}

/**
 * Whether a protocol can calibrate the model: it carries a market cap figure. A recorded cap of
 * exactly $0 is DefiLlama's way of writing "no market cap" (15 rows in this snapshot carry one),
 * so those rows do not calibrate; the one row carrying a −$1 placeholder cap stays in the set, as
 * recorded — it sits at the bottom of its category's ratios and moves no median.
 */
export function isCalibrationRow(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd !== 0 && p.tvl_usd > 0;
}

/** The median of a non-empty list, computed the plain way. */
function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A quantile of a non-empty list by nearest rank. */
function quantileOf(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** The category key used everywhere: the snapshot's word for it, or a plain label when it has none. */
export function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorised';
}

/** The calibration: per-category median mcap/TVL, shrunk toward the global median and clamped. */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const rows = snapshot.protocols.filter(isCalibrationRow);
  const all = rows.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = medianOf(all);
  const byCategory = new Map<string, number[]>();
  for (const p of rows) {
    const key = categoryKey(p);
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const table: CalibrationRow[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      const raw = medianOf(ratios);
      const w = ratios.length / (ratios.length + model.shrink_k);
      const shrunk = w * raw + (1 - w) * global;
      return { category, n: ratios.length, raw_median: round4(raw), multiple: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk))) };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { size: rows.length, global_median: round4(global), p25: round4(quantileOf(all, 0.25)), p75: round4(quantileOf(all, 0.75)), rows: table };
}

/** The multiple one category scores at: its calibrated row, or the global median when it has none. */
export function multipleFor(calibration: Calibration, category: string): { multiple: number; n: number; raw_median: number | null } {
  const row = calibration.rows.find((r) => r.category === category);
  if (row === undefined) return { multiple: calibration.global_median, n: 0, raw_median: null };
  return { multiple: row.multiple, n: row.n, raw_median: row.raw_median };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const DAY_MS = 86_400_000;

/** A whole day count from listing to the snapshot's date, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are products of another protocol's token, or an exchange itself. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word that marks it as another token, wrapped or staked. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether the board may rank a protocol: it records no token, and it is a candidate for a launch
 * of its own — not a wrapped, staked or bridged product of a token that already trades, not an
 * exchange, not a versioned pool. This is the watchlist's own test, applied at any TVL.
 */
export function isBoardEligible(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPER_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** One protocol's full scoring: the implied value and every piece of arithmetic that produced it. */
export interface Scored {
  implied: number;
  multiple: number;
  calibration_n: number;
  category_median: number | null;
  growth_pct: number | null;
  growth_mult: number;
  maturity_mult: number;
  age: number | null;
  age_used: number;
}

/**
 * Score one protocol. `fallbackAge` is the board's median known age, used for the maturity factor
 * (and stated on the page) when the snapshot reports no listing date; the row still shows its age
 * as unknown — only the factor borrows the median.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, calibration: Calibration, fallbackAge: number, model: ModelConstants = MODEL): Scored {
  const { multiple, n, raw_median } = multipleFor(calibration, categoryKey(p));
  const age = ageDays(asOf, p.listed_at);
  const ageUsed = age ?? fallbackAge;
  const growthPct = p.change_7d === null ? null : Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, p.change_7d));
  const growthMult = 1 + ((growthPct ?? 0) / 100) * model.growth_weight;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageUsed, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
  return {
    implied,
    multiple,
    calibration_n: n,
    category_median: raw_median,
    growth_pct: growthPct,
    growth_mult: round4(growthMult),
    maturity_mult: round4(maturityMult),
    age,
    age_used: ageUsed,
  };
}

/** One row of board.json: the snapshot's record, the model's arithmetic, and the farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  /** True when the snapshot's watchlist carries this slug. */
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    calibration_n: number;
    category_median: number | null;
    global_median: number;
    growth_pct: number | null;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days_used: number;
  };
  farm_steps: string[];
}

/** The headline figures: how many watchlist slugs, how many rows, how the rows split. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * The board: every watchlist slug (the floor — included even if one somehow failed the eligibility
 * test, because coverage is the gate's first row and is never gambled), plus every other eligible
 * pre-token protocol in the snapshot, ranked by implied value. Ties break by TVL, then by slug, so
 * two runs of the same snapshot write the same bytes.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; calibration: Calibration; fallbackAge: number } {
  const calibration = calibrate(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isBoardEligible(p)) chosen.set(p.slug, p);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const knownAges = [...chosen.values()].map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallbackAge = Math.floor(medianOf(knownAges));

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, calibration, fallbackAge, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      calibration_n: s.calibration_n,
      category_median: s.category_median,
      global_median: calibration.global_median,
      growth_pct: s.growth_pct,
      growth_multiplier: s.growth_mult,
      maturity_multiplier: s.maturity_mult,
      age_days_used: s.age_used,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
  return { board, calibration, fallbackAge };
}

/** A live-token protocol: it already trades, so the page shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The live set, set aside from the ranking: token-bearing, not an exchange, by market cap. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, model.live_rows)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** The dashboard's compact view of one board row, with the model's arithmetic kept alongside. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  calibration_n: number;
  growth_pct: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** The row's farm plan, copied from the board row so the page shows the board's own steps. */
  farm_steps: string[];
}

/** The model as the dashboard states it: the constants, the calibration it ran, the fallback age. */
export interface RadarModelInfo {
  version: string;
  constants: ModelConstants;
  calibration_size: number;
  global_median: number;
  calibration_p25: number;
  calibration_p75: number;
  calibration: CalibrationRow[];
  fallback_age_days: number;
}

/** Everything the dashboard renders, from the one computation that also writes board.json. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: RadarModelInfo;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    calibration_n: row.model.calibration_n,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard needs, from the same computation as the board. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration, fallbackAge } = buildBoard(snapshot, model);
  const live = liveRows(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      version: MODEL_VERSION,
      constants: model,
      calibration_size: calibration.size,
      global_median: calibration.global_median,
      calibration_p25: calibration.p25,
      calibration_p75: calibration.p75,
      calibration: calibration.rows,
      fallback_age_days: fallbackAge,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * Why a board is not one the gate will take, or null. Mirrors the gate's board rows: 100–4,000
 * rows, every watchlist slug covered, slugs unique and drawn from the snapshot, ranks exactly
 * 1..N, implied values positive whole dollars under the cap and never rising as rank ascends, not
 * all one value, and every farm plan 3–12 steps of 20–600 characters once trimmed.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows: the gate takes 100 to 4,000`;
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
    if (!snapshotSlugs.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share one implied value: a board that ranks nothing by value is not a ranking`;
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
