// Farm plans for the token radar: one plan per protocol, generated from the protocol's own record —
// its category, its chains, its TVL and its age — never from a hand-written list of names.
//
// Every plan has seven steps. Steps 1, 2, 5, 6 and 7 are the shared spine (wallet safety, routing
// the capital in, a weekly cadence, the hold and the claim-safety rule, the log and the exit); steps
// 3 and 4 come from a playbook for the protocol's category, so a lending market's plan reads like
// lending and a prediction market's reads like prediction. The numbers inside the steps move with
// the record: the capital is tiered by the protocol's TVL and halved when its TVL fell more than
// 10% in the snapshot's 7 days, the gas notes name its actual chains, and the hold window is set by
// its age. Each step is one string — the action, then "Cost: …", then "Time: …" — and the board's
// gate holds every string to 20–600 characters once trimmed.

import type { SnapshotProtocol } from './model.ts';

/** One farm step before it is flattened to a string: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: the action, then its cost and time. The board gate trims, then measures. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A whole-dollar figure the way a reader scans it: $2.76B, $172.3M, $5.0M. */
export function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n}`;
}

/** The protocol's chains as a phrase, at most three: "Ethereum, Base and Arbitrum". */
function chainsPhrase(p: SnapshotProtocol): string {
  const cs = p.chains.slice(0, 3);
  if (cs.length === 0) return 'its home chain';
  if (cs.length === 1) return cs[0]!;
  if (cs.length === 2) return `${cs[0]} and ${cs[1]}`;
  return `${cs[0]}, ${cs[1]} and ${cs[2]}`;
}

/** A name's possessive: "Steakhouse's", but "UltraYield Vaults'" when the name already ends in s. */
function poss(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/** The first chain the protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction roughly costs on a chain, in the words a farmer budgets by. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'about $6 of gas on Ethereum';
  if (chain === 'Solana') return 'well under $0.05 of fees on Solana';
  return `about $0.25 of gas on ${chain}`;
}

/** What a weekly cadence roughly costs on a chain. */
function weeklyGas(chain: string): string {
  if (chain === 'Ethereum') return 'about $5 of gas a week on Ethereum';
  if (chain === 'Solana') return 'a few cents of fees a week on Solana';
  return 'about $1 of gas a week';
}

/**
 * How much capital one farm position carries, from the protocol's own TVL — bigger protocols are
 * more crowded farms, so the position grows with them — halved when the snapshot shows the
 * protocol's TVL down more than 10% in 7 days.
 */
export function capitalFor(p: SnapshotProtocol): { capital: number; halved: boolean } {
  let base = 50;
  if (p.tvl_usd >= 5_000_000_000) base = 250;
  else if (p.tvl_usd >= 1_000_000_000) base = 150;
  else if (p.tvl_usd >= 100_000_000) base = 100;
  else if (p.tvl_usd >= 10_000_000) base = 75;
  const halved = p.change_7d !== null && p.change_7d < -10;
  return { capital: halved ? Math.round(base / 2) : base, halved };
}

/** How long to hold, from the protocol's age: younger protocols get the longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The playbook a category plays: two action steps, written for that kind of protocol. */
type Playbook = (ctx: PlanCtx) => [FarmStep, FarmStep];

/** Everything a playbook step may use: the protocol's own figures, pre-digested. */
interface PlanCtx {
  name: string;
  capital: number;
  chain: string;
  chains: string;
  gas: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  lending: (c) => [
    {
      text: `Supply $${c.capital} of USDC to ${c.name} on ${c.chain} as the base position: USDC is the deepest market on most lending deployments and the easiest to exit cleanly.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Borrow a small amount — at most 30% of what the supplied collateral allows — re-supply it once, then repay it within the week: one clean borrow-and-repay cycle shows real use without leaving liquidation risk open.`,
      cost: 'a few days of borrow interest, usually under $2',
      time: '20 minutes, then 5 minutes to repay',
    },
  ],
  dex: (c) => [
    {
      text: `Add $${c.capital} of liquidity to ${poss(c.name)} busiest stable or blue-chip pool on ${c.chain}, split evenly between the two sides of the pair, and keep the position in range.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '20 minutes',
    },
    {
      text: `Make two or three ordinary swaps a week through ${poss(c.name)} own interface — small, real trades in pairs you already hold — so the wallet reads as a user of the exchange, not a liquidity-only farmer.`,
      cost: 'swap fees of a few cents to $1 a trade',
      time: '5 minutes a swap',
    },
  ],
  derivatives: (c) => [
    {
      text: `Deposit $${c.capital} of USDC as margin on ${c.name} and open one small position — a hedge against a spot holding is the most defensible use — sized so a 20% adverse move cannot liquidate it.`,
      cost: `$${c.capital} of margin plus ${c.gas}`,
      time: '20 minutes',
    },
    {
      text: `Roll or adjust the hedge once a week and keep the total size small: the goal is a steady, ordinary trading history on ${c.name} across the season, not a profit target.`,
      cost: 'funding and fees of a few dollars a week',
      time: '10 minutes a week',
    },
  ],
  curator: (c) => [
    {
      text: `Deposit $${c.capital} of USDC into one of ${poss(c.name)} established vaults on ${c.chain}: pick the vault with the longest track record and the deepest liquidity, not the highest advertised yield.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Check the vault's allocation once a month and follow the curator once — move to a sibling vault or top up after a rebalance — because following the curator's own moves is the activity pattern these vaults exist to reward.`,
      cost: 'one extra transaction a month, about $1 of gas',
      time: '10 minutes a month',
    },
  ],
  allocator: (c) => [
    {
      text: `Allocate $${c.capital} into one strategy on ${c.name} on ${c.chain} and keep the vault shares in the farming wallet: moving them to a second wallet breaks the activity trail the strategy can see.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Top the position up by about 10% once a month, and claim any strategy rewards back into the same position instead of cashing them out, so the balance compounds in one visible place.`,
      cost: 'about $15 a month of new capital plus gas',
      time: '10 minutes a month',
    },
  ],
  aggregator: (c) => [
    {
      text: `Deposit $${c.capital} of USDC into ${poss(c.name)} main auto-compounding vault on ${c.chain} and leave compounding switched on: the harvest history is the visible activity.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Once a month, move 10–20% of the position into a second vault on ${c.name} and back after a week, so the wallet's history covers more than one of the aggregator's products.`,
      cost: 'two transactions a month, about $1 of gas in total',
      time: '10 minutes a month',
    },
  ],
  yield: (c) => [
    {
      text: `Deposit $${c.capital} of USDC into ${poss(c.name)} core yield position on ${c.chain} and keep the receipt token in the farming wallet for the whole season.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Harvest or compound the yield once a week in the same pattern each time, and never chase the highest-APY pool of the week: consistency across snapshots is what a points program can count.`,
      cost: 'about $1 of gas a week',
      time: '10 minutes a week',
    },
  ],
  rwa: (c) => [
    {
      text: `Subscribe $${c.capital} to ${poss(c.name)} yield product on ${c.chain} from the protocol's own page; if it runs an eligibility or identity check, complete it there — never through a third-party link or a search ad.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '20 minutes, plus any eligibility check',
    },
    {
      text: `Hold the position to its first maturity or redemption window instead of exiting early, and write the redemption date into the farm log on the day you subscribe.`,
      cost: 'the capital is committed until the window',
      time: '5 minutes to log, then the term itself',
    },
  ],
  stable: (c) => [
    {
      text: `Deposit $${c.capital} of collateral (USDC or ETH) into ${c.name} on ${c.chain} and mint or buy its stable asset at a conservative ratio, keeping the position's health factor above 2.0 at all times.`,
      cost: `$${c.capital} of collateral plus ${c.gas}`,
      time: '20 minutes',
    },
    {
      text: `Use the minted stable asset once in a real way — a swap or a deposit into a listed pool — then check the health factor weekly and top up collateral before ever adding risk.`,
      cost: 'one swap fee, usually under $1',
      time: '10 minutes a week',
    },
  ],
  basis: (c) => [
    {
      text: `Deposit $${c.capital} of USDC into ${poss(c.name)} basis-trade vault on ${c.chain}: the vault runs the hedge itself, so your job is to be an early and steady depositor, not a trader.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Watch the vault's reported funding yield once a month; if it turns negative at two checks in a row, withdraw to stables and wait rather than paying to stay exposed.`,
      cost: 'nothing to check; one withdrawal if you leave',
      time: '5 minutes a month',
    },
  ],
  insurance: (c) => [
    {
      text: `Buy $${c.capital} of cover from ${c.name} on ${c.chain} against a position you actually hold, for the longest term the premium allows.`,
      cost: `the premium on $${c.capital} of cover plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `If ${c.name} offers a risk pool, stake about 10% of the cover's value into it as well, and keep both the policy and the stake to term.`,
      cost: 'about $10–25 of stake, returned at term if no claim lands',
      time: '10 minutes',
    },
  ],
  prediction: (c) => [
    {
      text: `Fund ${c.name} with $${c.capital} and take one position in a liquid, long-dated market you genuinely have a view on; avoid thin markets where the spread eats the stake.`,
      cost: `$${c.capital} of stake plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Trade once a week in small size and let at least one position settle: a settled position and a claimed payout are the strongest activity record a prediction market keeps.`,
      cost: 'a few dollars of stake a week',
      time: '10 minutes a week',
    },
  ],
  staking: (c) => [
    {
      text: `Stake $${c.capital} of the chain's staking asset through ${c.name} on ${c.chain} and keep the receipt token in the farming wallet for the whole season.`,
      cost: `$${c.capital} of staking asset plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Claim and re-stake the rewards once a month; if ${c.name} offers a second product — a boosted or restaking vault — move about 20% of the stake into it after the first month.`,
      cost: 'one transaction a month, about $1 of gas',
      time: '10 minutes a month',
    },
  ],
  chain: (c) => [
    {
      text: `Bridge $${c.capital} of USDC to ${c.name} and make it the farming wallet's home chain for the season: hold a balance, pay gas there, and be a resident rather than a passer-by.`,
      cost: `$${c.capital} of capital plus one bridge fee`,
      time: '20 minutes',
    },
    {
      text: `Use two or three of ${poss(c.name)} native applications every week — a swap, a lend, a mint — because chain-level rewards, when they come, have historically counted distinct applications used, not one action repeated.`,
      cost: 'a few dollars of gas a week',
      time: '20 minutes a week',
    },
  ],
  bridge: (c) => [
    {
      text: `Bridge $${c.capital} of USDC through ${c.name} to ${c.chain} and use the bridged funds in a destination application the same day, so the crossing has a purpose on-chain.`,
      cost: `$${c.capital} of capital plus the bridge fee`,
      time: '20 minutes',
    },
    {
      text: `Repeat the crossing once a month in alternating directions at ordinary amounts: steady two-way use is the pattern bridge rewards have historically counted.`,
      cost: 'one bridge fee a month',
      time: '15 minutes a month',
    },
  ],
  generic: (c) => [
    {
      text: `Put $${c.capital} of USDC into ${poss(c.name)} core product on ${c.chain} — the deposit or position its own front page leads with — and keep the position open.`,
      cost: `$${c.capital} of capital plus ${c.gas}`,
      time: '15 minutes',
    },
    {
      text: `Use one secondary feature of ${c.name} each week — a second pool, a vote, a claim, a staking or referral action — so the wallet's history covers the product, not just its front door.`,
      cost: 'about $1 of gas a week',
      time: '10 minutes a week',
    },
  ],
};

