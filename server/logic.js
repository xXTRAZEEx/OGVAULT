import {
  DURATION,
  GOOD,
  buildChart,
  judge,
  scoreTimeline,
  simulateBot,
} from '../shared/chart.js';
import { LISTING_MS, listingPhase } from '../shared/listings.js';
import { localWeek, nextSundayMidnight, safeTimeZone } from '../shared/time.js';
import { FEE, SHOP, fail, isVip, rid, round, winRate } from './store.js';

export { DURATION };

export function credit(state, user, amount, type, meta) {
  const value = round(amount);
  user.balance = round(user.balance + value);
  state.txs.unshift({
    id: rid('t'),
    userId: user.id,
    amount: value,
    type,
    meta: meta || {},
    at: Date.now(),
  });
  if (state.txs.length > 600) state.txs.length = 600;
  return value;
}

export function debit(state, user, amount, type, meta) {
  const value = round(amount);
  if (user.balance + 1e-9 < value) fail(400, 'Not enough tokens');
  user.balance = round(user.balance - value);
  state.txs.unshift({
    id: rid('t'),
    userId: user.id,
    amount: -value,
    type,
    meta: meta || {},
    at: Date.now(),
  });
  return value;
}

export function userDto(user, { self = false, online = false } = {}) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    npc: !!user.npc,
    vip: isVip(user),
    avatar: user.avatar,
    chatIcon: user.chatIcon,
    nameColor: user.nameColor,
    online,
    stats: { ...user.stats, winRate: winRate(user) },
    usernameHistory: user.usernameHistory || [],
    createdAt: user.createdAt,
    ...(self
      ? {
          email: user.email,
          balance: user.balance,
          snipes: user.snipes,
          shields: user.shields,
          referral: user.referral,
          excludedUntil: user.excludedUntil || 0,
          withdrawn: user.withdrawn || 0,
          dailyClaimedAt: user.dailyClaimedAt || 0,
          vipUntil: user.vipUntil || 0,
        }
      : {}),
  };
}

function record(user) {
  return {
    wins: user.stats.wins,
    losses: user.stats.losses,
    matches: user.stats.matches,
    streak: user.stats.streak,
    bestStreak: user.stats.bestStreak,
    earned: user.stats.earned,
    bestScore: user.stats.bestScore,
    winRate: winRate(user),
  };
}

export function matchDto(state, match, viewerId) {
  const host = state.users.find((u) => u.id === match.hostId);
  const guest = state.users.find((u) => u.id === match.guestId);
  const reveal = (id) => {
    if (!id) return false;
    if (id === viewerId) return true;
    if (match.practice) return true;
    return !!(match.sniped && match.sniped[viewerId]);
  };
  const brief = (user) => {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      npc: !!user.npc,
      vip: isVip(user),
      avatar: user.avatar,
      chatIcon: user.chatIcon,
      nameColor: user.nameColor,
      record: reveal(user.id) ? record(user) : null,
    };
  };
  const live = match.status === 'live' || match.status === 'done';
  const inRoom = viewerId && (viewerId === match.hostId || viewerId === match.guestId);
  const reports = match.reports || {};
  const otherId = viewerId === match.hostId ? match.guestId : match.hostId;
  return {
    id: match.id,
    entry: match.entry,
    pot: round(match.entry * 2),
    fee: FEE,
    practice: !!match.practice,
    status: match.status,
    phase: listingPhase(match),
    project: match.project || 'Eon',
    mode: match.mode || '1v1 Box Fight',
    region: match.region || 'EU',
    platform: match.platform || 'All',
    firstTo: match.firstTo || 1,
    expiresAt: match.expiresAt || (match.createdAt || Date.now()) + LISTING_MS,
    messages: inRoom
      ? (match.messages || []).slice(-80).map((row) => ({
          id: row.id,
          text: row.text,
          at: row.at,
          user: brief(state.users.find((item) => item.id === row.userId)),
        }))
      : [],
    report: inRoom
      ? {
          mine: reports[viewerId] || null,
          theirs: otherId ? reports[otherId] || null : null,
          conflict: !!(reports[match.hostId] && reports[match.guestId] && reports[match.hostId] !== reports[match.guestId]),
        }
      : null,
    invitee: match.invitee,
    createdAt: match.createdAt,
    startAt: match.startAt || 0,
    seed: live ? match.seed : 0,
    duration: DURATION,
    host: brief(host),
    guest: brief(guest),
    hostReady: !!match.hostReady,
    guestReady: !!match.guestReady,
    scores: match.scores || {},
    winnerId: match.winnerId,
    payout: match.payout || 0,
    forfeitId: match.forfeitId,
    bot: match.bot && live ? match.bot : match.bot ? { sparring: true } : null,
    sniped: !!(viewerId && match.sniped && match.sniped[viewerId]),
    sparring: !!(host && host.npc) || !!(guest && guest.npc),
  };
}

