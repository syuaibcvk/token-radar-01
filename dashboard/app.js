// Token Radar — the radar-2 dashboard. It renders window.RADAR, the dataset main.ts writes beside
// dashboard/ from the sealed snapshot, and nothing else: no network, no libraries, every number on
// the page is either in that dataset or recomputed here from the model stated below.
//
// THE MODEL (radar-2), stated in full — the same constants and calibration lib/model.ts computes
// with, copied here so this page can be read on its own:
//
//   implied_value_usd = TVL x category_multiple x growth_factor x maturity_factor
//
//   category_multiple: the median market-cap/TVL of the snapshot's own live-token protocols in the
//     same category (the 129 that record a market cap), shrunk toward the global median 0.2049 with
//     weight n/(n+8) and clamped to [0.02, 2.5]. A category with no comparables takes 0.2049.
//   growth_factor = 1 + clamp(change_7d, -50, +100)/100 x 0.4  (range 0.80-1.40; an unreported
//     7-day change is neutral, exactly 1.0).
//   maturity_factor = 0.7 + 0.3 x min(age_days, 1095)/1095  (range 0.70-1.00; a protocol whose
//     listing date is unreported borrows the board's median known age, 418 days, for this factor
//     only, and still shows its age as unreported).
//   Values are whole dollars, minimum $1. Rows sort by implied value, ties by TVL, then slug.
//   No protocol's name is ever special-cased: a value depends only on TVL, category, the 7-day
//   change and the listing date. The board holds all 40 watchlist protocols plus every other
//   pre-token protocol that passes the same launch test the watchlist applies (not a wrapped,
//   staked or bridged product of a trading token, not an exchange, no version marker in the name),
//   at any TVL: 198 rows. Protocols that already trade are shown apart, at market values.
(function () {
  'use strict';

  // The model's constants, copied from lib/model.ts (MODEL). When the dataset is present its own
  // copy is used; the two are generated from one source and cannot drift.
  var CONST = { shrink_k: 8, multiple_floor: 0.02, multiple_cap: 2.5, growth_weight: 0.4,
    growth_floor_pct: -50, growth_cap_pct: 100, maturity_floor: 0.7, maturity_range: 0.3,
    maturity_days: 1095 };
  var GLOBAL_MEDIAN = 0.2049, CAL_N = 129, CAL_P25 = 0.0441, CAL_P75 = 1.0435, FALLBACK_AGE = 418;
  // The calibration table as computed from the snapshot: [category, comparables n, raw median
  // mcap/TVL, multiple used]. The dataset carries the same table; this copy keeps the page whole.
  var CAL = [
    ["AI Agents",2,0.6047,0.2849],["Basis Trading",7,0.6544,0.4147],["Bridge",6,0.5567,0.3557],
    ["CDP",3,0.1687,0.195],["CEX",9,0.0748,0.136],["Canonical Bridge",8,0.7464,0.4756],
    ["Chain",1,3.0264,0.5184],["Collateral Management",1,12.1602,1.5333],
    ["Cross Chain Bridge",4,1.2205,0.5434],["DOR",1,0.0898,0.1921],
    ["Decentralized AI",1,2.0604,0.4111],["Derivatives",2,2.1619,0.5963],
    ["Dexs",11,0.3424,0.2845],["Dual-Token Stablecoin",1,0.0316,0.1857],
    ["Indexes",3,0.1477,0.1893],["Launchpad",1,0.1306,0.1966],["Lending",15,0.1324,0.1576],
    ["Leveraged Farming",1,0.1725,0.2013],["Liquid Restaking",2,0.1828,0.2005],
    ["Liquid Staking",9,0.0406,0.1179],["Liquidity Manager",1,0.015,0.1838],
    ["NFT Marketplace",1,2.0017,0.4046],["Onchain Capital Allocator",2,0.0125,0.1664],
    ["Options",1,1.5145,0.3504],["Payments",2,0.1813,0.2002],["Prediction Market",1,400.2045,2.5],
    ["Privacy",3,0.9691,0.4133],["RWA",9,0.2748,0.2419],["Restaking",2,0.0246,0.1689],
    ["Risk Curators",1,2.9747,0.5127],["Staking Pool",2,0.0018,0.1643],
    ["Token Locker",2,9.5204,2.068],["Yield",10,0.1802,0.1912],["Yield Aggregator",4,0.151,0.1869]
  ];
  // The sealed snapshot's census (its own header figures): 758 protocols, 342 recording no token.
  var SNAP_PROTOCOLS = 758, SNAP_PRETOKEN = 342;

  var DATA = (typeof window !== 'undefined' && window.RADAR) || null;
  var ROWS = [], LIVE = [], CALMAP = {};
  if (DATA) {
    CONST = Object.assign({}, CONST, DATA.model.constants);
    GLOBAL_MEDIAN = DATA.model.global_median; CAL_N = DATA.model.calibration_size;
    CAL_P25 = DATA.model.calibration_p25; CAL_P75 = DATA.model.calibration_p75;
    FALLBACK_AGE = DATA.model.fallback_age_days;
    CAL = DATA.model.calibration.map(function (c) { return [c.category, c.n, c.raw_median, c.multiple]; });
    ROWS = DATA.rows; LIVE = DATA.live;
  }
  CAL.forEach(function (c) { CALMAP[c[0]] = { n: c[1], raw: c[2], multiple: c[3] }; });

  // ---------- small helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function commas(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + commas(n);
  }
  function moneyFull(n) { return n == null ? '—' : '$' + commas(n); }
  function mult(x) { return x == null ? '—' : String(Math.round(x * 10000) / 10000); }
  function pct(x) { return x == null ? 'n/r' : (x > 0 ? '+' : '') + (Math.round(x * 10) / 10).toFixed(1) + '%'; }
  function ageText(days) {
    if (days == null) return 'unreported';
    if (days < 365) return days + 'd';
    return (Math.round(days / 36.5) / 10) + 'y (' + days + 'd)';
  }

  // ---------- the model, runnable ----------
  // A category's multiple under constants C: its raw median shrunk toward the global median with
  // weight n/(n+k), then clamped. No comparables -> the global median itself.
  function multipleFor(category, C) {
    var c = CALMAP[category];
    if (!c) return clamp(GLOBAL_MEDIAN, C.multiple_floor, C.multiple_cap);
    var w = c.n / (c.n + C.shrink_k);
    return clamp(w * c.raw + (1 - w) * GLOBAL_MEDIAN, C.multiple_floor, C.multiple_cap);
  }
  function growthFor(change, C) {
    if (change == null) return 1;
    return 1 + clamp(change, C.growth_floor_pct, C.growth_cap_pct) / 100 * C.growth_weight;
  }
  function maturityFor(ageDays, C) {
    var a = ageDays == null ? FALLBACK_AGE : ageDays;
    return C.maturity_floor + C.maturity_range * Math.min(a, C.maturity_days) / C.maturity_days;
  }
  function impliedFor(row, C) {
    var v = row.tvl_usd * multipleFor(row.category, C) * growthFor(row.change_7d, C) * maturityFor(row.age_days, C);
    return Math.max(1, Math.round(v));
  }
  // Re-rank the whole board under constants C, with the model's own tie-breaks.
  function rerank(C) {
    return ROWS.map(function (r) { return { row: r, imp: impliedFor(r, C) }; })
      .sort(function (a, b) { return b.imp - a.imp || b.row.tvl_usd - a.row.tvl_usd ||
        (a.row.slug < b.row.slug ? -1 : 1); });
  }

  // ---------- state and routes ----------
  // Views live in the URL hash so each can be opened directly:
  //   (no hash)                 the board, default order          -> screenshot 1-board
  //   #row/<slug>               one protocol's detail             -> screenshot 2-detail
  //   #board?cat=..&w=1         the board, filtered               -> screenshot 3-filtered
  //   #model                    the model, with its sandbox
  //   #live                     the live set, apart
  var BS = { q: '', cat: '', chain: '', w: false, band: 'all', sort: 'rank', dir: 'a' };
  var SB = Object.assign({}, CONST);
  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('row/') === 0) return { view: 'row', slug: decodeURIComponent(h.slice(4)) };
    if (h === 'model') return { view: 'model' };
    if (h === 'live') return { view: 'live' };
    if (h.indexOf('board') === 0) {
      var p = new URLSearchParams(h.slice(5).replace(/^\?/, ''));
      BS = { q: p.get('q') || '', cat: p.get('cat') || '', chain: p.get('chain') || '',
        w: p.get('w') === '1', band: p.get('band') || 'all',
        sort: p.get('sort') || 'rank', dir: p.get('dir') || 'a' };
    }
    return { view: 'board' };
  }
  function boardHash() {
    var p = new URLSearchParams();
    if (BS.q) p.set('q', BS.q);
    if (BS.cat) p.set('cat', BS.cat);
    if (BS.chain) p.set('chain', BS.chain);
    if (BS.w) p.set('w', '1');
    if (BS.band !== 'all') p.set('band', BS.band);
    if (BS.sort !== 'rank') p.set('sort', BS.sort);
    if (BS.dir !== 'a') p.set('dir', BS.dir);
    var s = p.toString();
    return s ? '#board?' + s : '#board';
  }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }

  // ---------- page chrome ----------
  function chrome(view) {
    var tab = function (v, href, label) {
      return '<a href="' + href + '"' + (view === v ? ' class="on"' : '') + '>' + label + '</a>';
    };
    return '<div class="wrap"><header class="mast">' +
      '<div class="kicker">Token Radar · model radar-2</div>' +
      '<h1>Launches that <span class="thin">haven&rsquo;t happened yet,</span> ranked.</h1>' +
      '<p class="tagline">Every protocol in the snapshot that records no token of its own and could ' +
      'still launch one, priced by a model calibrated on the launches that already trade — and ' +
      'given a farm plan with its costs and times.</p>' +
      '<div class="stamp">Snapshot <b>' + esc(DATA.source) + '</b> · as of <b>' + esc(DATA.as_of) +
      '</b> · watchlist floor <b>' + money(DATA.floor_usd) + ' TVL</b></div></header>' +
      '<section class="stats">' +
      '<div class="stat"><div class="v"><em>' + DATA.board_size + '</em></div><div class="k">Protocols ranked</div><div class="s">by implied launch value</div></div>' +
      '<div class="stat"><div class="v">' + DATA.watchlist_size + '</div><div class="k">Watchlist</div><div class="s">above the $50M floor, all covered</div></div>' +
      '<div class="stat"><div class="v">' + DATA.early_size + '</div><div class="k">Early finds</div><div class="s">below the floor, same launch test</div></div>' +
      '<div class="stat"><div class="v">' + SNAP_PRETOKEN + '</div><div class="k">Record no token</div><div class="s">of ' + SNAP_PROTOCOLS + ' protocols in the snapshot</div></div>' +
      '</section>' +
      '<nav class="tabs">' + tab('board', '#board', 'The board') +
      tab('model', '#model', 'The model') +
      tab('live', '#live', 'Already trading (' + DATA.live_size + ')') + '</nav>';
  }
  function foot() {
    return '<p class="foot">Implied values are this entry&rsquo;s own model output, not prices or ' +
      'advice. &ldquo;Records no token&rdquo; is the snapshot&rsquo;s statement as of ' + esc(DATA.as_of) +
      ', not a promise of a launch. This page renders only the dataset written beside it.</p></div>';
  }

  // ---------- the board ----------
  function bandOk(tvl) {
    if (BS.band === 'b500') return tvl >= 5e8;
    if (BS.band === 'b100') return tvl >= 1e8 && tvl < 5e8;
    if (BS.band === 'b50') return tvl >= 5e7 && tvl < 1e8;
    if (BS.band === 'u50') return tvl < 5e7;
    return true;
  }
  function boardRows() {
    var q = BS.q.trim().toLowerCase();
    var out = ROWS.filter(function (r) {
      if (BS.w && !r.watchlist) return false;
      if (BS.cat && r.category !== BS.cat) return false;
      if (BS.chain && r.chains.indexOf(BS.chain) < 0) return false;
      if (!bandOk(r.tvl_usd)) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = BS.sort, sgn = BS.dir === 'a' ? 1 : -1;
    var val = {
      rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); },
      cat: function (r) { return (r.category || '').toLowerCase(); },
      tvl: function (r) { return r.tvl_usd; },
      chg: function (r) { return r.change_7d == null ? -1e9 : r.change_7d; },
      mult: function (r) { return r.category_multiple; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
      imp: function (r) { return r.implied_value_usd; }
    }[key];
    out.sort(function (a, b) { var d = val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0; return d * sgn; });
    return out;
  }
  function chgCell(x) {
    if (x == null) return '<span class="flat">n/r</span>';
    var w = Math.min(Math.abs(x), 60) / 60 * 50;
    var fill = x >= 0
      ? 'left:50%;width:' + w + '%;background:var(--green)'
      : 'left:' + (50 - w) + '%;width:' + w + '%;background:var(--red)';
    return '<span class="bar"><i style="' + fill + '"></i></span><span class="' +
      (x > 0 ? 'up' : x < 0 ? 'down' : 'flat') + '">' + pct(x) + '</span>';
  }
  function multCell(r) {
    var c = CALMAP[r.category];
    var badge = !c ? ' <span class="tag thin">global</span>'
      : c.n <= 1 ? ' <span class="tag thin">n=' + c.n + '</span>'
      : ' <span class="pslug">n=' + c.n + '</span>';
    return '<span class="mono">' + mult(r.category_multiple) + '</span>' + badge;
  }
  function boardView() {
    var cats = [], chains = [], seen = {};
    ROWS.forEach(function (r) {
      if (cats.indexOf(r.category) < 0) cats.push(r.category);
      r.chains.forEach(function (c) { if (!seen[c]) { seen[c] = 1; chains.push(c); } });
    });
    cats.sort(); chains.sort();
    var opts = function (list, cur, allLabel) {
      return '<option value="">' + allLabel + '</option>' + list.map(function (v) {
        return '<option' + (v === cur ? ' selected' : '') + ' value="' + esc(v) + '">' + esc(v) + '</option>';
      }).join('');
    };
    var bands = [['all', 'Any TVL'], ['b500', 'TVL ≥ $500M'], ['b100', 'TVL $100–500M'],
      ['b50', 'TVL $50–100M'], ['u50', 'TVL < $50M']];
    var th = function (k, label, cls) {
      var arw = BS.sort === k ? ' <span class="arw">' + (BS.dir === 'a' ? '▲' : '▼') + '</span>' : '';
      return '<th data-sort="' + k + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + label + arw + '</th>';
    };
    var rows = boardRows();
    var body = rows.length ? rows.map(function (r) {
      var ch = r.chains.slice(0, 3).join(' · ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
      return '<tr data-row="' + esc(r.slug) + '"' + (r.watchlist ? ' class="wl"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><a class="pname" href="#row/' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.watchlist ? '<span class="tag wl">WATCHLIST</span>' : '<span class="tag early">EARLY</span>') +
        '<div class="pslug">' + esc(r.slug) + '</div><div class="pchains">' + esc(ch) + '</div></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="r money">' + money(r.tvl_usd) + '</td>' +
        '<td>' + chgCell(r.change_7d) + '</td>' +
        '<td>' + multCell(r) + '</td>' +
        '<td>' + ageText(r.age_days) + '</td>' +
        '<td class="r"><span class="big">' + money(r.implied_value_usd) + '</span></td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">No protocol matches these filters. Loosen one and sweep again.</td></tr>';
    return chrome('board') +
      '<div class="formula"><span>implied = TVL</span><span class="op">×</span><span>category multiple (calibrated, n shown)</span>' +
      '<span class="op">×</span><span>growth factor</span><span class="op">×</span><span>maturity factor</span>' +
      '<a href="#model">How the model works →</a></div>' +
      '<div class="tools" style="margin-top:16px">' +
      '<input type="search" id="f-q" placeholder="Search name, slug, category…" value="' + esc(BS.q) + '" aria-label="Search">' +
      '<select id="f-cat" aria-label="Category">' + opts(cats, BS.cat, 'All categories') + '</select>' +
      '<select id="f-chain" aria-label="Chain">' + opts(chains, BS.chain, 'All chains') + '</select>' +
      '<select id="f-band" aria-label="TVL band">' + bands.map(function (b) {
        return '<option value="' + b[0] + '"' + (BS.band === b[0] ? ' selected' : '') + '>' + b[1] + '</option>';
      }).join('') + '</select>' +
      '<label class="tgl"><input type="checkbox" id="f-w"' + (BS.w ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + ROWS.length + ' rows</span></div>' +
      '<div class="twrap"><table class="board"><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol') + th('cat', 'Category') + th('tvl', 'TVL', 'r') +
      th('chg', '7d Δ') + th('mult', 'Multiple') + th('age', 'Age') + th('imp', 'Implied value', 'r') +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="note">Every row records no token in the snapshot and passes the launch test stated ' +
      'in the model view. Green-edged rows are the 40 watchlist protocols; the rest are early finds ' +
      'below the floor. Click any row for its arithmetic and its farm plan.</p>' + foot();
  }

  // ---------- one protocol, in full ----------
  function splitStep(s) {
    var ci = s.lastIndexOf(' Cost: '), ti = s.lastIndexOf(' Time: ');
    if (ci < 0 || ti < ci) return { body: s, cost: null, time: null };
    var strip = function (x) { return x.replace(/\.\s*$/, ''); };
    return { body: s.slice(0, ci), cost: strip(s.slice(ci + 7, ti)), time: strip(s.slice(ti + 7)) };
  }
  function detailView(slug) {
    var r = null;
    ROWS.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return chrome('board') + '<p class="note">No board row with slug &ldquo;' + esc(slug) +
      '&rdquo;. <a href="#board">Back to the board</a>.</p>' + foot();
    var cal = CALMAP[r.category];
    var wgt = cal ? cal.n / (cal.n + CONST.shrink_k) : 0;
    var flags = '';
    if (!cal) flags = '<p class="flag"><b>No calibration.</b> No live-token protocol in ' +
      esc(r.category) + ' records a market cap, so this row&rsquo;s multiple is the global median ' +
      mult(GLOBAL_MEDIAN) + ' itself — the model&rsquo;s stated fallback, not a measurement.</p>';
    else if (cal.n <= 1) flags = '<p class="flag"><b>Thin calibration.</b> ' + esc(r.category) +
      ' rests on a single comparable, whose raw median is ' + mult(cal.raw) + '× TVL. Shrinkage gives ' +
      'that median weight ' + wgt.toFixed(2) + ' against the global median ' + mult(GLOBAL_MEDIAN) +
      ', so the multiple used is ' + mult(r.category_multiple) + '.' +
      (r.category_multiple >= CONST.multiple_cap ? ' It also reaches the ' + CONST.multiple_cap +
      ' cap: the number on this row is the cap, not the comparable.' : '') + '</p>';
    else if (r.category_multiple >= CONST.multiple_cap) flags = '<p class="flag"><b>Clamped.</b> ' +
      'This category&rsquo;s shrunk median exceeds the ' + CONST.multiple_cap +
      ' cap, so the cap is the multiple used.</p>';
    var multWhy = cal
      ? esc(r.category) + ': raw median ' + mult(cal.raw) + ' from n=' + cal.n +
        ' comparable' + (cal.n === 1 ? '' : 's') + ', shrunk with weight ' + wgt.toFixed(2) +
        ' toward the global median ' + mult(GLOBAL_MEDIAN)
      : 'no live comparables in ' + esc(r.category) + ' — the global median applies';
    var growthWhy = r.change_7d == null
      ? '7-day change unreported in the snapshot — the factor is neutral, exactly 1.0'
      : '7-day TVL change ' + pct(r.change_7d) + ', clamped to [' + CONST.growth_floor_pct + ', +' +
        CONST.growth_cap_pct + '] and weighted ' + CONST.growth_weight;
    var matWhy = r.age_days == null
      ? 'listing date unreported — this factor borrows the board&rsquo;s median known age, ' +
        FALLBACK_AGE + ' days; the age itself stays unreported'
      : 'listed ' + esc(r.listed_at) + ', ' + r.age_days + ' days before the snapshot; the factor saturates at ' +
        CONST.maturity_days + ' days';
    var sameCat = ROWS.filter(function (x) { return x.category === r.category; })
      .sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    var catPos = 0;
    sameCat.forEach(function (x, i) { if (x.slug === r.slug) catPos = i + 1; });
    var plan = r.farm_steps.map(function (s) {
      var p = splitStep(s);
      return '<li><p>' + esc(p.body) + '</p>' + (p.cost
        ? '<div class="ct"><span class="cost">Cost: ' + esc(p.cost) + '</span>' +
          '<span class="time">Time: ' + esc(p.time) + '</span></div>' : '') + '</li>';
    }).join('');
    return chrome('board') +
      '<p><a class="back" href="#board">← the board</a></p>' +
      '<div class="dhead"><h2>' + esc(r.name) + '</h2>' +
      '<span class="rank">rank #' + r.rank + ' of ' + ROWS.length + '</span>' +
      (r.watchlist ? '<span class="tag wl">WATCHLIST</span>' : '<span class="tag early">EARLY FIND</span>') + '</div>' +
      '<p class="dim" style="margin:0">' + esc(r.category) + ' · #' + catPos + ' of ' + sameCat.length +
      ' in its category · slug <span class="mono">' + esc(r.slug) + '</span></p>' +
      '<div class="chips">' + r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
      flags +
      '<div class="cols"><section class="card"><h3>The arithmetic</h3>' +
      '<table class="ledger">' +
      '<tr><td class="fac">' + moneyFull(r.tvl_usd) + '</td><td><b>TVL</b><div class="why">as recorded in the snapshot, ' + esc(DATA.as_of) + '</div></td></tr>' +
      '<tr><td class="fac">× ' + mult(r.category_multiple) + '</td><td><b>Category multiple</b><div class="why">' + multWhy + '</div></td></tr>' +
      '<tr><td class="fac">× ' + mult(r.growth_multiplier) + '</td><td><b>Growth factor</b><div class="why">' + growthWhy + '</div></td></tr>' +
      '<tr><td class="fac">× ' + mult(r.maturity_multiplier) + '</td><td><b>Maturity factor</b><div class="why">' + matWhy + '</div></td></tr>' +
      '<tr class="total"><td class="result">' + moneyFull(r.implied_value_usd) + '</td><td><b>Implied launch value</b><div class="why">factors are printed to 4 decimal places; the board&rsquo;s figure is computed before rounding, so multiplying the printed factors can differ in the last few dollars</div></td></tr>' +
      '</table></section>' +
      '<section class="card"><h3>Calibration context</h3>' +
      '<table class="plain">' +
      '<tr><th>Category median (raw)</th><td class="n">' + (cal ? mult(cal.raw) : '—') + '</td></tr>' +
      '<tr><th>Comparables n</th><td class="n">' + (cal ? cal.n : 0) + '</td></tr>' +
      '<tr><th>Shrinkage weight</th><td class="n">' + (cal ? wgt.toFixed(2) : '—') + '</td></tr>' +
      '<tr><th>Global median (n=' + CAL_N + ')</th><td class="n">' + mult(GLOBAL_MEDIAN) + '</td></tr>' +
      '<tr><th>Multiple used</th><td class="n">' + mult(r.category_multiple) + '</td></tr>' +
      '<tr><th>Implied / TVL</th><td class="n">' + mult(r.implied_value_usd / r.tvl_usd) + '</td></tr>' +
      '</table>' +
      '<p class="dim">The calibration set is the ' + CAL_N + ' protocols in the snapshot that record ' +
      'a market cap; their ratios run from p25 ' + mult(CAL_P25) + ' to p75 ' + mult(CAL_P75) +
      ' around the ' + mult(GLOBAL_MEDIAN) + ' median — wide dispersion is why every median is ' +
      'shrunk and clamped before it prices anything.</p></section></div>' +
      '<h3 style="font-size:20px;margin:28px 0 10px">The farm plan — 7 steps</h3>' +
      '<ol class="plan">' + plan + '</ol>' + foot();
  }

  // ---------- the model, and its sandbox ----------
  var SB_DEFS = [
    ['shrink_k', 'Shrinkage strength k — a median earns weight n/(n+k)', 0, 32, 1],
    ['multiple_cap', 'Multiple cap (the floor stays 0.02)', 0.25, 5, 0.25],
    ['growth_weight', 'Growth weight', 0, 1, 0.05],
    ['growth_floor_pct', 'Growth clamp, low (%)', -100, 0, 5],
    ['growth_cap_pct', 'Growth clamp, high (%)', 10, 200, 5],
    ['maturity_floor', 'Maturity floor', 0.4, 1, 0.05],
    ['maturity_range', 'Maturity range', 0, 0.6, 0.05],
    ['maturity_days', 'Maturity horizon (days)', 365, 1825, 30]
  ];
  function sandboxOut() {
    var ranked = rerank(SB).slice(0, 10);
    var top = ranked[0];
    var rowsHtml = ranked.map(function (e, i) {
      var move = e.row.rank - (i + 1);
      var mv = move === 0 ? '<span class="flat">—</span>' : move > 0
        ? '<span class="up">▲ ' + move + '</span>' : '<span class="down">▼ ' + (-move) + '</span>';
      return '<tr><td class="n">' + (i + 1) + '</td><td>' + esc(e.row.name) + '</td>' +
        '<td class="n">' + money(e.imp) + '</td><td class="n">board #' + e.row.rank + ' ' + mv + '</td></tr>';
    }).join('');
    return '<p>Under your constants, #1 is <b>' + esc(top.row.name) + '</b> at ' + money(top.imp) +
      '. On the board as submitted, #1 is <b>' + esc(ROWS[0].name) + '</b> at ' +
      money(ROWS[0].implied_value_usd) + '.</p>' +
      '<table class="plain"><tr><th class="n">#</th><th>Protocol</th><th class="n">Implied</th><th class="n">vs board</th></tr>' +
      rowsHtml + '</table>';
  }
  function modelView() {
    var meaning = {
      shrink_k: 'weight a category median earns: n/(n+k)', multiple_floor: 'the clamp band, low end',
      multiple_cap: 'the clamp band, high end', growth_weight: 'how hard one week of TVL weather may push',
      growth_floor_pct: 'growth clamp, falling', growth_cap_pct: 'growth clamp, rising',
      maturity_floor: 'maturity factor at age zero', maturity_range: 'what full maturity adds',
      maturity_days: 'age at which maturity saturates (3 years)' };
    var constRows = Object.keys(CONST).filter(function (k) { return k !== 'live_rows'; }).map(function (k) {
      return '<tr><td class="mono">' + k + '</td><td class="n">' + CONST[k] + '</td><td>' + meaning[k] + '</td></tr>';
    }).join('');
    var calRows = CAL.map(function (c) {
      var w = (c[1] / (c[1] + CONST.shrink_k)).toFixed(2);
      return '<tr><td>' + esc(c[0]) + (c[1] <= 1 ? ' <span class="tag thin">thin</span>' : '') +
        '</td><td class="n">' + c[1] + '</td><td class="n">' + mult(c[2]) + '</td><td class="n">' + w +
        '</td><td class="n">' + mult(c[3]) + '</td></tr>';
    }).join('');
    var sbControls = SB_DEFS.map(function (d) {
      return '<label>' + d[1] + '<b id="sbv-' + d[0] + '">' + SB[d[0]] + '</b>' +
        '<input type="range" class="sb-in" data-k="' + d[0] + '" min="' + d[2] + '" max="' + d[3] +
        '" step="' + d[4] + '" value="' + SB[d[0]] + '"></label>';
    }).join('');
    return chrome('model') + '<div class="page">' +
      '<h2>How this radar values a launch</h2>' +
      '<p>One function prices every row. It follows from the snapshot&rsquo;s own figures — TVL, the ' +
      '7-day change, how long the protocol has run with no token — calibrated on the protocols in the ' +
      'same snapshot whose launches already trade. Nothing is priced off a list of names.</p>' +
      '<pre class="formula-big">implied_value_usd = TVL × category_multiple × growth_factor × maturity_factor\n' +
      'category_multiple = clamp( w × category median + (1 − w) × ' + mult(GLOBAL_MEDIAN) + ', 0.02, ' + CONST.multiple_cap + ' ),  w = n/(n+' + CONST.shrink_k + ')\n' +
      'growth_factor     = 1 + clamp(change_7d, ' + CONST.growth_floor_pct + ', +' + CONST.growth_cap_pct + ')/100 × ' + CONST.growth_weight + '\n' +
      'maturity_factor   = ' + CONST.maturity_floor + ' + ' + CONST.maturity_range + ' × min(age_days, ' + CONST.maturity_days + ')/' + CONST.maturity_days + '</pre>' +
      '<h3>The constants</h3>' +
      '<table class="plain" style="max-width:860px"><tr><th>Constant</th><th class="n">Value</th><th>What it does</th></tr>' + constRows + '</table>' +
      '<h3>The calibration table</h3>' +
      '<p>The calibration set is the ' + CAL_N + ' protocols in the snapshot that record a market cap ' +
      '(a recorded cap of exactly $0 is how the source writes &ldquo;no market cap&rdquo;, and does not ' +
      'calibrate). Each category&rsquo;s median cap/TVL is shrunk toward the global median ' +
      mult(GLOBAL_MEDIAN) + ' (p25 ' + mult(CAL_P25) + ', p75 ' + mult(CAL_P75) + ') and clamped. A board ' +
      'category with no comparables — 13 of them — takes the global median itself.</p>' +
      '<div class="twrap" style="max-width:860px"><table class="plain"><tr><th>Category</th><th class="n">n</th>' +
      '<th class="n">Raw median</th><th class="n">Weight</th><th class="n">Multiple used</th></tr>' + calRows + '</table></div>' +
      '<p class="flag"><b>Read two rows with suspicion.</b> Prediction Market rests on one comparable ' +
      'trading at 400× its on-platform TVL — a prediction market&rsquo;s TVL is just the collateral in ' +
      'open markets, while its token prices the franchise. Shrinkage pulls 400.20 to 44.6 and the clamp ' +
      'caps it at ' + CONST.multiple_cap + ': the multiple is the cap, not the comparable. Risk Curators, ' +
      'the board&rsquo;s largest category by TVL, also rests on one comparable (raw 2.9747, shrunk at ' +
      'weight 0.11 to 0.5127). Neither raw median is ever used directly, and every board row prints its n.</p>' +
      '<h3>Why the growth tilt is this size, and the maturity curve this shallow</h3>' +
      '<p>In the calibration set, median cap/TVL rises across the well-populated momentum bins — 0.148 ' +
      'for protocols whose TVL fell 5–20% in the week, 0.275 for those down less than 5%, 0.300 for ' +
      'those flat-to-rising — so the market does pay something for momentum. The bins are confounded ' +
      'and the extremes are thin, so the weight is 0.4 with tight clamps: a week of weather moves a ' +
      'value by at most ±40% and can never outrank a multiple or a real TVL gap. Age shows no monotone ' +
      'premium at all — median cap/TVL by age bin runs 0.159 (6–12 months), 0.362 (1–2 years), 0.125 ' +
      '(2–3 years), 0.169 (3 years+) — so the maturity factor is a shallow survival prior, 0.70–1.00, ' +
      'not a fitted curve. An unreported 7-day change is neutral (factor exactly 1.0); an unreported ' +
      'listing date borrows the board&rsquo;s median known age, ' + FALLBACK_AGE + ' days, for the ' +
      'maturity factor only.</p>' +
      '<h3>What the board covers</h3>' +
      '<p>All 40 watchlist slugs, plus the 158 other protocols that pass the same test the watchlist ' +
      'applies — records no token; is not a wrapped, staked or bridged product of a token that already ' +
      'trades; is not an exchange; carries no version marker in its name — applied at any TVL rather ' +
      'than above the $50M floor. Of the snapshot&rsquo;s ' + SNAP_PRETOKEN + ' pre-token protocols, 144 ' +
      'fail that test and are left off: a wrapped or bridged product cannot launch a token of its own ' +
      'in the way this radar means. Protocols that already trade are in the &ldquo;Already ' +
      'trading&rdquo; view, at the market&rsquo;s own values, never ranked.</p>' +
      '<h3>Try it: the constants sandbox</h3>' +
      '<p>Move any constant and the whole board re-ranks here, live, by the same code that states the ' +
      'model above. The board as submitted uses the constants in the table at the top of this page.</p>' +
      '<div class="sb">' + sbControls + '</div>' +
      '<p><button class="reset" data-act="reset-sb" type="button">Reset to the board&rsquo;s constants</button></p>' +
      '<div id="sb-out">' + sandboxOut() + '</div>' +
      '<h3>The honest limits</h3>' +
      '<ul class="limits">' +
      '<li>The calibration set is ' + CAL_N + ' protocols, and some categories the board leans on have ' +
      'one or two comparables. Shrinkage and the clamp bound the damage, and every row prints its ' +
      'category&rsquo;s n — but a multiple with n = 1 is an argument, not a measurement.</li>' +
      '<li>Cap/TVL is a ratio of two noisy figures: TVL is counted differently across protocols, and a ' +
      'market cap prices float, speculation and unlock schedules this snapshot cannot see. The model ' +
      'claims an order of magnitude and a ranking, not a price.</li>' +
      '<li>The growth and maturity factors are priors disciplined by the cross-section, not fitted ' +
      'coefficients; their sizes are chosen small because the data supports their direction more ' +
      'strongly than their size.</li>' +
      '<li>&ldquo;Records no token&rdquo; is the snapshot&rsquo;s statement, not a promise: a protocol ' +
      'may have announced, issued elsewhere, or abandoned any launch. The board ranks the snapshot&rsquo;s ' +
      'world as of ' + esc(DATA.as_of) + ', and says so.</li></ul>' +
      '</div>' + foot();
  }

  // ---------- the live set, apart ----------
  function liveView() {
    var body = LIVE.map(function (r) {
      var ratio = r.mcap_usd != null && r.tvl_usd > 0 ? mult(r.mcap_usd / r.tvl_usd) : '—';
      return '<tr><td><span class="pname">' + esc(r.name) + '</span><div class="pslug">' + esc(r.slug) +
        '</div></td><td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 3).join(' · ')) +
        '</td><td class="r money">' + money(r.tvl_usd) + '</td><td class="r money">' +
        money(r.mcap_usd) + '</td><td class="r mono">' + ratio + '</td><td>' + chgCell(r.change_7d) + '</td></tr>';
    }).join('');
    return chrome('live') + '<div class="page"><h2>Already trading — set aside</h2>' +
      '<p>These ' + LIVE.length + ' protocols already have a token; the market has priced them, so ' +
      'the model does not. They are shown at the market&rsquo;s own values, largest first by market ' +
      'cap, and are never mixed into the ranked board. Their cap/TVL ratios are the raw material the ' +
      'board&rsquo;s multiples are calibrated from — the full calibration set behind them numbers ' +
      CAL_N + '.</p></div>' +
      '<div class="twrap"><table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="r">TVL</th><th class="r">Market cap</th><th class="r">Cap / TVL</th><th>7d Δ</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' + foot();
  }

  // ---------- render + events ----------
  var main = document.getElementById('app');
  function render() {
    if (!DATA) {
      main.innerHTML = '<div class="wrap"><p class="flag" style="margin-top:32px"><b>No dataset.</b> ' +
        'This page renders the data file main.ts writes beside dashboard/; run the program first.</p></div>';
      return;
    }
    var route = parseHash();
    document.title = 'Token Radar — radar-2';
    main.innerHTML = route.view === 'row' ? detailView(route.slug)
      : route.view === 'model' ? modelView()
      : route.view === 'live' ? liveView() : boardView();
    main.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }
  main.addEventListener('click', function (ev) {
    var th = ev.target.closest ? ev.target.closest('th[data-sort]') : null;
    if (th) {
      var k = th.getAttribute('data-sort');
      if (BS.sort === k) BS.dir = BS.dir === 'a' ? 'd' : 'a';
      else { BS.sort = k; BS.dir = (k === 'name' || k === 'cat' || k === 'rank') ? 'a' : 'd'; }
      go(boardHash());
      return;
    }
    if (ev.target.closest && ev.target.closest('[data-act="reset-sb"]')) {
      SB = Object.assign({}, CONST);
      render();
      return;
    }
    var tr = ev.target.closest ? ev.target.closest('tr[data-row]') : null;
    if (tr && !ev.target.closest('a')) go('#row/' + tr.getAttribute('data-row'));
  });
  main.addEventListener('change', function (ev) {
    var id = ev.target.id;
    if (id === 'f-cat') { BS.cat = ev.target.value; go(boardHash()); }
    else if (id === 'f-chain') { BS.chain = ev.target.value; go(boardHash()); }
    else if (id === 'f-band') { BS.band = ev.target.value; go(boardHash()); }
    else if (id === 'f-w') { BS.w = ev.target.checked; go(boardHash()); }
  });
  main.addEventListener('input', function (ev) {
    if (ev.target.id === 'f-q') {
      BS.q = ev.target.value;
      history.replaceState(null, '', boardHash());
      main.innerHTML = boardView();
      var box = document.getElementById('f-q');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }
    if (ev.target.classList && ev.target.classList.contains('sb-in')) {
      var k = ev.target.getAttribute('data-k');
      SB[k] = parseFloat(ev.target.value);
      var readout = document.getElementById('sbv-' + k);
      if (readout) readout.textContent = SB[k];
      var out = document.getElementById('sb-out');
      if (out) out.innerHTML = sandboxOut();
    }
  });
  window.addEventListener('hashchange', render);
  // A small seam so the page's own arithmetic can be exercised headlessly against the dataset:
  // rerank(CONST) must reproduce the board, and moving a constant must move the ranking.
  window.RADAR_APP = { render: render, rerank: rerank, impliedFor: impliedFor, constants: CONST };
  render();
})();
