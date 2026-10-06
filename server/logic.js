import {
  DURATION,
  GOOD,
  buildChart,
  judge,
  scoreTimeline,
  simulateBot,
} from '../shared/chart.js';
import { LISTING_MS, MATCH_FEE, listingPhase, listingPrize } from '../shared/listings.js';
import { localWeek, nextSundayMidnight, safeTimeZone } from '../shared/time.js';
import { discordAvatarUrl, discordName } from './discord.js';
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
    discordUsername: user.discordUsername || null,
    discordName: discordName(user),
    discordAvatarUrl: discordAvatarUrl(user),
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
          ownedAvatars: user.ownedAvatars || [],
          ownedMarks: user.ownedMarks || [],
          ownedColors: user.ownedColors || [],
        }
      : {}),
  };
}

function finishedRecord(state, userId) {
  const seen = new Set();
  let wins = 0;
  let losses = 0;
  const consider = (id, hostId, guestId, winnerId) => {
    if (!id || !winnerId || seen.has(id)) return;
    if (hostId !== userId && guestId !== userId) return;
    seen.add(id);
    if (winnerId === userId) wins += 1;
    else losses += 1;
  };
  for (const match of state.matches || []) {
    if (match.status !== 'done') continue;
    consider(match.id, match.hostId, match.guestId, match.winnerId);
  }
  for (const row of state.history || []) {
    const players = row.players || [];
    consider(row.id, players[0]?.id, players[1]?.id, row.winnerId);
  }
  return { matches: wins + losses, wins, losses };
}

function sparringTestUser(user) {
  return !!(user && (user.sparring || String(user.username || '').toLowerCase() === 'sparring'));
}

export function sparringTestMatch(host, guest) {
  return sparringTestUser(host) || sparringTestUser(guest);
}

function canSendForReview(match, host, guest) {
  const reports = match.reports || {};
  const conflict = match.status === 'result'
    && !!reports[match.hostId]
    && !!reports[match.guestId]
    && reports[match.hostId] !== reports[match.guestId];
  return conflict;
}