const WEEK_MS = 7 * 86400000;
export const POTW_PRIZES = [15, 10, 5];

export function potwWindow(potw, now = Date.now()) {
  const endsAt = potw && typeof potw.endsAt === 'number' ? potw.endsAt : now + WEEK_MS;
  const start = potw && typeof potw.startAt === 'number' ? potw.startAt : endsAt - WEEK_MS;
  return { start, endsAt };
}

export function potwLeaders(state, start, end) {
  const totals = new Map();
  for (const row of state.history || []) {
    if (!row || row.practice || !row.winnerId) continue;
    const at = row.at || 0;
    if (at < start || at >= end) continue;
    const won = round(row.payout || 0);
    if (won <= 0) continue;
    const current = totals.get(row.winnerId) || { won: 0, wins: 0, latest: 0 };
    current.won = round(current.won + won);
    current.wins += 1;
    current.latest = Math.max(current.latest, at);
    totals.set(row.winnerId, current);
  }
  return [...totals.entries()]
    .map(([userId, row]) => ({ userId, won: row.won, wins: row.wins, latest: row.latest }))
    .sort((a, b) => b.won - a.won || b.wins - a.wins || a.latest - b.latest);
}

export function ensurePotw(state, timeZone) {
  const requested = safeTimeZone(timeZone);
  const now = Date.now();
  let changed = false;
  if (!state.potw || typeof state.potw.endsAt !== 'number') {
    const zone = requested || 'UTC';
    const week = localWeek(now, zone);
    state.potw = { endsAt: week.endsAt, startAt: week.start, timeZone: zone, paidUntil: 0 };
    return true;
  }
  if (state.potw.candidates || state.potw.voters) {
    state.potw = {
      endsAt: state.potw.endsAt,
      startAt: state.potw.startAt,
      timeZone: state.potw.timeZone,
      paidUntil: state.potw.paidUntil || 0,
    };
    changed = true;
  }
  if (typeof state.potw.paidUntil !== 'number') {
    state.potw.paidUntil = 0;
    changed = true;
  }
  let guard = 0;
  while (now >= state.potw.endsAt && guard < 60) {
    const end = state.potw.endsAt;
    const zone = safeTimeZone(state.potw.timeZone) || requested || 'UTC';
    const start = typeof state.potw.startAt === 'number' ? state.potw.startAt : end - WEEK_MS;
    const from = Math.max(start, state.potw.paidUntil || 0);
    if (from < end) {
      const ranked = potwLeaders(state, from, end);
      POTW_PRIZES.forEach((prize, index) => {
        const row = ranked[index];
        if (!row) return;
        const user = state.users.find((item) => item.id === row.userId);
        if (!user) return;
        credit(state, user, prize, 'potw', { place: index + 1 });
        user.stats.earned = round(user.stats.earned + prize);
        state.prizes = round(state.prizes + prize);
      });
    }
    let nextEnd = nextSundayMidnight(end, zone);
    if (!(nextEnd > end)) nextEnd = end + WEEK_MS;
    state.potw = { startAt: end, endsAt: nextEnd, timeZone: zone, paidUntil: end };
    changed = true;
    guard += 1;
  }
  if (requested && now < state.potw.endsAt) {
    const week = localWeek(now, requested);
    if (state.potw.endsAt !== week.endsAt || state.potw.startAt !== week.start || state.potw.timeZone !== requested) {
      state.potw.endsAt = week.endsAt;
      state.potw.startAt = week.start;
      state.potw.timeZone = requested;
      changed = true;
    }
  } else if (typeof state.potw.startAt !== 'number') {
    state.potw.startAt = state.potw.endsAt - WEEK_MS;
    changed = true;
  }
  return changed;
}