/** The playbook key a category plays. Matching is by the category's words, never by a protocol's name. */
export function playbookFor(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('yield aggregator')) return 'aggregator';
  if (c.includes('lend')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('derivative') || c.includes('perpetual')) return 'derivatives';
  if (c.includes('curator')) return 'curator';
  if (c.includes('allocator')) return 'allocator';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('cdp') || c.includes('stable') || c.includes('algo')) return 'stable';
  if (c.includes('basis')) return 'basis';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('restak') || c.includes('staking')) return 'staking';
  if (c === 'chain') return 'chain';
  if (c.includes('bridge')) return 'bridge';
  return 'generic';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record. Two plans for the same category still differ — in chains, capital, hold
 * window and in the notes their TVL trend and size earn — because every number in them is read
 * from the protocol itself.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const { capital, halved } = capitalFor(p);
  const hold = holdDaysFor(age);
  const ctx: PlanCtx = { name: p.name, capital, chain, chains: chainsPhrase(p), gas: gasNote(chain) };
  const [actionA, actionB] = (PLAYBOOKS[playbookFor(p.category)] ?? PLAYBOOKS.generic!)(ctx);

  let sizeNote = '';
  if (p.tvl_usd >= 1_000_000_000) sizeNote = ` ${p.name} already holds ${fmtUsd(p.tvl_usd)} of TVL, so expect a crowded farm and modest per-wallet rewards.`;
  else if (p.tvl_usd < 25_000_000) sizeNote = ` ${p.name} is small — ${fmtUsd(p.tvl_usd)} of TVL — so keep the position modest and treat it as an early, riskier farm.`;

  let trendNote = '';
  if (halved) trendNote = ` The snapshot shows TVL down ${Math.abs(p.change_7d!).toFixed(1)}% in 7 days, so this plan already runs at half size; stage the entry over two weeks rather than one.`;
  else if (p.change_7d !== null && p.change_7d > 10) trendNote = ` TVL rose ${p.change_7d.toFixed(1)}% in the snapshot's 7 days, so the farm is getting crowded — starting now beats starting after the next snapshot.`;

  const ageNote =
    age !== null
      ? ` — ${p.name} has been tracked for ${age} days and still records no token, and patient wallets are the ones such launches usually reward`
      : ` — the snapshot reports no listing date for ${p.name}, so treat it as unproven and size accordingly`;

  return [
    {
      text: `Start with a fresh wallet used only for ${p.name}: write the seed phrase on paper, keep it offline, and send a $10 test amount to the wallet on ${chain} before any real position.${sizeNote}`,
      cost: 'the $10 test amount, which stays yours',
      time: '10 minutes',
    },
    {
      text:
        p.chains.length >= 2
          ? `Route the farming capital to ${ctx.chains}: bridge only what the plan needs, keep the rest in stablecoins, and make the first transaction while ${chain} fees are quiet.`
          : `${p.name} runs on ${chain}: move the farming capital there in one transfer and keep a small native-token buffer in the wallet for fees.`,
      cost: `one transfer or bridge fee, plus ${ctx.gas}`,
      time: '15 minutes',
    },
    actionA,
    actionB,
    {
      text: `Repeat one qualifying action every week — a small top-up, a rebalance, a harvest or a vote — so the wallet shows a pattern of use across the whole season, not a single-day burst.${trendNote}`,
      cost: weeklyGas(chain),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days${ageNote}. When a points or claim page appears, use only the link on ${poss(p.name)} own site or its verified announcement — never a search ad, and never pay anyone to "unlock" a claim.`,
      cost: 'no fee to hold or to check; the capital stays in the position',
      time: `${hold} days, with a 10-minute check each week`,
    },
    {
      text: `Log the wallet address, the dates, the amounts and every transaction hash in a farm log, and review it monthly: if ${p.name} announces a token, follow its own published conversion terms; if nothing has moved in 90 days, unwind in one transaction and redeploy the capital.`,
      cost: 'nothing but the log; one exit transaction when you unwind',
      time: '5 minutes a month',
    },
  ];
}