function clipBrief(match, userId) {
  const clip = userId && match.clips && match.clips[userId];
  if (!clip) return null;
  return { name: clip.name, size: clip.size || 0, at: clip.at || 0 };
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
      discordUsername: user.discordUsername || null,
      discordName: discordName(user),
      discordAvatarUrl: discordAvatarUrl(user),
      record: reveal(user.id) && user.id !== viewerId ? finishedRecord(state, user.id) : null,
    };
  };
  const live = match.status === 'live' || match.status === 'done';
  const inRoom = viewerId && (viewerId === match.hostId || viewerId === match.guestId);
  const reports = match.reports || {};
  const otherId = viewerId === match.hostId ? match.guestId : match.hostId;
  return {
    id: match.id,
    entry: match.entry,
    pot: listingPrize(match.entry),
    fee: MATCH_FEE,
    practice: !!match.practice,
    status: match.status,
    phase: listingPhase(match),
    project: match.project || 'Eon',
    mode: match.mode === '1v1 Kill Race' || match.mode === '1v1 Box Fight' || !match.mode ? 'Kill Race' : match.mode,
    region: match.region || 'EU',
    platform: match.platform || 'All',
    firstTo: match.firstTo || 1,
    expiresAt: match.expiresAt || (match.createdAt || Date.now()) + LISTING_MS,
    messages: inRoom
      ? (match.messages || []).slice(-80).map((row) => ({
          id: row.id,
          text: row.text,
          at: row.at,
          system: !!row.system,
          user: row.system ? null : brief(state.users.find((item) => item.id === row.userId)),
        }))
      : [],
    clips: inRoom
      ? {
          host: clipBrief(match, match.hostId),
          guest: clipBrief(match, match.guestId),
        }
      : null,
    report: inRoom
      ? {
          mine: reports[viewerId] || null,
          theirs: otherId ? reports[otherId] || null : null,
          conflict: !!(reports[match.hostId] && reports[match.guestId] && reports[match.hostId] !== reports[match.guestId]),
          voteUnlockAt: match.voteUnlockAt || 0,
          reportDeadline: match.reportDeadline || 0,
          revoted: !!(match.revotes && match.revotes[viewerId]),
          bothRevoted: !!(match.revotes && match.hostId && match.guestId && match.revotes[match.hostId] && match.revotes[match.guestId]),
          reviewSent: !!(match.review && match.review.sent),
          canReview: canSendForReview(match, host, guest),
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
    rematch: inRoom && match.status === 'done'
      ? {
          fromId: match.rematchAsk?.fromId || null,
          username: state.users.find((item) => item.id === match.rematchAsk?.fromId)?.username || null,
          matchId: match.rematchId || null,
        }
      : null,
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
    const fixed = Array.isArray(cup.places) ? cup.places.map((amount) => round(amount)) : null;
    const cuts = fixed || [0.6, 0.25, 0.15];
    let remaining = cup.prize;
    cuts.forEach((cut, index) => {
      const row = eligible[index];
      if (!row) return;
      const amount = fixed ? round(cut) : index === cuts.length - 1 ? round(remaining) : round(cup.prize * cut);
      if (!fixed) remaining = round(remaining - amount);
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
      const payout = listingPrize(match.entry);
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
  mode = 'Kill Race',
  region = 'EU',
  platform = 'PC',
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
    reportDeadline: 0,
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
    const payout = listingPrize(match.entry);
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

const PORTRAIT_IDS = ['avatar-heat', 'avatar-frost', 'avatar-gold'];
const MARK_IDS = ['avatar-retrac', 'avatar-eon'];
const COLOR_IDS = { 'color-blue': 'blue', 'color-gold': 'gold' };

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function revokedShop(user) {
  if (!Array.isArray(user.revokedShop)) user.revokedShop = [];
  return user.revokedShop;
}

function shopRevoked(user, itemId) {
  return revokedShop(user).includes(itemId);
}

function forgetRevoke(user, itemId) {
  user.revokedShop = revokedShop(user).filter((id) => id !== itemId);
}

export function ensureCosmetics(user) {
  if (!Array.isArray(user.ownedAvatars)) user.ownedAvatars = [];
  if (!Array.isArray(user.ownedMarks)) user.ownedMarks = [];
  if (!Array.isArray(user.ownedColors)) user.ownedColors = [];
  if (PORTRAIT_IDS.includes(user.avatar) && !shopRevoked(user, user.avatar)) pushUnique(user.ownedAvatars, user.avatar);
  if (MARK_IDS.includes(user.avatar)) {
    if (!shopRevoked(user, user.avatar)) {
      pushUnique(user.ownedMarks, user.avatar);
      if (!user.chatIcon || user.chatIcon === 'none') user.chatIcon = user.avatar;
    }
    user.avatar = 'default';
  }
  for (const id of MARK_IDS) {
    if (user.ownedAvatars.includes(id) && !shopRevoked(user, id)) {
      pushUnique(user.ownedMarks, id);
      user.ownedAvatars = user.ownedAvatars.filter((item) => item !== id);
    }
  }
  if (!user.chatIcon || user.chatIcon === 'flame' || user.chatIcon === 'crown' || !MARK_IDS.includes(user.chatIcon)) {
    user.chatIcon = 'none';
  }
  if (user.nameColor === 'blue' && !shopRevoked(user, 'color-blue')) pushUnique(user.ownedColors, 'blue');
  if (user.nameColor === 'gold' && !shopRevoked(user, 'color-gold')) pushUnique(user.ownedColors, 'gold');
}

export function buyItem(state, user, itemId) {
  const item = SHOP.find((entry) => entry.id === itemId);
  if (!item) fail(404, 'That item is not in the shop');
  ensureCosmetics(user);
  if (item.id === 'vip' && isVip(user)) fail(400, 'OG VIP is already active');
  if (PORTRAIT_IDS.includes(item.id) && user.ownedAvatars.includes(item.id)) fail(400, 'You already own that portrait');
  if (MARK_IDS.includes(item.id) && user.ownedMarks.includes(item.id)) fail(400, 'You already own that mark');
  if (COLOR_IDS[item.id] && user.ownedColors.includes(COLOR_IDS[item.id])) fail(400, 'You already own that name color');
  debit(state, user, item.price, 'shop', { item: item.id });
  forgetRevoke(user, item.id);
  if (item.id === 'vip') {
    user.vipUntil = Date.now() + 30 * 86400000;
    user.snipes += 10;
  } else if (item.id === 'snipes') user.snipes += 5;
  else if (item.id === 'shield') user.shields += 1;
  else if (PORTRAIT_IDS.includes(item.id)) {
    pushUnique(user.ownedAvatars, item.id);
    if (!user.avatar || user.avatar === 'default') user.avatar = item.id;
  } else if (MARK_IDS.includes(item.id)) {
    pushUnique(user.ownedMarks, item.id);
    if (!user.chatIcon || user.chatIcon === 'none') user.chatIcon = item.id;
  } else if (COLOR_IDS[item.id]) {
    const color = COLOR_IDS[item.id];
    pushUnique(user.ownedColors, color);
    if (!user.nameColor || user.nameColor === 'default') user.nameColor = color;
  }
  return item;
}

export function equipCosmetic(user, slot, id) {
  ensureCosmetics(user);
  if (slot === 'avatar') {
    if (!user.ownedAvatars.includes(id)) fail(400, 'You do not own that portrait');
    user.avatar = id;
    return;
  }
  if (slot === 'mark') {
    if (!user.ownedMarks.includes(id)) fail(400, 'You do not own that mark');
    user.chatIcon = id;
    return;
  }
  if (slot === 'color') {
    if (!user.ownedColors.includes(id)) fail(400, 'You do not own that name color');
    user.nameColor = id;
    return;
  }
  fail(400, 'Unknown cosmetic slot');
}

const PORTRAIT_NAMES = {
  'avatar-heat': 'Heat portrait',
  'avatar-frost': 'Frost portrait',
  'avatar-gold': 'Gold portrait',
};
const MARK_NAMES = {
  'avatar-retrac': 'Retrac',
  'avatar-eon': 'Eon',
};
const COLOR_NAMES = { blue: 'Blue name', gold: 'Gold name' };

export function inventoryItems(user) {
  ensureCosmetics(user);
  const items = [];
  if (isVip(user)) {
    const days = Math.max(1, Math.ceil((user.vipUntil - Date.now()) / 86400000));
    items.push({
      key: 'vip',
      label: 'OG VIP',
      detail: `${days} day${days === 1 ? '' : 's'} left`,
      button: 'Remove VIP',
    });
  }
  if ((user.snipes || 0) > 0) {
    items.push({
      key: 'snipes',
      label: 'Snipes',
      detail: `${user.snipes} remaining`,
      button: 'Remove snipes',
    });
  }
  if ((user.shields || 0) > 0) {
    items.push({
      key: 'shield',
      label: 'Streak shields',
      detail: String(user.shields),
      button: 'Remove streak shield',
    });
  }
  for (const id of user.ownedAvatars) {
    const name = PORTRAIT_NAMES[id];
    if (!name) continue;
    const short = name.replace(' portrait', '');
    items.push({
      key: id,
      label: name,
      detail: user.avatar === id ? 'Equipped' : 'Owned',
      button: name.includes('portrait') ? `Remove ${short} portrait` : `Remove ${name}`,
    });
  }
  for (const id of user.ownedMarks) {
    const name = MARK_NAMES[id];
    if (!name) continue;
    items.push({
      key: id,
      label: name,
      detail: user.chatIcon === id ? 'Equipped' : 'Owned',
      button: `Remove ${name}`,
    });
  }
  for (const id of user.ownedColors) {
    const name = COLOR_NAMES[id];
    if (!name) continue;
    items.push({
      key: id,
      label: name,
      detail: user.nameColor === id ? 'Equipped' : 'Owned',
      button: `Remove ${name}`,
    });
  }
  return items;
}

export const INVENTORY_GRANTS = [
  { key: 'avatar-heat', label: 'Heat portrait' },
  { key: 'avatar-frost', label: 'Frost portrait' },
  { key: 'avatar-gold', label: 'Gold portrait' },
  { key: 'avatar-retrac', label: 'Retrac' },
  { key: 'avatar-eon', label: 'Eon' },
  { key: 'blue', label: 'Blue name' },
  { key: 'gold', label: 'Gold name' },
  { key: 'snipes', label: 'Snipe (+5)' },
  { key: 'shield', label: 'Streak shield (+1)' },
  { key: 'vip', label: 'OG VIP (30 days)' },
];

export function grantsAvailable(user) {
  ensureCosmetics(user);
  return INVENTORY_GRANTS.filter((grant) => {
    if (grant.key === 'snipes' || grant.key === 'shield') return true;
    if (grant.key === 'vip') return !isVip(user);
    if (PORTRAIT_IDS.includes(grant.key)) return !user.ownedAvatars.includes(grant.key);
    if (MARK_IDS.includes(grant.key)) return !user.ownedMarks.includes(grant.key);
    if (grant.key === 'blue' || grant.key === 'gold') return !user.ownedColors.includes(grant.key);
    return false;
  });
}

export function grantInventoryItem(user, key) {
  ensureCosmetics(user);
  if (key === 'vip') {
    if (isVip(user)) return false;
    user.vipUntil = Date.now() + 30 * 86400000;
    return true;
  }
  if (key === 'snipes') {
    user.snipes = (user.snipes || 0) + 5;
    return true;
  }
  if (key === 'shield') {
    user.shields = (user.shields || 0) + 1;
    return true;
  }
  if (PORTRAIT_IDS.includes(key)) {
    if (user.ownedAvatars.includes(key)) return false;
    forgetRevoke(user, key);
    pushUnique(user.ownedAvatars, key);
    if (!user.avatar || user.avatar === 'default') user.avatar = key;
    return true;
  }
  if (MARK_IDS.includes(key)) {
    if (user.ownedMarks.includes(key)) return false;
    forgetRevoke(user, key);
    pushUnique(user.ownedMarks, key);
    if (!user.chatIcon || user.chatIcon === 'none') user.chatIcon = key;
    return true;
  }
  if (key === 'blue' || key === 'gold') {
    if (user.ownedColors.includes(key)) return false;
    forgetRevoke(user, key === 'blue' ? 'color-blue' : 'color-gold');
    pushUnique(user.ownedColors, key);
    if (!user.nameColor || user.nameColor === 'default') user.nameColor = key;
    return true;
  }
  fail(400, 'That item cannot be added');
}

export function removeInventoryItem(user, key) {
  ensureCosmetics(user);
  if (key === 'vip') {
    user.vipUntil = 0;
    return;
  }
  if (key === 'snipes') {
    user.snipes = 0;
    return;
  }
  if (key === 'shield') {
    user.shields = 0;
    return;
  }
  if (PORTRAIT_IDS.includes(key)) {
    user.ownedAvatars = user.ownedAvatars.filter((id) => id !== key);
    if (user.avatar === key) user.avatar = 'default';
    pushUnique(revokedShop(user), key);
    return;
  }
  if (MARK_IDS.includes(key)) {
    user.ownedMarks = user.ownedMarks.filter((id) => id !== key);
    if (user.chatIcon === key) user.chatIcon = 'none';
    pushUnique(revokedShop(user), key);
    return;
  }
  if (key === 'blue' || key === 'gold') {
    user.ownedColors = user.ownedColors.filter((id) => id !== key);
    if (user.nameColor === key) user.nameColor = 'default';
    pushUnique(revokedShop(user), key === 'blue' ? 'color-blue' : 'color-gold');
    return;
  }
  fail(400, 'That item is not in this inventory');
}

export function unequipCosmetic(user, slot) {
  ensureCosmetics(user);
  if (slot === 'avatar') {
    user.avatar = 'default';
    return;
  }
  if (slot === 'mark') {
    user.chatIcon = 'none';
    return;
  }
  if (slot === 'color') {
    user.nameColor = 'default';
    return;
  }
  fail(400, 'Unknown cosmetic slot');
}

export function blocked(user) {
  return user && user.excludedUntil > Date.now();
}

export function referralBonus() {
  return 0.05;
}

export const PACKS = [
  { coins: 5, price: 5 },
  { coins: 10, price: 10 },
  { coins: 15, price: 15 },
  { coins: 20, price: 20 },
  { coins: 25, price: 25 },
  { coins: 50, price: 50 },
];

export const PURCHASE_TAX_PENCE = 230;
export const CRYPTO_FEE_UNITS = 3;

export function chargePence(tokens) {
  return Math.round(tokens * 100) + PURCHASE_TAX_PENCE;
}

export function cryptoPriceGbp(tokens) {
  return round(tokens + CRYPTO_FEE_UNITS);
}

export const CRYPTO_NETWORKS = ['Solana', 'Ethereum', 'Bitcoin'];
export const MIN_WITHDRAW = 15;
export const WITHDRAW_FEE = 2.5;
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
  const amount = round(row.amount);
  const fee = row.fee == null ? 0 : round(row.fee);
  const payout = row.payout == null ? amount : round(row.payout);
  return {
    id: row.id,
    amount,
    fee,
    payout,
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

export function purchaseAmount(raw) {
  const amount = cashAmount(raw, 'a purchase amount');
  if (amount < 1) fail(400, 'Minimum purchase is 1');
  if (amount > 1000) fail(400, 'Maximum purchase is 1000');
  return amount;
}

export function creditPaidCheckout(state, session) {
  if (!session || session.mode !== 'payment' || session.payment_status !== 'paid') return { skipped: true };
  const sessionId = String(session.id || '');
  if (!sessionId.startsWith('cs_')) fail(400, 'Missing checkout session');
  const userId = String(session.metadata?.userId || session.client_reference_id || '');
  const tokens = purchaseAmount(session.metadata?.tokens);
  const currency = String(session.currency || '').toLowerCase();
  const paid = Number(session.amount_total);
  if (String(session.metadata?.channel || 'card') !== 'card' || currency !== 'gbp' || paid !== chargePence(tokens)) {
    fail(400, 'Paid amount does not match the token pack');
  }
  if (!Array.isArray(state.paidCheckouts)) state.paidCheckouts = [];
  const already =
    state.paidCheckouts.includes(sessionId) ||
    state.txs.some((tx) => tx.meta && tx.meta.sessionId === sessionId);
  if (already) return { duplicate: true, credited: 0 };
  const user = state.users.find((item) => item.id === userId && !item.npc);
  if (!user) fail(404, 'That player is no longer on the server');
  credit(state, user, tokens, 'deposit', { price: tokens, sessionId, provider: 'stripe', channel: 'card' });
  state.paidCheckouts.push(sessionId);
  if (state.paidCheckouts.length > 500) state.paidCheckouts.splice(0, state.paidCheckouts.length - 500);
  return { credited: tokens, duplicate: false, username: user.username };
}

export function creditNowPayment(state, body) {
  const orderId = String(body?.order_id || '');
  const paymentId = String(body?.payment_id || '');
  const invoice = (state.nowInvoices || []).find((row) => row.orderId === orderId);
  if (!invoice || !paymentId) return { credited: 0, username: invoice?.username || '', price: invoice?.price || 0 };
  const price = Number(body.price_amount);
  const currency = String(body.price_currency || '').toLowerCase();
  if (currency !== 'gbp' || round(price) !== round(invoice.price)) {
    fail(400, 'Paid amount does not match the token pack');
  }
  if (String(body.payment_status || '') !== 'finished') {
    return { credited: 0, username: invoice.username || '', price: invoice.price, tokens: invoice.tokens };
  }
  if (!Array.isArray(state.paidCheckouts)) state.paidCheckouts = [];
  const key = `np_${paymentId}`;
  const already = state.paidCheckouts.includes(key) || state.txs.some((tx) => tx.meta && tx.meta.sessionId === key);
  if (already) return { credited: 0, duplicate: true, username: invoice.username || '', price: invoice.price };
  const user = state.users.find((item) => item.id === invoice.userId && !item.npc);
  if (!user) fail(404, 'That player is no longer on the server');
  credit(state, user, invoice.tokens, 'deposit', { price: invoice.tokens, sessionId: key, provider: 'nowpayments', channel: 'crypto' });
  state.paidCheckouts.push(key);
  if (state.paidCheckouts.length > 500) state.paidCheckouts.splice(0, state.paidCheckouts.length - 500);
  return { credited: invoice.tokens, duplicate: false, username: user.username, price: invoice.price };
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
  const fee = WITHDRAW_FEE;
  const payout = round(amount - fee);
  if (payout <= 0) fail(400, 'Minimum withdrawal is 15');
  const method = String(body.method || '').trim().toLowerCase();
  if (!['paypal', 'crypto', 'bank'].includes(method)) fail(400, 'Choose PayPal, Crypto, or Bank');
  const destination = withdrawalDestination(method, body || {});
  const notify = !!body.notify;
  if (!Array.isArray(state.withdrawals)) state.withdrawals = [];
  const id = rid('w');
  debit(state, user, amount, 'withdraw', { withdrawal: id, method, status: 'pending', fee, payout });
  user.withdrawn = round((user.withdrawn || 0) + amount);
  const row = {
    id,
    userId: user.id,
    amount,
    fee,
    payout,
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