export function ensureCups(state) {
  let changed = false;
  for (const cup of state.tournaments) {
    if (cup.paidOut || Date.now() < cup.endsAt) continue;
    const eligible = cup.board
      .filter((row) => row.plays > 0)
      .sort((a, b) => b.points - a.points);
    const cuts = [0.6, 0.25, 0.15];
    let remaining = cup.prize;
    cuts.forEach((cut, index) => {
      const row = eligible[index];
      if (!row) return;
      const amount = index === cuts.length - 1 ? round(remaining) : round(cup.prize * cut);
      remaining = round(remaining - amount);
      const user = state.users.find((u) => u.id === row.userId);
      if (user && amount > 0) {
        credit(state, user, amount, 'tournament', { cup: cup.id, place: index + 1 });
        user.stats.earned = round(user.stats.earned + amount);
        state.prizes = round(state.prizes + amount);
      }
      row.place = index + 1;
      row.prize = amount;
    });
    cup.paidOut = true;
    changed = true;
  }
  return changed;
}

function applyResult(user, match, score) {
  user.stats.bestScore = Math.max(user.stats.bestScore || 0, score || 0);
  if (match.practice) return;
  user.stats.matches += 1;
  if (!match.winnerId) return;
  if (match.winnerId === user.id) {
    user.stats.wins += 1;
    user.stats.streak += 1;
    user.stats.bestStreak = Math.max(user.stats.bestStreak || 0, user.stats.streak);
    const profit = round((match.payout || 0) - match.entry);
    if (profit > 0) user.stats.earned = round(user.stats.earned + profit);
  } else {
    user.stats.losses += 1;
    if (user.shields > 0) user.shields -= 1;
    else user.stats.streak = 0;
  }
}

function addCupPoints(state, userId, match, score) {
  if (match.practice) return;
  for (const cup of state.tournaments) {
    if (cup.paidOut || Date.now() > cup.endsAt) continue;
    const row = cup.board.find((item) => item.userId === userId);
    if (!row) continue;
    const win = match.winnerId === userId ? 100 : 0;
    row.points = round(row.points + score / 100 + win);
    row.plays += 1;
  }
}

export function resolveMatch(state, match, { forfeitId = null } = {}) {
  if (match.status !== 'live' && match.status !== 'done') return;
  if (match.status === 'done') return;
  const chart = buildChart(match.seed);
  const end = (chart.at(-1)?.t || DURATION) + GOOD + 1;
  const host = state.users.find((u) => u.id === match.hostId);
  const guest = state.users.find((u) => u.id === match.guestId);
  const scoreOf = (user) => {
    if (!user) return 0;
    if (forfeitId && user.id === forfeitId) return 0;
    if (user.npc && match.bot) return simulateBot(chart, match.bot.skill, match.bot.seed).score;
    return scoreTimeline(chart, match.actions[user.id] || [], end).score;
  };
  const hostScore = scoreOf(host);
  const guestScore = scoreOf(guest);
  match.scores = {};
  if (host) match.scores[host.id] = hostScore;
  if (guest) match.scores[guest.id] = guestScore;
  match.forfeitId = forfeitId;
  if (hostScore === guestScore) match.winnerId = null;
  else match.winnerId = hostScore > guestScore ? host.id : guest.id;
  match.status = 'done';
  match.payout = 0;
  if (!match.practice && match.entry > 0) {
    if (!match.winnerId) {
      if (host) credit(state, host, match.entry, 'refund', { match: match.id });
      if (guest && !guest.npc) credit(state, guest, match.entry, 'refund', { match: match.id });
      if (guest && guest.npc) guest.balance = round(guest.balance + match.entry);
    } else {
      const payout = round(match.entry * 2 * (1 - FEE));
      match.payout = payout;
      const winner = match.winnerId === host.id ? host : guest;
      if (winner) {
        credit(state, winner, payout, 'win', { match: match.id });
        state.prizes = round(state.prizes + payout);
      }
    }
  }
  for (const user of [host, guest]) {
    if (!user) continue;
    const score = match.scores[user.id] || 0;
    applyResult(user, match, score);
    addCupPoints(state, user.id, match, score);
  }
  state.history.unshift({
    id: match.id,
    at: Date.now(),
    entry: match.entry,
    pot: round(match.entry * 2),
    payout: match.payout,
    winnerId: match.winnerId,
    practice: !!match.practice,
    forfeit: !!forfeitId,
    players: [host, guest].filter(Boolean).map((user) => ({
      id: user.id,
      username: user.username,
      score: match.scores[user.id] || 0,
    })),
  });
  if (state.history.length > 200) state.history.length = 200;
}

