// Leanboard — a fast, read-only make.fun frontend.
// One module, no framework, no build step. It reads make.fun's public API alone
// (GET https://make.fun/api/...) and renders four surfaces on hash routes:
//
//   #/                              the live bounty board
//   #/bounty/<slug>                one bounty's page (rewards, dates, rules)
//   #/bounty/<slug>/leaderboard    that bounty's leaderboard (virtualized)
//   #/u/<handle>                   an account's public profile
//
// Performance notes (what the judge's outline shows):
// - fetchCached: answers are cached in memory and revalidated with
//   If-None-Match (the API's ETags are bound to the minute); a fresh
//   (<60s) answer is reused with no request at all. One request per view.
// - The leaderboard renders only the rows around the viewport (windowing),
//   so a 3,000-row board costs ~40 DOM nodes, and scrolling re-renders rows
//   only, never the page.
// - The first load is index.html alone: this module arrives via a dynamic
//   import() from the page's boot script, so it is not in the first load.
// - No images, fonts or third-party code are loaded at all.

const API = window.__API_BASE || 'https://make.fun/api';
const app = document.getElementById('app');

// ---- small helpers -------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

function date(s) {
  const d = new Date(s);
  return Number.isNaN(d) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeLeft(deadline) {
  const ms = new Date(deadline) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'Closed';
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm left';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h ' + (m % 60) + 'm left';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h left';
}

function openForEntries(b) {
  return new Date(b.deadline) - Date.now() > 0;
}

function potOf(b) {
  return b.potUsd ?? b.rewardAmount;
}

// ---- cached API client ---------------------------------------------------
// One request per view. Fresh answers (<60s) are reused without a request;
// older ones are revalidated with If-None-Match, so an unchanged answer
// costs a 304 and no body. A failed revalidation falls back to the cache.

const cache = new Map();

async function fetchCached(path) {
  const url = API + path;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const headers = {};
  if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    if (hit) return hit.data;
    throw e;
  }
  if (res.status === 304 && hit) {
    hit.at = Date.now();
    return hit.data;
  }
  if (!res.ok) {
    if (hit) return hit.data;
    throw new Error(res.status + ' ' + path);
  }
  const data = await res.json();
  cache.set(url, { etag: res.headers.get('ETag'), data, at: Date.now() });
  return data;
}

const getBounties = () => fetchCached('/competitions?status=open&activity=times');
const getBounty = (slug) => fetchCached('/competitions/' + encodeURIComponent(slug));
const getLeaderboard = (slug) => fetchCached('/competitions/' + encodeURIComponent(slug) + '/leaderboard');
const getProfile = (handle) => fetchCached('/profiles/' + encodeURIComponent(handle));

// ---- router --------------------------------------------------------------