export function freshMatch({
  host,
  entry,
  practice = false,
  invitee = null,
  project = 'Eon',
  mode = '1v1 Box Fight',
  region = 'EU',
  platform = 'All',
  firstTo = 1,
}) {
  const createdAt = Date.now();
  return {
    id: rid('m'),
    hostId: host.id,
    guestId: null,
    entry,
    practice,
    status: 'open',
    invitee,
    project,
    mode,
    region,
    platform,
    firstTo,
    createdAt,
    expiresAt: createdAt + LISTING_MS,
    messages: [],
    reports: {},
    startAt: 0,
    seed: 0,
    bot: null,
    hostReady: false,
    guestReady: false,
    actions: {},
    scores: {},
    winnerId: null,
    payout: 0,
    forfeitId: null,
    sniped: {},
  };
}

export function settleAgreed(state, match, winnerId, { forfeitId = null } = {}) {
  if (match.status === 'done') return;
  const host = state.users.find((user) => user.id === match.hostId);
  const guest = state.users.find((user) => user.id === match.guestId);
  if (!host || !guest) fail(400, 'Both players need to be in the lobby');
  if (winnerId !== host.id && winnerId !== guest.id) fail(400, 'Pick a player in this lobby');
  match.scores = {
    [host.id]: winnerId === host.id ? 1 : 0,
    [guest.id]: winnerId === guest.id ? 1 : 0,
  };
  match.winnerId = winnerId;
  match.forfeitId = forfeitId;
  match.status = 'done';
  match.payout = 0;
  if (!match.practice && match.entry > 0) {
    const payout = round(match.entry * 2 * (1 - FEE));
    match.payout = payout;
    const winner = winnerId === host.id ? host : guest;
    credit(state, winner, payout, 'win', { match: match.id });
    state.prizes = round(state.prizes + payout);
  }
  for (const user of [host, guest]) {
    applyResult(user, match, match.scores[user.id] || 0);
    addCupPoints(state, user.id, match, match.scores[user.id] || 0);
  }
  state.history.unshift({
    id: match.id,
    at: Date.now(),
    entry: match.entry,
    pot: round(match.entry * 2),
    payout: match.payout,
    winnerId: match.winnerId,
    practice: !!match.practice,
    forfeit: !!forfeitId,
    mode: match.mode,
    project: match.project,
    players: [host, guest].map((user) => ({
      id: user.id,
      username: user.username,
      score: match.scores[user.id] || 0,
    })),
  });
  if (state.history.length > 200) state.history.length = 200;
}

export function attachBot(match, npcUser) {
  match.bot = {
    skill: npcUser.skill || 0.6,
    seed: Math.floor(Math.random() * 0xffffffff),
  };
}

export function startPlaying(match) {
  match.status = 'playing';
  match.startAt = Date.now();
}

export function goLive(match) {
  match.status = 'live';
  match.seed = Math.floor(Math.random() * 0xffffffff);
  match.startAt = Date.now() + 3800;
  match.actions = {};
  if (match.hostId) match.actions[match.hostId] = [];
  if (match.guestId) match.actions[match.guestId] = [];
  match.scores = { [match.hostId]: 0 };
  if (match.guestId) match.scores[match.guestId] = 0;
}

export function buyItem(state, user, itemId) {
  const item = SHOP.find((entry) => entry.id === itemId);
  if (!item) fail(404, 'That item is not in the shop');
  if (item.id.startsWith('avatar-') && user.avatar === item.id) fail(400, 'You already wear that portrait');
  if (item.id === 'icon-flame' && user.chatIcon === 'flame') fail(400, 'Flame mark is already equipped');
  if (item.id === 'icon-crown' && user.chatIcon === 'crown') fail(400, 'Crown mark is already equipped');
  if (item.id === 'color-blue' && user.nameColor === 'blue') fail(400, 'Blue name is already equipped');
  if (item.id === 'color-gold' && user.nameColor === 'gold') fail(400, 'Gold name is already equipped');
  debit(state, user, item.price, 'shop', { item: item.id });
  if (item.id === 'vip') {
    const base = Math.max(Date.now(), user.vipUntil || 0);
    user.vipUntil = base + 30 * 86400000;
    user.snipes += 10;
    if (!user.chatIcon || user.chatIcon === 'none') user.chatIcon = 'crown';
  } else if (item.id === 'snipes') user.snipes += 5;
  else if (item.id === 'shield') user.shields += 1;
  else if (item.id.startsWith('avatar-')) user.avatar = item.id;
  else if (item.id === 'icon-flame') user.chatIcon = 'flame';
  else if (item.id === 'icon-crown') user.chatIcon = 'crown';
  else if (item.id === 'color-blue') user.nameColor = 'blue';
  else if (item.id === 'color-gold') user.nameColor = 'gold';
  return item;
}

export function blocked(user) {
  return user && user.excludedUntil > Date.now();
}

export function referralBonus(user) {
  return isVip(user) ? 8 : 3;
}

export const PACKS = [
  { coins: 5, price: 5 },
  { coins: 10, price: 10 },
  { coins: 15, price: 15 },
  { coins: 20, price: 20 },
  { coins: 25, price: 25 },
  { coins: 50, price: 50 },
];

export const CRYPTO_NETWORKS = ['Solana', 'Ethereum', 'Bitcoin'];
export const MIN_WITHDRAW = 15;
const WITHDRAW_MS = 24 * 60 * 60 * 1000;

export function tipQuote(user, amount) {
  const value = round(amount);
  const fee = !user || isVip(user) ? 0 : round(value * FEE);
  return { amount: value, fee, total: round(value + fee), receive: value };
}

function cashAmount(raw, label) {
  const value = round(raw);
  if (!Number.isFinite(value)) fail(400, `Enter ${label}`);
  return value;
}

export function settleWithdrawals(state) {
  if (!Array.isArray(state.withdrawals)) return;
  const now = Date.now();
  for (const row of state.withdrawals) {
    if (row.status === 'pending' && row.readyAt <= now) row.status = 'processed';
  }
}

export function withdrawalDto(row) {
  return {
    id: row.id,
    amount: row.amount,
    method: row.method,
    destination: row.destination,
    notify: !!row.notify,
    status: row.status,
    createdAt: row.createdAt,
    readyAt: row.readyAt,
  };
}

export function walletSnapshot(state, user) {
  settleWithdrawals(state);
  return {
    user: userDto(user, { self: true }),
    txs: state.txs.filter((tx) => tx.userId === user.id).slice(0, 40),
    withdrawals: (state.withdrawals || []).filter((row) => row.userId === user.id).slice(0, 20).map(withdrawalDto),
  };
}

function applyReferral(state, user, code) {
  const referral = String(code || '').trim();
  if (!referral) return { applied: false };
  if (user.referral.toLowerCase() === referral.toLowerCase()) fail(400, 'You cannot use your own referral code');
  const host = state.users.find((item) => !item.npc && item.referral.toLowerCase() === referral.toLowerCase() && item.id !== user.id);
  if (!host) fail(400, 'That referral code is not on this server');
  const already = user.referredBy || state.txs.some((tx) => tx.userId === user.id && tx.type === 'referral' && tx.amount > 0);
  if (already) return { applied: false, already: true, host: host.username };
  const bonus = referralBonus(host);
  credit(state, user, bonus, 'referral', { from: host.username });
  credit(state, host, bonus, 'referral', { from: user.username });
  user.referredBy = host.id;
  return { applied: true, bonus, host: host.username };
}

export function purchaseAmount(raw) {
  const amount = cashAmount(raw, 'a purchase amount');
  if (amount < 1) fail(400, 'Minimum purchase is 1');
  if (amount > 1000) fail(400, 'Maximum purchase is 1000');
  return amount;
}

export function assertReferralCode(state, user, code) {
  const referral = String(code || '').trim();
  if (!referral) return '';
  if (referral.length > 32) fail(400, 'That referral code is not on this server');
  if (user.referral.toLowerCase() === referral.toLowerCase()) fail(400, 'You cannot use your own referral code');
  const host = state.users.find(
    (item) => !item.npc && item.referral.toLowerCase() === referral.toLowerCase() && item.id !== user.id
  );
  if (!host) fail(400, 'That referral code is not on this server');
  return referral;
}