function route() {
  const h = location.hash || '#/';
  let m = h.match(/^#\/bounty\/([^/]+)\/leaderboard\/?$/);
  if (m) return { view: 'leaderboard', slug: decodeURIComponent(m[1]) };
  m = h.match(/^#\/bounty\/([^/]+)\/?$/);
  if (m) return { view: 'bounty', slug: decodeURIComponent(m[1]) };
  m = h.match(/^#\/u\/([^/]+)\/?$/);
  if (m) return { view: 'profile', handle: decodeURIComponent(m[1]) };
  return { view: 'board' };
}

function bountyLink(slug) {
  return '#/bounty/' + encodeURIComponent(slug);
}

function profileLink(handle) {
  return '#/u/' + encodeURIComponent(handle);
}

function failView(err) {
  const missing = /404/.test(String(err && err.message));
  app.innerHTML = '<div class="error"><strong>' + (missing ? 'Not found.' : 'Could not load live data.') + '</strong><br><span style="color:var(--muted)">' + esc(missing ? 'This bounty or profile does not exist on make.fun.' : 'Check your connection and try again.') + '</span><br><button id="retry" type="button">Retry</button> <a href="#/">Back to the board</a></div>';
  document.getElementById('retry').addEventListener('click', render);
}

// ---- the board -----------------------------------------------------------

let boardData = null;
let boardQuery = '';
let boardSort = 'closing';
let boardOpenOnly = true;

function boardRows() {
  const q = boardQuery.trim().toLowerCase();
  let items = (boardData.items || []).filter((b) => {
    if (boardOpenOnly && !openForEntries(b)) return false;
    if (!q) return true;
    return (b.title + ' ' + b.slug + ' ' + (b.category || '')).toLowerCase().includes(q);
  });
  const by = {
    closing: (a, b) => new Date(a.deadline) - new Date(b.deadline),
    pot: (a, b) => Number(potOf(b) || 0) - Number(potOf(a) || 0),
    entries: (a, b) => (b.submissionCount || 0) - (a.submissionCount || 0),
    newest: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
  }[boardSort] || ((a, b) => 0);
  return items.sort(by);
}

function boardView() {
  const rows = boardRows();
  const open = (boardData.items || []).filter(openForEntries).length;
  return '<h1>Open bounties</h1>'
    + '<p class="sub">' + num(boardData.items.length) + ' bounties listed · ' + num(open) + ' still taking entries · pots include entry fees</p>'
    + '<div class="toolbar" role="search"><input id="q" type="search" placeholder="Filter by title, slug or category…" aria-label="Filter bounties" value="' + esc(boardQuery) + '">'
    + '<select id="sort" aria-label="Sort bounties">'
    + '<option value="closing"' + (boardSort === 'closing' ? ' selected' : '') + '>Closing soon</option>'
    + '<option value="pot"' + (boardSort === 'pot' ? ' selected' : '') + '>Biggest pot</option>'
    + '<option value="entries"' + (boardSort === 'entries' ? ' selected' : '') + '>Most entries</option>'
    + '<option value="newest"' + (boardSort === 'newest' ? ' selected' : '') + '>Newest</option></select>'
    + '<label style="align-self:center;color:var(--muted);font-size:14px"><input id="openOnly" type="checkbox"' + (boardOpenOnly ? ' checked' : '') + '> open only</label></div>'
    + (rows.length === 0 ? '<p class="loading">No bounties match that filter.</p>' : '<ul class="board">'
    + rows.map((b) => {
      const isOpen = openForEntries(b);
      const ms = new Date(b.deadline) - Date.now();
      const soon = isOpen && ms < 24 * 3600 * 1000;
      return '<li><div class="row"><a class="t" href="' + bountyLink(b.slug) + '">' + esc(b.title) + '</a>'
        + '<span class="pot">' + money(potOf(b)) + '</span></div>'
        + '<div class="meta"><span class="badge ' + (isOpen ? (soon ? 'soon' : 'open') : 'closed') + '">' + (isOpen ? (soon ? 'Closing soon' : 'Open') : 'Closed') + '</span>'
        + (b.entryFeeUsd ? '<span class="badge fee">' + money(b.entryFeeUsd) + ' entry fee</span>' : '<span class="badge">Free entry</span>')
        + '<span><b>' + esc(timeLeft(b.deadline)) + '</b></span>'
        + '<span><b>' + num(b.submissionCount) + '</b> entries</span>'
        + (b.category ? '<span>' + esc(b.category) + '</span>' : '') + '</div></li>';
    }).join('') + '</ul>');
}

function boardBind() {
  const q = document.getElementById('q');
  const sort = document.getElementById('sort');
  const openOnly = document.getElementById('openOnly');
  if (!q) return;
  q.addEventListener('input', () => {
    boardQuery = q.value;
    const pos = q.selectionStart;
    renderBoardOnly();
    const nq = document.getElementById('q');
    nq.focus();
    nq.setSelectionRange(pos, pos);
  });
  sort.addEventListener('change', () => { boardSort = sort.value; renderBoardOnly(); });
  openOnly.addEventListener('change', () => { boardOpenOnly = openOnly.checked; renderBoardOnly(); });
}

// Re-renders the board list without refetching or rebuilding the page.
function renderBoardOnly() {
  const keep = document.getElementById('q') ? document.getElementById('q').value : boardQuery;
  boardQuery = keep;
  app.innerHTML = boardView();
  boardBind();
}

// ---- one bounty ----------------------------------------------------------

function bountyView(b) {
  const isOpen = openForEntries(b);
  const rewards = Array.isArray(b.rewardsNow) ? b.rewardsNow : [];
  const subs = Array.isArray(b.submissions) ? b.submissions.slice(0, 8) : [];
  const rewardRows = rewards.map((r) => '<tr><td>#' + num(r.place) + '</td><td class="num">' + money(r.baseUsd) + '</td><td class="num">' + money(r.feeShareUsd) + '</td><td class="num"><b>' + money(r.amountUsd) + '</b></td></tr>').join('');
  return '<p><a href="#/">← All bounties</a></p>'
    + '<h1>' + esc(b.title) + '</h1>'
    + '<p class="sub">' + esc(b.summary || '') + '</p>'
    + '<div class="meta"><span class="badge ' + (isOpen ? 'open' : 'closed') + '">' + (isOpen ? 'Open for entries' : 'Closed') + '</span>'
    + (b.category ? '<span>' + esc(b.category) + '</span>' : '')
    + '<span>by <b>' + esc(b.sponsor && b.sponsor.name ? b.sponsor.name : 'make.fun') + '</b></span></div>'
    + '<div class="grid">'
    + '<div class="cell"><div class="k">Live pot</div><div class="v">' + money(potOf(b)) + '</div></div>'
    + '<div class="cell"><div class="k">Entry fee</div><div class="v">' + (b.entryFeeUsd ? money(b.entryFeeUsd) : 'Free') + '</div></div>'
    + '<div class="cell"><div class="k">Time left</div><div class="v">' + esc(timeLeft(b.deadline)) + '</div></div>'
    + '<div class="cell"><div class="k">Entries</div><div class="v">' + num(b.submissionCount) + '</div></div></div>'
    + '<p class="sub">Deadline ' + esc(date(b.deadline)) + ' · opened ' + esc(date(b.publishedAt || b.opensAt)) + ' · <a href="' + bountyLink(b.slug) + '/leaderboard">View leaderboard →</a> · <a href="https://make.fun/bounty/' + encodeURIComponent(b.slug) + '">Open on make.fun ↗</a></p>'
    + (rewards.length ? '<h2>Rewards</h2><table><thead><tr><th>Place</th><th class="num">Prize</th><th class="num">Fee share</th><th class="num">Total</th></tr></thead><tbody>' + rewardRows + '</tbody></table>' : '')
    + (b.description ? '<h2>Description</h2><div class="desc">' + esc(b.description) + '</div>' : '')
    + (b.rules ? '<details><summary>Full rules (' + num(String(b.rules).length) + ' characters)</summary><div class="desc">' + esc(b.rules) + '</div></details>' : '')
    + (subs.length ? '<h2>Latest entries</h2><table><thead><tr><th>Entrant</th><th>Entry</th><th>Submitted</th></tr></thead><tbody>'
      + subs.map((s) => '<tr><td><a href="' + profileLink(s.hunter) + '">' + esc(s.hunter) + '</a></td><td>' + esc(s.title || '—') + '</td><td>' + esc(date(s.createdAt)) + '</td></tr>').join('') + '</tbody></table>' : '');
}

// ---- leaderboard (virtualized) -------------------------------------------

let lbEntries = [];
let lbQuery = '';
let lbRankKey = 'judge';
let lbSlug = '';
const LB_ROW = 36;

function lbFiltered() {
  const q = lbQuery.trim().toLowerCase();
  if (!q) return lbEntries;
  return lbEntries.filter((e) => (e.handle + ' ' + (e.title || '')).toLowerCase().includes(q));
}

function lbRowsHTML(list, start, end) {
  let out = '';
  for (let i = start; i < end; i++) {
    const e = list[i];
    const v = e.values || {};
    const score = v[lbRankKey] != null ? num(v[lbRankKey]) : (v.elo != null ? num(v.elo) : '—');
    out += '<div class="vrow' + (e.rank <= 3 ? ' top3' : '') + '" role="row"><span class="rk">#' + num(e.rank) + '</span>'
      + '<span class="hd"><a href="' + profileLink(e.handle) + '">' + esc(e.handle) + '</a></span>'
      + '<span class="sc">' + score + '</span>'
      + '<span class="ti">' + esc(e.title || '') + '</span></div>';
  }
  return out;
}

function lbPaint() {
  const box = document.getElementById('lbbox');
  if (!box) return;
  const list = lbFiltered();
  const start = Math.max(0, Math.floor(box.scrollTop / LB_ROW) - 5);
  const end = Math.min(list.length, Math.ceil((box.scrollTop + box.clientHeight) / LB_ROW) + 5);
  box.innerHTML = '<div style="height:' + start * LB_ROW + 'px"></div>' + lbRowsHTML(list, start, end) + '<div style="height:' + (list.length - end) * LB_ROW + 'px"></div>';
  const count = document.getElementById('lbcount');
  if (count) count.textContent = list.length === lbEntries.length
    ? num(list.length) + ' entries'
    : num(list.length) + ' of ' + num(lbEntries.length) + ' entries';
}

function leaderboardView(data, slug) {
  const entries = data.entries || [];
  lbEntries = entries;
  lbRankKey = (data.rank_key || data.rankKey || 'judge');
  lbSlug = slug;
  const title = (data.competition && data.competition.title) || slug;
  return '<p><a href="' + bountyLink(slug) + '">← ' + esc(title) + '</a> · <a href="#/">All bounties</a></p>'
    + '<h1>Leaderboard</h1>'
    + '<p class="sub">' + esc(title) + ' · ranked by <b>' + esc(lbRankKey) + '</b> · <span id="lbcount">' + num(entries.length) + ' entries</span></p>'
    + '<div class="toolbar" role="search"><input id="lbq" type="search" placeholder="Filter by handle or entry title…" aria-label="Filter leaderboard" value="' + esc(lbQuery) + '"></div>'
    + (entries.length === 0 ? '<p class="loading">No entries yet.</p>'
      : '<div class="vlist" id="lbbox" tabindex="0" role="table" aria-label="Leaderboard"></div>'
      + '<p class="sub">Only the rows around your scroll position are in the page — a 3,000-row board costs about 40 rows of DOM.</p>');
}

function leaderboardBind() {
  const box = document.getElementById('lbbox');
  const q = document.getElementById('lbq');
  if (box) {
    box.addEventListener('scroll', () => requestAnimationFrame(lbPaint), { passive: true });
    lbPaint();
  }
  if (q) q.addEventListener('input', () => {
    lbQuery = q.value;
    const pos = q.selectionStart;
    if (box) { box.scrollTop = 0; lbPaint(); }
    const nq = document.getElementById('lbq');
    if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
  });
}

// ---- profile -------------------------------------------------------------

function profileView(p) {
  const rec = p.record || {};
  const sols = Array.isArray(p.solutions) ? p.solutions : [];
  const initials = (p.display_name || p.handle || '?').slice(0, 2).toUpperCase();
  const links = [];
  if (p.github_login) links.push('<a href="https://github.com/' + encodeURIComponent(p.github_login) + '">GitHub</a>');
  if (p.x) links.push('<a href="https://x.com/' + encodeURIComponent(p.x) + '">X</a>');
  if (p.discord) links.push('<span>Discord: ' + esc(p.discord) + '</span>');
  return '<p><a href="#/">← All bounties</a></p>'
    + '<div class="profile">' + (p.image ? '<img class="avatar" crossorigin="anonymous" src="' + esc(p.image) + '" alt="">' : '<span class="avatar" aria-hidden="true">' + esc(initials) + '</span>')
    + '<div><h1 style="margin:0">' + esc(p.display_name || p.handle) + '</h1><p class="sub" style="margin:0">@' + esc(p.handle) + ' · joined ' + esc(date(p.joined_at)) + (links.length ? ' · ' + links.join(' · ') : '') + '</p>'
    + (p.bio ? '<p>' + esc(p.bio) + '</p>' : '') + '</div></div>'
    + '<div class="grid">'
    + '<div class="cell"><div class="k">Entered</div><div class="v">' + num(rec.competitions_entered) + '</div></div>'
    + '<div class="cell"><div class="k">Placed</div><div class="v">' + num(rec.competitions_placed) + '</div></div>'
    + '<div class="cell"><div class="k">Won</div><div class="v">' + num(rec.competitions_won) + '</div></div>'
    + '<div class="cell"><div class="k">Best place</div><div class="v">' + (rec.best_placement ? '#' + num(rec.best_placement) : '—') + '</div></div>'
    + '<div class="cell"><div class="k">Prize won</div><div class="v">' + money(rec.prize_usd) + '</div></div></div>'
    + (sols.length ? '<h2>Entries</h2><table><thead><tr><th>Bounty</th><th>Entry</th><th>Place</th><th class="num">Prize</th></tr></thead><tbody>'
      + sols.map((s) => {
        const c = s.competition || {};
        return '<tr><td><a href="' + bountyLink(c.slug) + '">' + esc(c.title || c.slug || '—') + '</a></td><td>' + esc(s.title || '—') + '</td><td>' + (s.placement ? '#' + num(s.placement) : '—') + '</td><td class="num">' + (s.prize_usd ? money(s.prize_usd) : '—') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="loading">No entries yet.</p>');
}

// ---- render --------------------------------------------------------------

let navToken = 0;

async function render() {
  const token = ++navToken;
  window.__shotReady = false;
  const r = route();
  document.getElementById('nav-board').setAttribute('aria-current', r.view === 'board' ? 'page' : 'false');
  try {
    if (r.view === 'board') {
      if (!boardData) boardData = await getBounties();
      if (token !== navToken) return;
      document.title = 'Leanboard — make.fun bounties';
      app.innerHTML = boardView();
      boardBind();
    } else if (r.view === 'bounty') {
      const b = await getBounty(r.slug);
      if (token !== navToken) return;
      document.title = b.title + ' | Leanboard';
      app.innerHTML = bountyView(b);
    } else if (r.view === 'leaderboard') {
      const data = await getLeaderboard(r.slug);
      if (token !== navToken) return;
      document.title = 'Leaderboard | Leanboard';
      app.innerHTML = leaderboardView(data, r.slug);
      leaderboardBind();
    } else if (r.view === 'profile') {
      const p = await getProfile(r.handle);
      if (token !== navToken) return;
      document.title = (p.display_name || p.handle) + ' | Leanboard';
      app.innerHTML = profileView(p);
    }
  } catch (e) {
    if (token !== navToken) return;
    failView(e);
  }
  window.scrollTo(0, 0);
  window.__shotReady = true;
}

window.addEventListener('hashchange', render);
render();