export function creditPaidCheckout(state, session) {
  if (!session || session.mode !== 'payment' || session.payment_status !== 'paid') return { skipped: true };
  const sessionId = String(session.id || '');
  if (!sessionId.startsWith('cs_')) fail(400, 'Missing checkout session');
  const userId = String(session.metadata?.userId || session.client_reference_id || '');
  const tokens = purchaseAmount(session.metadata?.tokens);
  const expected = Math.round(tokens * 100);
  if (session.currency !== 'usd' || Number(session.amount_total) !== expected) {
    fail(400, 'Paid amount does not match the token pack');
  }
  if (!Array.isArray(state.paidCheckouts)) state.paidCheckouts = [];
  const already =
    state.paidCheckouts.includes(sessionId) ||
    state.txs.some((tx) => tx.meta && tx.meta.sessionId === sessionId);
  if (already) return { duplicate: true, credited: 0 };
  const user = state.users.find((item) => item.id === userId && !item.npc);
  if (!user) fail(404, 'That player is no longer on the server');
  const referral = String(session.metadata?.referral || '').trim();
  let referralResult = { applied: false };
  if (referral) {
    try {
      referralResult = applyReferral(state, user, referral);
    } catch {
      referralResult = { applied: false };
    }
  }
  credit(state, user, tokens, 'deposit', { price: tokens, sessionId, provider: 'stripe' });
  state.paidCheckouts.push(sessionId);
  if (state.paidCheckouts.length > 500) state.paidCheckouts.splice(0, state.paidCheckouts.length - 500);
  return { credited: tokens, duplicate: false, referral: referralResult };
}

function withdrawalDestination(method, body) {
  if (method === 'paypal') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) fail(400, 'Enter the PayPal email');
    return { email };
  }
  if (method === 'crypto') {
    const network = CRYPTO_NETWORKS.find((item) => item.toLowerCase() === String(body.network || '').trim().toLowerCase());
    if (!network) fail(400, 'Choose a crypto network');
    const address = String(body.address || '').trim();
    if (address.length < 8 || address.length > 128 || /\s/.test(address)) fail(400, 'Enter the wallet address');
    return { network, address };
  }
  const accountName = String(body.accountName || '').trim();
  const accountNumber = String(body.accountNumber || '').replace(/[\s-]/g, '');
  const sortCode = String(body.sortCode || body.routing || '').replace(/[\s-]/g, '');
  if (accountName.length < 2 || accountName.length > 80) fail(400, 'Enter the account name');
  if (!/^[0-9]{4,18}$/.test(accountNumber)) fail(400, 'Enter the account number');
  if (!/^[0-9]{6,9}$/.test(sortCode)) fail(400, 'Enter a sort code or routing number');
  return { accountName, accountNumber, sortCode };
}

export function requestWithdrawal(state, user, body) {
  const amount = cashAmount(body.amount, 'a withdrawal amount');
  if (amount < MIN_WITHDRAW) fail(400, 'Minimum withdrawal is 15');
  const method = String(body.method || '').trim().toLowerCase();
  if (!['paypal', 'crypto', 'bank'].includes(method)) fail(400, 'Choose PayPal, Crypto, or Bank');
  const destination = withdrawalDestination(method, body || {});
  const notify = !!body.notify;
  if (!Array.isArray(state.withdrawals)) state.withdrawals = [];
  const id = rid('w');
  debit(state, user, amount, 'withdraw', { withdrawal: id, method, status: 'pending' });
  user.withdrawn = round((user.withdrawn || 0) + amount);
  const row = {
    id,
    userId: user.id,
    amount,
    method,
    destination,
    notify,
    status: 'pending',
    createdAt: Date.now(),
    readyAt: Date.now() + WITHDRAW_MS,
  };
  state.withdrawals.unshift(row);
  if (state.withdrawals.length > 300) state.withdrawals.length = 300;
  return row;
}

export function sendTip(state, user, rawAmount, username) {
  const name = String(username || '').trim();
  if (!name) fail(400, 'Enter a username');
  const quote = tipQuote(user, rawAmount);
  if (!(quote.amount > 0)) fail(400, 'Enter a tip amount');
  if (quote.amount > 1000) fail(400, 'That tip is too large');
  const recipient = state.users.find((item) => !item.npc && item.username.toLowerCase() === name.toLowerCase());
  if (!recipient) fail(400, 'No account uses that username');
  if (recipient.id === user.id) fail(400, 'You cannot tip yourself');
  if (user.balance + 1e-9 < quote.total) fail(400, 'Not enough tokens for the tip and fee');
  debit(state, user, quote.total, 'tip', { to: recipient.username, fee: quote.fee, receive: quote.receive });
  credit(state, recipient, quote.receive, 'tip', { from: user.username });
  return { ...quote, username: recipient.username };
}
