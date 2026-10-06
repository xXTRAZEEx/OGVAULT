import './env.js';
import http from 'http';
import path from 'path';
import express from 'express';
import busboy from 'busboy';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DURATION, GOOD, buildChart, judge, scoreTimeline } from '../shared/chart.js';
import { LISTING_MS, MODES, PLATFORMS, PROJECTS, REGIONS, listingPrize, parseEntry } from '../shared/listings.js';
import { calendarWindow, safeTimeZone } from '../shared/time.js';
import {
  buyItem,
  equipCosmetic,
  unequipCosmetic,
  credit,
  debit,
  ensureCups,
  ensurePotw,
  freshMatch,
  matchDto,
  sparringTestMatch,
  POTW_PRIZES,
  potwLeaders,
  potwWindow,
  referralBonus,
  resolveMatch,
  settleAgreed,
  sendTip,
  purchaseAmount,
  requestWithdrawal,
  settleWithdrawals,
  startPlaying,
  userDto,
  walletSnapshot,
} from './logic.js';
import { blackjackView, dealBlackjack, doubleBlackjack, hitBlackjack, standBlackjack } from './blackjack.js';
import { SHOP, fail, load, rid, round, update } from './store.js';
import { assertCleanUsername, offensiveName } from './names.js';
import { checkoutOrigin, createCoinCheckout, handleStripeWebhook } from './checkout.js';
import { createNowInvoice, handleNowIpn } from './nowpayments.js';
import { clearPublicChat, notifyWithdrawal, sendClipReview, setChatClearedHook, setOnlineCount, setReviewSettleHook, startDiscordAdmin, syncGoldVip } from './discordAdmin.js';
import {
  consumeDiscordState,
  createDiscordState,
  discordAuthorizeUrl,
  discordAppOrigin,
  discordAvatarUrl,
  discordConfigMessage,
  discordConfigured,
  discordName,
  discordRedirectUri,
  fetchDiscordIdentity,
  discordAllowsButtonUrl,
  reviewSiteOrigins,
} from './discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const ALLOWED_ORIGINS = new Set([
  'https://ogvault.co.uk',
  'https://www.ogvault.co.uk',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    try {
      res.json(handleStripeWebhook(req.body, req.headers['stripe-signature']));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path === '/api/health' || req.path === '/api/stripe/webhook' || req.path === '/api/nowpayments/ipn') {
    next();
    return;
  }
  const status = websiteStatus(load());
  if (!status.offline) {
    next();
    return;
  }
  res.status(503).json({ error: status.reason });
});

const sockets = new Set();
const online = new Set();

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(payload, filter) {
  for (const ws of sockets) {
    if (!filter || filter(ws)) send(ws, payload);
  }
}

function pingLobby() {
  broadcast({ type: 'lobby' });
}

function pingMatch(matchId) {
  broadcast({ type: 'match', matchId });
}

function hashPw(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPw(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (prev.length !== next.length) return false;
  return crypto.timingSafeEqual(prev, next);
}

function route(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => sendRouteError(res, error));
      }
    } catch (error) {
      sendRouteError(res, error);
    }
  };
}

function sendRouteError(res, error) {
  if (res.headersSent) return;
  if (error.status) return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: 'Server error' });
}

function currentUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const state = load();
  const userId = state.sessions[token];
  if (!userId) return null;
  return state.users.find((user) => user.id === userId) || null;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) fail(401, 'Sign in first');
  return user;
}

const CLIP_BYTES = 3 * 1024 * 1024 * 1024;

function userFromToken(token) {
  if (!token) return null;
  const state = load();
  const userId = state.sessions[token];
  if (!userId) return null;
  return state.users.find((user) => user.id === userId) || null;
}

function reportsConflict(match) {
  const reports = match.reports || {};
  return match.status === 'result'
    && !!reports[match.hostId]
    && !!reports[match.guestId]
    && reports[match.hostId] !== reports[match.guestId];
}

const VOTE_LOCK_MS = 2 * 60 * 1000;

function bothClipsIn(match) {
  const clips = match.clips || {};
  return !!(match.hostId && match.guestId && clips[match.hostId] && clips[match.guestId]);
}

function sameToken(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function reviewTokens(match) {
  const review = match.review || {};
  return [review.footage, review.host, review.guest].filter(Boolean);
}

function clipAuthorized(match, reviewToken) {
  return reviewTokens(match).some((token) => sameToken(token, reviewToken));
}

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function claimName(match, host, guest, userId) {
  if (userId === host.id) return host.username;
  if (userId === guest.id) return guest.username;
  return 'unknown';
}

function clipFile(matchId, userId) {
  return path.join(__dirname, 'uploads', matchId, `${userId}.mp4`);
}

function safeClipName(name) {
  const base = path.basename(String(name || 'clip.mp4')).replace(/[^\w.\- ()]/g, '').slice(0, 80);
  return base.toLowerCase().endsWith('.mp4') ? base : 'clip.mp4';
}

function pushMatchLine(match, text) {
  match.messages = match.messages || [];
  const row = { id: rid('mc'), system: true, text, at: Date.now() };
  match.messages.push(row);
  if (match.messages.length > 80) match.messages.splice(0, match.messages.length - 80);
  return {
    matchId: match.id,
    message: { id: row.id, text: row.text, at: row.at, system: true, user: null },
    to: [match.hostId, match.guestId].filter(Boolean),
  };
}

function deliverMatchLine(delivered) {
  if (!delivered) return;
  for (const sock of sockets) {
    if (!delivered.to.includes(sock.userId)) continue;
    send(sock, { type: 'matchchat', matchId: delivered.matchId, message: delivered.message });
  }
}

function requestZone(req) {
  return safeTimeZone(req.query.tz);
}

function tickEconomy(state, timeZone) {
  const potw = ensurePotw(state, timeZone);
  const cups = ensureCups(state);
  const finished = [];
  closeFinishedMatches(state);
  const notes = settleSilentReports(state);
  finished.push(...expireListings(state));
  for (const match of state.matches) {
    if (match.status === 'live' && match.startAt && Date.now() >= match.startAt + DURATION + 1200) {
      resolveMatch(state, match);
      finished.push(match.id);
    }
  }
  return { potw, cups, finished, notes };
}

function homePayload(viewer, timeZone) {
  const state = load();
  update((draft) => {
    tickEconomy(draft, timeZone);
  });
  const fresh = load();
  const me = viewer ? fresh.users.find((user) => user.id === viewer.id) : null;
  return {
    me: me ? userDto(me, { self: true, online: true }) : null,
    stats: {
      users: fresh.users.length,
      prizes: fresh.prizes,
      duels: fresh.users.reduce((sum, user) => sum + (user.stats.matches || 0), 0),
      online: sockets.size,
    },
    potw: potwDto(fresh),
    matches: fresh.matches
      .filter((match) => match.status === 'open' && !match.invitee)
      .map((match) => matchDto(fresh, match, me?.id))
      .sort((a, b) => b.createdAt - a.createdAt),
    tournaments: fresh.tournaments.map((cup) => cupSummary(fresh, cup)),
    shop: SHOP,
  };
}

function potwDto(state) {
  const { start, endsAt } = potwWindow(state.potw);
  const leaders = potwLeaders(state, start, endsAt).flatMap((row, index) => {
    const user = state.users.find((item) => item.id === row.userId);
    if (!user) return [];
    return [{
      ...userDto(user, { online: online.has(user.id) }),
      won: row.won,
      wins: row.wins,
      reward: POTW_PRIZES[index] || 0,
    }];
  });
  return { start, endsAt, timeZone: state.potw?.timeZone || null, leaders };
}

function cupSummary(state, cup) {
  const board = [...cup.board]
    .sort((a, b) => b.points - a.points)
    .map((row, index) => {
      const user = state.users.find((item) => item.id === row.userId);
      return {
        place: row.place || index + 1,
        points: row.points,
        plays: row.plays,
        prize: row.prize || 0,
        user: user ? userDto(user, { online: online.has(user.id) }) : null,
      };
    });
  return {
    id: cup.id,
    name: cup.name,
    blurb: cup.blurb,
    entry: cup.entry,
    prize: cup.prize,
    places: Array.isArray(cup.places) ? cup.places : null,
    maxPlayers: cup.maxPlayers || 0,
    endsAt: cup.endsAt,
    paidOut: cup.paidOut,
    players: cup.board.length,
    board,
  };
}

const TERMINAL_MATCH = new Set(['done', 'completed', 'cancelled', 'expired']);
const LIVE_MATCH = new Set(['open', 'staging', 'playing', 'live', 'result', 'dispute']);

function paidOrRefunded(state, match, userId) {
  if (!userId) return false;
  return (state.txs || []).some((row) =>
    row.userId === userId
    && row.meta
    && row.meta.match === match.id
    && (row.type === 'refund' || row.type === 'win')
    && row.amount > 0
  );
}

const REPORT_WAIT_MS = 2 * 60 * 1000;

function soleReport(match) {
  const reports = match.reports || {};
  const hostVote = match.hostId ? reports[match.hostId] : null;
  const guestVote = match.guestId ? reports[match.guestId] : null;
  if (hostVote && guestVote) return null;
  return hostVote || guestVote || null;
}

function armReportDeadline(match) {
  if (!['playing', 'result'].includes(match.status)) return;
  if (match.reportDeadline) return;
  if (!soleReport(match)) return;
  match.reportDeadline = Date.now() + REPORT_WAIT_MS;
}

function settleSilentReports(state) {
  const notes = [];
  for (const match of state.matches) {
    if (!['playing', 'result'].includes(match.status)) continue;
    if (match.winnerId) continue;
    const winnerId = soleReport(match);
    if (!winnerId) continue;
    if (!match.reportDeadline) {
      match.reportDeadline = Date.now() + REPORT_WAIT_MS;
      continue;
    }
    if (Date.now() < match.reportDeadline) continue;
    settleAgreed(state, match, winnerId);
    notes.push(pushMatchLine(match, 'The report timer ran out. The first report stands.'));
  }
  return notes;
}

function reportsAgree(match) {
  const reports = match.reports || {};
  return !!(match.hostId && match.guestId
    && reports[match.hostId]
    && reports[match.guestId]
    && reports[match.hostId] === reports[match.guestId]);
}

function refundEntryOnce(state, match, userId) {
  if (!userId || match.practice || !(match.entry > 0)) return;
  if (match.winnerId || match.payout > 0) return;
  if (paidOrRefunded(state, match, userId)) return;
  const person = state.users.find((user) => user.id === userId);
  if (!person) return;
  credit(state, person, match.entry, 'refund', { match: match.id });
}

function closeFinishedMatches(state) {
  for (const match of state.matches) {
    if (TERMINAL_MATCH.has(match.status)) continue;
    if (match.winnerId || match.payout > 0) {
      match.status = 'done';
      continue;
    }
    if (!reportsAgree(match)) continue;
    const paid = (state.txs || []).some((row) => row.meta && row.meta.match === match.id && row.type === 'win' && row.amount > 0);
    if (paid) match.status = 'done';
    else settleAgreed(state, match, match.reports[match.hostId]);
  }
}

function matchInProgress(state, match) {
  if (TERMINAL_MATCH.has(match.status)) return false;
  if (match.winnerId || match.payout > 0) return false;
  if (reportsAgree(match)) return false;
  if (['open', 'staging'].includes(match.status) && match.expiresAt && Date.now() >= match.expiresAt) return false;
  return LIVE_MATCH.has(match.status);
}

function activeMatch(state, userId) {
  return state.matches.find((match) => {
    if (match.hostId !== userId && match.guestId !== userId) return false;
    return matchInProgress(state, match);
  }) || null;
}

function busy(state, userId) {
  return !!activeMatch(state, userId);
}

function expireListings(state) {
  const finished = [];
  for (const match of state.matches) {
    if (!['open', 'staging'].includes(match.status)) continue;
    const expires = match.expiresAt || 0;
    if (!expires || Date.now() < expires) continue;
    const refund = (userId) => {
      const person = state.users.find((user) => user.id === userId);
      if (!person || match.practice || match.entry <= 0) return;
      credit(state, person, match.entry, 'refund', { match: match.id });
    };
    refund(match.hostId);
    if (match.guestId) refund(match.guestId);
    match.status = 'cancelled';
    finished.push(match.id);
  }
  return finished;
}

function assertAccountOpen(user) {
  if (user && user.banUntil > Date.now()) fail(403, 'This account is banned');
}

function websiteStatus(state) {
  const backAt = Number(state.websiteBackAt) || 0;
  const offline = !!state.websiteOffline && (!backAt || backAt > Date.now());
  const reason = state.websiteReason === 'repair' ? 'Down for repair' : 'Down for maintenance';
  return { offline, reason: offline ? reason : '', until: offline ? backAt : 0 };
}

function assertMatchmakingOpen(state) {
  if ((state.matchmakingDisabledUntil || 0) > Date.now()) {
    fail(403, 'Matchmaking is turned off');
  }
}

function assertPlay(user) {
  assertAccountOpen(user);
}

app.get('/api/health', route((_req, res) => res.json({ ok: true, website: websiteStatus(load()) })));

app.get(
  '/api/home',
  route((req, res) => {
    res.json(homePayload(currentUser(req), requestZone(req)));
  })
);

app.post(
  '/api/auth/register',
  route((req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const referral = String(req.body.referral || '').trim();
    const age = !!req.body.age;
    if (!age) fail(400, 'You need to confirm you are 18 or older');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a real email');
    if (!/^[a-zA-Z0-9]{3,12}$/.test(username)) fail(400, 'Username is 3–12 letters and numbers');
    assertCleanUsername(username);
    if (password.length < 8 || password.length > 25 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      fail(400, 'Password is 8–25 characters with a letter and a number');
    }
    const result = update((state) => {
      if (state.users.some((user) => user.email === email)) fail(400, 'That email is already in the vault');
      if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
        fail(400, 'That username is taken');
      }
      const user = {
        id: rid('u'),
        username,
        npc: false,
        email,
        password: hashPw(password),
        balance: 0,
        vipUntil: 0,
        referral: username.toUpperCase(),
        avatar: 'default',
        chatIcon: 'none',
        nameColor: 'default',
        snipes: 0,
        shields: 0,
        excludedUntil: 0,
        withdrawn: 0,
        dailyClaimedAt: 0,
        createdAt: Date.now(),
        usernameHistory: [],
        friends: [],
        skill: 0,
        stats: { earned: 0, wins: 0, losses: 0, matches: 0, streak: 0, bestStreak: 0, bestScore: 0 },
      };
      state.users.push(user);
      if (referral) {
        const host = state.users.find((item) => item.referral.toLowerCase() === referral.toLowerCase() && item.id !== user.id);
        if (host) {
          const bonus = referralBonus(host);
          credit(state, user, bonus, 'referral', { from: host.username });
          credit(state, host, bonus, 'referral', { from: user.username });
        }
      }
      const token = crypto.randomBytes(24).toString('hex');
      state.sessions[token] = user.id;
      return { token, user: userDto(user, { self: true }) };
    });
    res.json(result);
  })
);

app.post(
  '/api/auth/login',
  route((req, res) => {
    const login = String(req.body.login || req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const result = update((state) => {
      const user = state.users.find(
        (item) => !item.npc && (item.email === login || item.username.toLowerCase() === login)
      );
      if (!user || !checkPw(password, user.password)) fail(401, 'Email or password is wrong');
      if (user.banUntil > Date.now()) fail(403, 'This account is banned');
      const token = crypto.randomBytes(24).toString('hex');
      state.sessions[token] = user.id;
      return { token, user: userDto(user, { self: true, online: true }) };
    });
    res.json(result);
  })
);

function vaultNameFromDiscord(state, discordUsername) {
  let base = String(discordUsername || '').replace(/[^a-zA-Z0-9]/g, '');
  if (base.length < 3) base = `${base}player`.slice(0, 12);
  base = base.slice(0, 12);
  if (offensiveName(base)) return `p${crypto.randomBytes(4).toString('hex')}`.slice(0, 12);
  let name = base;
  for (let n = 0; n < 10000; n += 1) {
    if (n > 0) {
      const suffix = String(n);
      name = `${base.slice(0, Math.max(0, 12 - suffix.length))}${suffix}`;
    }
    if (!/^[a-zA-Z0-9]{3,12}$/.test(name)) continue;
    if (offensiveName(name)) continue;
    if (!state.users.some((user) => user.username.toLowerCase() === name.toLowerCase())) return name;
  }
  return `p${crypto.randomBytes(4).toString('hex')}`.slice(0, 12);
}

function acceptDiscord(state, profile) {
  let user = state.users.find((item) => !item.npc && item.discordId === profile.id);
  let created = false;
  if (user) {
    user.discordUsername = profile.username;
    user.discordAvatar = profile.avatar;
    user.discordGlobalName = profile.globalName;
  } else {
    created = true;
    const username = vaultNameFromDiscord(state, profile.username);
    user = {
      id: rid('u'),
      username,
      npc: false,
      balance: 0,
      vipUntil: 0,
      referral: username.toUpperCase(),
      avatar: 'default',
      chatIcon: 'none',
      nameColor: 'default',
      snipes: 0,
      shields: 0,
      excludedUntil: 0,
      withdrawn: 0,
      dailyClaimedAt: 0,
      createdAt: Date.now(),
      usernameHistory: [],
      friends: [],
      skill: 0,
      stats: { earned: 0, wins: 0, losses: 0, matches: 0, streak: 0, bestStreak: 0, bestScore: 0 },
      discordId: profile.id,
      discordUsername: profile.username,
      discordAvatar: profile.avatar,
      discordGlobalName: profile.globalName,
    };
    state.users.push(user);
  }
  if (user.banUntil > Date.now()) return { banned: true };
  const token = crypto.randomBytes(24).toString('hex');
  state.sessions[token] = user.id;
  return { token, created };
}

function discordReturn(res, params) {
  const url = new URL(`${discordAppOrigin()}/`);
  url.hash = new URLSearchParams(params).toString();
  res.redirect(url.toString());
}

app.get(
  '/api/auth/discord',
  route((_req, res) => {
    const error = discordConfigMessage();
    res.json({ configured: discordConfigured(), redirectUri: discordRedirectUri(), error });
  })
);

app.get(
  '/api/auth/discord/start',
  route((req, res) => {
    const problem = discordConfigMessage();
    if (problem) {
      res.status(503).json({ error: problem });
      return;
    }
    const url = discordAuthorizeUrl(createDiscordState());
    if (!url) {
      res.status(503).json({ error: 'Discord login is not configured' });
      return;
    }
    if (String(req.headers.accept || '').includes('application/json')) {
      res.json({ url });
      return;
    }
    res.redirect(url);
  })
);

app.get(
  '/api/auth/discord/callback',
  route(async (req, res) => {
    try {
      if (!discordConfigured()) {
        discordReturn(res, { discord_error: 'Discord login is not configured' });
        return;
      }
      if (req.query.error) {
        discordReturn(res, { discord_error: 'Discord login was cancelled' });
        return;
      }
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code || !consumeDiscordState(state)) {
        discordReturn(res, { discord_error: 'Discord login expired. Try again.' });
        return;
      }
      const profile = await fetchDiscordIdentity(code);
      const result = update((draft) => acceptDiscord(draft, profile));
      const linked = load().users.find((item) => !item.npc && item.discordId === profile.id);
      if (linked) syncGoldVip(linked).catch(() => {});
      if (result.banned) {
        discordReturn(res, { discord_error: 'This account is banned' });
        return;
      }
      discordReturn(res, {
        discord_token: result.token,
        discord_new: result.created ? '1' : '0',
      });
    } catch (error) {
      console.error('Discord login failed', error.status || '');
      if (!res.headersSent) discordReturn(res, { discord_error: 'Discord login failed. Try again.' });
    }
  })
);

app.post(
  '/api/auth/logout',
  route((req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    update((state) => {
      delete state.sessions[token];
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/me',
  route((req, res) => {
    const user = requireUser(req);
    const state = load();
    const fresh = state.users.find((item) => item.id === user.id);
    const match = activeMatch(state, user.id);
    res.json({
      user: userDto(fresh, { self: true, online: true }),
      activeMatchId: match ? match.id : null,
    });
  })
);

app.post(
  '/api/me/rename',
  route((req, res) => {
    const username = String(req.body.username || '').trim();
    if (!/^[a-zA-Z0-9]{3,12}$/.test(username)) fail(400, 'Username is 3–12 letters and numbers');
    assertCleanUsername(username);
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      if (state.users.some((item) => item.username.toLowerCase() === username.toLowerCase() && item.id !== user.id)) {
        fail(400, 'That username is taken');
      }
      if (user.usernameHistory.length > 0) debit(state, user, 5, 'rename', {});
      user.usernameHistory.push({ name: user.username, at: Date.now() });
      user.username = username;
      return { user: userDto(user, { self: true, online: true }) };
    });
    res.json(result);
  })
);

app.get(
  '/api/users',
  route((req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const state = load();
    const users = state.users
      .filter((user) => !q || user.username.toLowerCase().includes(q))
      .slice(0, 8)
      .map((user) => userDto(user, { online: online.has(user.id) }));
    res.json({ users });
  })
);

function profileRevealed(viewer, user) {
  return !!(viewer && viewer.id === user.id);
}

function hiddenProfile(dto) {
  return {
    ...dto,
    stats: {
      earned: 0,
      wins: 0,
      losses: 0,
      matches: 0,
      streak: 0,
      bestStreak: 0,
      winRate: 0,
      bestScore: 0,
    },
    usernameHistory: [],
  };
}

app.get(
  '/api/users/:name',
  route((req, res) => {
    const state = load();
    const user = state.users.find((item) => item.username.toLowerCase() === String(req.params.name).toLowerCase());
    if (!user) fail(404, 'No player by that name');
    const viewer = currentUser(req);
    const revealed = profileRevealed(viewer, user);
    const recent = revealed
      ? state.history.filter((row) => row.players.some((player) => player.id === user.id)).slice(0, 12)
      : [];
    const dto = userDto(user, { self: viewer?.id === user.id, online: online.has(user.id) });
    res.json({
      user: revealed ? dto : hiddenProfile(dto),
      recent,
      revealed,
      snipes: viewer?.snipes || 0,
    });
  })
);

app.post(
  '/api/users/:name/snipe',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const viewer = state.users.find((item) => item.id === me.id);
      const user = state.users.find((item) => item.username.toLowerCase() === String(req.params.name).toLowerCase());
      if (!user) fail(404, 'No player by that name');
      if (viewer.id === user.id) fail(400, 'That is your own profile');
      if ((viewer.snipes || 0) < 1) fail(400, 'No snipes left. The shop sells a pack of five.');
      viewer.snipes -= 1;
      const recent = state.history.filter((row) => row.players.some((player) => player.id === user.id)).slice(0, 12);
      return {
        user: userDto(user, { online: online.has(user.id) }),
        recent,
        revealed: true,
        snipes: viewer.snipes,
        me: userDto(viewer, { self: true }),
      };
    });
    res.json(result);
  })
);

app.get(
  '/api/leaderboard',
  route((req, res) => {
    const period = String(req.query.period || 'all');
    const state = load();
    const now = Date.now();
    const zone = requestZone(req) || safeTimeZone(state.potw?.timeZone) || 'UTC';
    const window = calendarWindow(period, zone, now);
    let rows;
    if (!window) {
      rows = state.users
        .map((user) => ({ user: userDto(user, { online: online.has(user.id) }), value: user.stats.earned }))
        .sort((a, b) => b.value - a.value);
    } else {
      const totals = new Map();
      for (const row of state.history) {
        if (row.at < window.start || row.at >= window.endsAt || !row.winnerId || row.practice) continue;
        const profit = Math.max(0, round((row.payout || 0) - row.entry));
        totals.set(row.winnerId, round((totals.get(row.winnerId) || 0) + profit));
      }
      rows = state.users
        .map((user) => ({ user: userDto(user, { online: online.has(user.id) }), value: totals.get(user.id) || 0 }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value);
    }
    res.json({
      period,
      timeZone: zone,
      start: window ? window.start : 0,
      endsAt: window ? window.endsAt : 0,
      rows: rows.slice(0, 50),
    });
  })
);

app.get(
  '/api/potw',
  route((req, res) => {
    update((state) => ensurePotw(state, requestZone(req)));
    const state = load();
    res.json({ potw: potwDto(state) });
  })
);

app.get(
  '/api/tournaments',
  route((_req, res) => {
    update((state) => ensureCups(state));
    const state = load();
    res.json({ tournaments: state.tournaments.map((cup) => cupSummary(state, cup)) });
  })
);

app.get(
  '/api/tournaments/:id',
  route((req, res) => {
    update((state) => ensureCups(state));
    const state = load();
    const cup = state.tournaments.find((item) => item.id === req.params.id);
    if (!cup) fail(404, 'Cup not found');
    const viewer = currentUser(req);
    res.json({
      tournament: cupSummary(state, cup),
      joined: !!(viewer && cup.board.some((row) => row.userId === viewer.id)),
    });
  })
);

app.post(
  '/api/tournaments/:id/join',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      ensureCups(state);
      const user = state.users.find((item) => item.id === me.id);
      const cup = state.tournaments.find((item) => item.id === req.params.id);
      if (!cup) fail(404, 'Cup not found');
      if (cup.paidOut || Date.now() > cup.endsAt) fail(400, 'That cup is closed');
      if (cup.maxPlayers && cup.board.length >= cup.maxPlayers) fail(400, 'That cup is full');
      if (cup.board.some((row) => row.userId === user.id)) fail(400, 'You are already in');
      if (cup.entry > 0) debit(state, user, cup.entry, 'entry', { cup: cup.id });
      if (!Array.isArray(cup.places)) cup.prize = round(cup.prize + cup.entry);
      cup.board.push({ userId: user.id, points: 0, plays: 0 });
      return { tournament: cupSummary(state, cup), user: userDto(user, { self: true }) };
    });
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/tournaments/:id/leave',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      ensureCups(state);
      const user = state.users.find((item) => item.id === me.id);
      const cup = state.tournaments.find((item) => item.id === req.params.id);
      if (!cup) fail(404, 'Cup not found');
      if (cup.paidOut || Date.now() > cup.endsAt) fail(400, 'That cup is closed');
      const row = cup.board.find((item) => item.userId === user.id);
      if (!row) fail(400, 'You are not in this cup');
      if (cup.entry > 0) {
        const paid = (state.txs || []).find((tx) => tx.userId === user.id && tx.type === 'entry' && tx.meta?.cup === cup.id && tx.amount < 0);
        const refunded = (state.txs || []).find((tx) => tx.userId === user.id && tx.type === 'refund' && tx.meta?.cup === cup.id && tx.amount > 0);
        if (paid && (!refunded || refunded.at < paid.at)) {
          credit(state, user, cup.entry, 'refund', { cup: cup.id });
          if (!Array.isArray(cup.places)) cup.prize = round(Math.max(0, cup.prize - cup.entry));
        }
      }
      cup.board = cup.board.filter((item) => item.userId !== user.id);
      return { tournament: cupSummary(state, cup), user: userDto(user, { self: true }) };
    });
    pingLobby();
    res.json(result);
  })
);

app.get(
  '/api/matches',
  route((req, res) => {
    const viewer = currentUser(req);
    const state = load();
    const matches = state.matches
      .filter((match) => ['open', 'staging', 'live'].includes(match.status))
      .filter((match) => !match.invitee || match.hostId === viewer?.id || match.invitee === viewer?.username)
      .map((match) => matchDto(state, match, viewer?.id))
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ matches });
  })
);

app.get(
  '/api/matches/:id',
  route((req, res) => {
    const changed = update((state) => {
      const tick = tickEconomy(state);
      const match = state.matches.find((item) => item.id === req.params.id);
      if (match && bothClipsIn(match) && !(match.voteUnlockAt > 0 && match.voteUnlockAt <= Date.now())) {
        match.voteUnlockAt = Date.now();
      }
      return { finished: tick.finished, notes: tick.notes || [] };
    });
    const state = load();
    const match = state.matches.find((item) => item.id === req.params.id);
    if (!match) fail(404, 'Match not found');
    const viewer = currentUser(req);
    for (const note of changed.notes) {
      deliverMatchLine(note);
      pingMatch(note.matchId);
    }
    if (changed.finished.length || changed.notes.length) pingLobby();
    res.json({ match: matchDto(state, match, viewer?.id) });
  })
);

app.post(
  '/api/matches',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const practice = !!req.body.practice;
    const entry = practice ? 0 : parseEntry(req.body.entry);
    const project = PROJECTS.includes(req.body.project) ? req.body.project : 'Eon';
    if (!MODES.includes(req.body.mode)) fail(400, 'Mode must be Kill Race');
    if (!REGIONS.includes(req.body.region)) fail(400, 'Region must be EU or NA');
    const mode = req.body.mode;
    const region = req.body.region;
    const platform = PLATFORMS.includes(req.body.platform) ? req.body.platform : 'PC';
    const firstTo = 1;
    if (!practice && entry == null) fail(400, 'Entry must be at least 1 token');
    const result = update((state) => {
      assertMatchmakingOpen(state);
      const user = state.users.find((item) => item.id === me.id);
      assertAccountOpen(user);
      if (busy(state, user.id)) fail(400, 'Finish your open Kill Race before joining another');
      const openCount = state.matches.filter(
        (match) =>
          match.hostId === user.id && ['open', 'staging', 'live', 'playing', 'result'].includes(match.status)
      ).length;
      if (openCount >= 3) fail(400, 'You already have three tables open');
      if (practice) fail(400, 'Open a real listing');
      debit(state, user, entry, 'entry', {});
      const match = freshMatch({ host: user, entry, project, mode, region, platform, firstTo });
      state.matches.unshift(match);
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/matches/quick',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      assertMatchmakingOpen(state);
      const user = state.users.find((item) => item.id === me.id);
      assertAccountOpen(user);
      if (busy(state, user.id)) fail(400, 'Finish your open Kill Race before joining another');
      const table = state.matches.find(
        (match) =>
          match.status === 'open' &&
          !match.invitee &&
          match.hostId !== user.id &&
          match.entry <= user.balance &&
          match.entry > 0
      );
      if (table) {
        return joinMatch(state, table, user);
      }
      if (user.balance >= 1) {
        debit(state, user, 1, 'entry', {});
        const match = freshMatch({ host: user, entry: 1, mode: MODES[0], region: 'EU', firstTo: 1 });
        state.matches.unshift(match);
        return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
      }
      fail(400, 'No open listing you can afford');
    });
    pingLobby();
    res.json(result);
  })
);

function joinMatch(state, match, user) {
  if (match.status !== 'open') fail(400, 'That table is no longer open');
  if (match.hostId === user.id) fail(400, 'That is your table');
  if (match.invitee && match.invitee.toLowerCase() !== user.username.toLowerCase()) {
    fail(403, 'This table is a direct challenge');
  }
  if (!match.practice && match.entry > 0) debit(state, user, match.entry, 'entry', { match: match.id });
  match.guestId = user.id;
  match.status = 'staging';
  match.guestReady = false;
  match.hostReady = false;
  const host = state.users.find((item) => item.id === match.hostId);
  if (host?.sparring) match.hostReady = true;
  return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
}

const SPARRING_NAME = 'sparring';
const SPARRING_ENTRY = 1;

function ensureSparringListing(state) {
  let user = state.users.find((item) => item.username.toLowerCase() === SPARRING_NAME);
  if (!user) {
    user = {
      id: rid('u'),
      username: SPARRING_NAME,
      npc: false,
      sparring: true,
      email: 'sparring@ogvault.test',
      password: hashPw('sparring1'),
      balance: 25,
      vipUntil: 0,
      referral: 'SPARRING',
      avatar: 'default',
      chatIcon: 'none',
      nameColor: 'default',
      snipes: 0,
      shields: 0,
      excludedUntil: 0,
      withdrawn: 0,
      dailyClaimedAt: 0,
      createdAt: Date.now(),
      usernameHistory: [],
      friends: [],
      skill: 0,
      stats: { earned: 0, wins: 0, losses: 0, matches: 0, streak: 0, bestStreak: 0, bestScore: 0 },
    };
    state.users.push(user);
  } else if (!user.sparring) {
    user.sparring = true;
  }
  const open = state.matches.find(
    (match) => match.hostId === user.id && match.status === 'open' && !match.invitee
  );
  if (open) {
    open.expiresAt = Date.now() + LISTING_MS;
    return;
  }
  const occupied = state.matches.some((match) =>
    (match.hostId === user.id || match.guestId === user.id) && matchInProgress(state, match)
  );
  if (occupied) return;
  if (user.balance < SPARRING_ENTRY) credit(state, user, 25, 'adjust', { note: 'sparring' });
  const match = freshMatch({
    host: user,
    entry: SPARRING_ENTRY,
    project: 'Eon',
    mode: MODES[0],
    region: 'EU',
    platform: PLATFORMS[0],
    firstTo: 1,
  });
  debit(state, user, SPARRING_ENTRY, 'entry', { match: match.id });
  state.matches.unshift(match);
}

function releaseSupersededSparring(state) {
  const bot = state.users.find(
    (item) => item.sparring || item.username.toLowerCase() === SPARRING_NAME
  );
  if (!bot) return;
  const hasOpen = state.matches.some(
    (match) => match.hostId === bot.id && match.status === 'open' && !match.invitee && !match.guestId
  );
  if (!hasOpen) return;
  for (const match of state.matches) {
    if (match.hostId !== bot.id && match.guestId !== bot.id) continue;
    if (match.status === 'open' && !match.guestId) continue;
    if (match.winnerId || match.payout > 0 || reportsAgree(match)) {
      if (!TERMINAL_MATCH.has(match.status)) match.status = 'done';
      continue;
    }
    if (match.status !== 'staging') continue;
    refundEntryOnce(state, match, match.hostId);
    refundEntryOnce(state, match, match.guestId);
    match.status = 'cancelled';
    match.hostReady = false;
    match.guestReady = false;
  }
}

function sparringCastWin(state) {
  const bot = state.users.find(
    (item) => item.sparring || item.username.toLowerCase() === SPARRING_NAME
  );
  if (!bot) return [];
  const notes = [];
  for (const match of state.matches) {
    if (!['playing', 'result'].includes(match.status)) continue;
    if (match.hostId !== bot.id && match.guestId !== bot.id) continue;
    if (!match.hostId || !match.guestId) continue;
    match.reports = match.reports || {};
    if (match.reports[bot.id]) continue;
    const host = state.users.find((item) => item.id === match.hostId);
    const guest = state.users.find((item) => item.id === match.guestId);
    if (!host || !guest) continue;
    match.reports[bot.id] = bot.id;
    if (match.reports[host.id] && match.reports[guest.id]) {
      if (match.reports[host.id] === match.reports[guest.id]) settleAgreed(state, match, match.reports[host.id]);
      else match.status = 'result';
    } else {
      match.status = 'result';
      armReportDeadline(match);
    }
    notes.push(pushMatchLine(match, `${bot.username} reported they won`));
  }
  return notes;
}

app.post(
  '/api/matches/:id/join',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      assertMatchmakingOpen(state);
      const user = state.users.find((item) => item.id === me.id);
      assertAccountOpen(user);
      if (busy(state, user.id)) fail(400, 'Finish your open Kill Race before joining another');
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) fail(404, 'Match not found');
      return joinMatch(state, match, user);
    });
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/matches/:id/ready',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) fail(404, 'Match not found');
      if (match.status !== 'staging') fail(400, 'The table is not waiting on a ready check');
      if (match.hostId === user.id) match.hostReady = true;
      else if (match.guestId === user.id) match.guestReady = true;
      else fail(403, 'You are not in this match');
      if (match.hostReady && match.guestReady && match.guestId) startPlaying(match);
      return { match: matchDto(state, match, user.id) };
    });
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/matches/:id/leave',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) fail(404, 'Match not found');
      if (['live', 'playing', 'result'].includes(match.status)) fail(400, 'The Kill Race is in progress. Report the result or forfeit.');
      if (match.status === 'done' || match.status === 'cancelled') return { match: matchDto(state, match, user.id) };
      if (match.practice) {
        match.status = 'cancelled';
        return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
      }
      const refund = (person) => {
        if (!person || match.practice || match.entry <= 0) return;
        credit(state, person, match.entry, 'refund', { match: match.id });
      };
      if (match.status === 'open' && match.hostId === user.id) {
        refund(user);
        match.status = 'cancelled';
      } else if (match.guestId === user.id) {
        refund(user);
        match.guestId = null;
        match.guestReady = false;
        match.status = 'open';
        match.bot = null;
      } else if (match.hostId === user.id) {
        const guest = state.users.find((item) => item.id === match.guestId);
        refund(user);
        refund(guest);
        match.status = 'cancelled';
      } else fail(403, 'You are not in this match');
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/matches/:id/forfeit',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) fail(404, 'Match not found');
      if (!['staging', 'live', 'playing', 'result', 'dispute'].includes(match.status)) fail(400, 'This Kill Race is not in progress');
      if (match.hostId !== user.id && match.guestId !== user.id) fail(403, 'You are not in this match');
      if (match.status === 'live') resolveMatch(state, match, { forfeitId: user.id });
      else {
        const winnerId = match.hostId === user.id ? match.guestId : match.hostId;
        settleAgreed(state, match, winnerId, { forfeitId: user.id });
      }
      const note = pushMatchLine(match, `${user.username} forfeited`);
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }), note };
    });
    deliverMatchLine(result.note);
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/matches/:id/report',
  route((req, res) => {
    const me = requireUser(req);
    const winnerId = String(req.body.winnerId || '');
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) fail(404, 'Match not found');
      if (!['playing', 'result'].includes(match.status)) fail(400, 'Ready up and play before reporting a winner');
      if (match.hostId !== user.id && match.guestId !== user.id) fail(403, 'You are not in this match');
      const host = state.users.find((item) => item.id === match.hostId);
      const guest = state.users.find((item) => item.id === match.guestId);
      if (!host || !guest) fail(400, 'Both players need to be in the lobby');
      if (winnerId !== host.id && winnerId !== guest.id) fail(400, 'Pick a player in this lobby');
      match.reports = match.reports || {};
      const unlockAt = match.voteUnlockAt || 0;
      const votesOpen = unlockAt > 0 && Date.now() >= unlockAt;
      if (match.reports[user.id] && !votesOpen) fail(400, 'Your report is locked');
      match.reports[user.id] = winnerId;
      if (votesOpen) {
        match.revotes = match.revotes || {};
        match.revotes[user.id] = winnerId;
      }
      if (match.reports[host.id] && match.reports[guest.id]) {
        if (match.reports[host.id] === match.reports[guest.id]) settleAgreed(state, match, match.reports[host.id]);
        else match.status = 'result';
      } else {
        match.status = 'result';
        armReportDeadline(match);
      }
      const named = winnerId === user.id ? null : (winnerId === host.id ? host : guest);
      const line = named
        ? `${user.username} reported ${named.username} won`
        : `${user.username} reported they won`;
      const note = pushMatchLine(match, line);
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }), note };
    });
    deliverMatchLine(result.note);
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
  })
);

app.post('/api/matches/:id/clip', (req, res) => {
  let me;
  try {
    me = requireUser(req);
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('multipart/form-data')) fail(400, 'Upload an MP4');
    const state = load();
    const match = state.matches.find((item) => item.id === req.params.id);
    if (!match) fail(404, 'Match not found');
    if (match.hostId !== me.id && match.guestId !== me.id) fail(403, 'You are not in this match');
    if (!reportsConflict(match)) fail(400, 'Both players have to disagree on the winner before uploading');
  } catch (error) {
    return sendRouteError(res, error);
  }

  const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: CLIP_BYTES } });
  let rejected = '';
  let saved = null;
  const tmp = `${clipFile(req.params.id, me.id)}.part`;

  bb.on('file', (_name, stream, info) => {
    const mime = String(info.mimeType || '');
    const filename = String(info.filename || '');
    if (mime !== 'video/mp4' || !filename.toLowerCase().endsWith('.mp4')) {
      rejected = 'MP4 only';
      stream.resume();
      return;
    }
    if (saved) {
      stream.resume();
      return;
    }
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const out = fs.createWriteStream(tmp);
    stream.pipe(out);
    saved = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (truncated) => {
        if (settled) return;
        settled = true;
        resolve({ filename, truncated });
      };
      stream.on('limit', () => {
        rejected = 'MP4, up to 3GB';
        out.destroy();
        stream.resume();
        finish(true);
      });
      out.on('finish', () => finish(!!stream.truncated));
      out.on('error', reject);
      stream.on('error', reject);
    });
  });

  bb.on('error', (error) => sendRouteError(res, error));
  bb.on('close', async () => {
    try {
      if (rejected) {
        fs.rmSync(tmp, { force: true });
        const tooBig = rejected.includes('3GB');
        fail(tooBig ? 413 : 400, rejected);
      }
      if (!saved) fail(400, 'Choose an MP4');
      const file = await saved;
      if (file.truncated) {
        fs.rmSync(tmp, { force: true });
        fail(413, 'MP4, up to 3GB');
      }
      const dest = clipFile(req.params.id, me.id);
      fs.rmSync(dest, { force: true });
      fs.renameSync(tmp, dest);
      const size = fs.statSync(dest).size;
      const result = update((state) => {
        const user = state.users.find((item) => item.id === me.id);
        const match = state.matches.find((item) => item.id === req.params.id);
        if (!match || !user) fail(404, 'Match not found');
        if (match.hostId !== user.id && match.guestId !== user.id) fail(403, 'You are not in this match');
        if (!reportsConflict(match)) fail(400, 'Both players have to disagree on the winner before uploading');
        match.clips = match.clips || {};
        match.clips[user.id] = { name: safeClipName(file.filename), size, at: Date.now() };
        if (bothClipsIn(match)) {
          match.voteUnlockAt = Date.now();
          match.revotes = {};
        }
        return { match: matchDto(state, match, user.id) };
      });
      pingMatch(req.params.id);
      res.json(result);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      sendRouteError(res, error);
    }
  });
  req.pipe(bb);
});

app.get(
  '/api/matches/:id/clip/:side',
  route((req, res) => {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = userFromToken(bearer || String(req.query.token || ''));
    const side = req.params.side;
    if (side !== 'host' && side !== 'guest') fail(404, 'Clip not found');
    const state = load();
    const match = state.matches.find((item) => item.id === req.params.id);
    if (!match) fail(404, 'Match not found');
    const reviewOk = clipAuthorized(match, String(req.query.review || ''));
    if (!reviewOk) {
      if (!user) fail(401, 'Sign in first');
      if (match.hostId !== user.id && match.guestId !== user.id) fail(403, 'You are not in this match');
    }
    const ownerId = side === 'host' ? match.hostId : match.guestId;
    const clip = match.clips && match.clips[ownerId];
    const file = clipFile(match.id, ownerId);
    if (!clip || !fs.existsSync(file)) fail(404, 'No clip yet');
    const filename = safeClipName(clip.name).replace(/"/g, '');
    sendVideo(req, res, file, filename);
  })
);

function sendVideo(req, res, file, filename) {
  const size = fs.statSync(file).size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  const range = String(req.headers.range || '');
  if (!range) {
    res.setHeader('Content-Length', size);
    fs.createReadStream(file).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    return;
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    return;
  }
  end = Math.min(end, size - 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(file, { start, end }).pipe(res);
}

const reviewSending = new Set();

app.post(
  '/api/matches/:id/review',
  route(async (req, res) => {
    const me = requireUser(req);
    if (reviewSending.has(req.params.id)) fail(400, 'Sending for review');
    const preview = load();
    const match = preview.matches.find((item) => item.id === req.params.id);
    if (!match) fail(404, 'Match not found');
    if (match.hostId !== me.id && match.guestId !== me.id) fail(403, 'You are not in this match');
    const host = preview.users.find((item) => item.id === match.hostId);
    const guest = preview.users.find((item) => item.id === match.guestId);
    if (!host || !guest) fail(400, 'Both players need to be in the lobby');
    const testSparring = sparringTestMatch(host, guest);
    if (!testSparring && (host.npc || guest.npc)) fail(400, 'Sparring matches are not sent for review');
    if (match.status !== 'result' || !reportsConflict(match)) fail(400, 'You already agree on the winner');
    if (match.review && match.review.sent) fail(400, 'Already sent for review');
    const tokens = {
      host: crypto.randomBytes(24).toString('hex'),
      guest: crypto.randomBytes(24).toString('hex'),
      footage: crypto.randomBytes(24).toString('hex'),
    };
    const origins = reviewSiteOrigins();
    const origin = origins.find((item) => discordAllowsButtonUrl(item)) || origins[0];
    const md = (value) => String(value || '').replace(/[\u0000-\u001f[\]()]/g, '').trim().slice(0, 80);
    const linkButton = (label, url) => ({
      type: 2,
      style: 5,
      label: String(label).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Open',
      url,
    });
    const clips = [];
    if (match.clips?.[host.id] && fs.existsSync(clipFile(match.id, host.id))) {
      clips.push({ label: 'Host clip', url: `${origin}/api/matches/${match.id}/clip/host?review=${tokens.footage}` });
    }
    if (match.clips?.[guest.id] && fs.existsSync(clipFile(match.id, guest.id))) {
      clips.push({ label: 'Guest clip', url: `${origin}/api/matches/${match.id}/clip/guest?review=${tokens.footage}` });
    }
    const awardLabel = (name) => {
      const clean = md(name) || 'player';
      return `Award ${clean}`.slice(0, 80);
    };
    const components = [{
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `ogreview:host:${match.id}`, label: awardLabel(host.username) },
        { type: 2, style: 4, custom_id: `ogreview:guest:${match.id}`, label: awardLabel(guest.username) },
      ],
    }];
    const clipButtons = clips.filter((item) => discordAllowsButtonUrl(item.url));
    const clipLines = clips
      .filter((item) => !discordAllowsButtonUrl(item.url))
      .map((item) => `[${md(item.label) || 'Clip'}](${item.url})`);
    if (clipButtons.length) {
      components.push({ type: 1, components: clipButtons.map((item) => linkButton(item.label, item.url)) });
    }
    const hostClaim = claimName(match, host, guest, (match.reports || {})[host.id]);
    const guestClaim = claimName(match, host, guest, (match.reports || {})[guest.id]);
    const description = [
      'Both players claimed the win. Watch the clips, then award it once.',
      ...clipLines,
    ].join('\n').slice(0, 4096);
    const field = (name, value) => ({ name, value: md(value) || '—', inline: true });
    reviewSending.add(match.id);
    try {
      await sendClipReview({
        embeds: [{
          title: 'Clip dispute',
          color: 0x2f6bff,
          description,
          fields: [
            field('Match', match.id),
            field('Project', match.project || 'Eon'),
            field('Region', match.region || 'EU'),
            field('Host', host.username),
            field('Host claimed', hostClaim),
            field('Entry', String(match.entry)),
            field('Guest', guest.username),
            field('Guest claimed', guestClaim),
            field('Prize', String(listingPrize(match.entry))),
          ],
          footer: { text: 'Green awards the host. Red awards the guest. Each award works once.' },
        }],
        components,
      });
      const result = update((state) => {
        const user = state.users.find((item) => item.id === me.id);
        const row = state.matches.find((item) => item.id === req.params.id);
        if (!row || !user) fail(404, 'Match not found');
        if (row.review && row.review.sent) return { match: matchDto(state, row, user.id), user: userDto(user, { self: true }) };
        row.review = { sent: true, host: tokens.host, guest: tokens.guest, footage: tokens.footage };
        const note = pushMatchLine(row, 'Sent for review');
        return { match: matchDto(state, row, user.id), user: userDto(user, { self: true }), note };
      });
      deliverMatchLine(result.note);
      pingMatch(req.params.id);
      res.json(result);
    } finally {
      reviewSending.delete(match.id);
    }
  })
);

function reviewSide(match, token) {
  const review = match.review || {};
  if (sameToken(token, review.host)) return 'host';
  if (sameToken(token, review.guest)) return 'guest';
  return '';
}

function reviewHtml(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title></head><body style="font-family:sans-serif;background:#0e1116;color:#e8eef8;padding:32px"><h1>${htmlEscape(title)}</h1>${body}</body></html>`;
}

app.get(
  '/api/matches/:id/review/:token',
  route((req, res) => {
    const state = load();
    const match = state.matches.find((item) => item.id === req.params.id);
    if (!match) {
      res.status(404).type('html').send(reviewHtml('Review link', '<p>This review link has already been used or is not valid.</p>'));
      return;
    }
    const host = state.users.find((item) => item.id === match.hostId);
    const guest = state.users.find((item) => item.id === match.guestId);
    const side = reviewSide(match, req.params.token);
    if (!side || !host || !guest) {
      res.status(404).type('html').send(reviewHtml('Review link', '<p>This review link has already been used or is not valid.</p>'));
      return;
    }
    if (match.status === 'done') {
      const winner = match.winnerId === host.id ? host.username : guest.username;
      res.type('html').send(reviewHtml('Match settled', `<p>This match is already settled. ${htmlEscape(winner)} took the prize.</p>`));
      return;
    }
    const name = side === 'host' ? host.username : guest.username;
    res.type('html').send(reviewHtml(
      'Award the win',
      `<p>Match ${htmlEscape(match.id)}. This awards the win to ${htmlEscape(name)}. The pot pays minus 20%.</p><form method="post"><button type="submit">Award the win to ${htmlEscape(name)}</button></form>`
    ));
  })
);

app.post(
  '/api/matches/:id/review/:token',
  route((req, res) => {
    let page = reviewHtml('Review link', '<p>This review link has already been used or is not valid.</p>');
    let status = 404;
    update((state) => {
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) return;
      const host = state.users.find((item) => item.id === match.hostId);
      const guest = state.users.find((item) => item.id === match.guestId);
      const side = reviewSide(match, req.params.token);
      if (!side || !host || !guest) return;
      if (match.status === 'done') {
        status = 200;
        const winner = match.winnerId === host.id ? host.username : guest.username;
        page = reviewHtml('Match settled', `<p>This match is already settled. ${htmlEscape(winner)} took the prize.</p>`);
        return;
      }
      const winnerId = side === 'host' ? host.id : guest.id;
      settleAgreed(state, match, winnerId);
      if (match.review) {
        match.review.host = '';
        match.review.guest = '';
      }
      status = 200;
      page = 'redirect';
    });
    pingMatch(req.params.id);
    pingLobby();
    if (page === 'redirect') {
      res.redirect(303, `${discordAppOrigin()}/play`);
      return;
    }
    res.status(status).type('html').send(page);
  })
);

app.post(
  '/api/matches/:id/snipe',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const match = state.matches.find((item) => item.id === req.params.id);
      if (!match) fail(404, 'Match not found');
      if (match.hostId !== user.id && match.guestId !== user.id) fail(403, 'You are not in this match');
      if (!match.sniped) match.sniped = {};
      const opponentId = match.hostId === user.id ? match.guestId : match.hostId;
      if (!opponentId) fail(400, 'Wait for an opponent before you snipe');
      if (!['open', 'staging'].includes(match.status)) fail(400, 'Snipe before the match starts');
      const youReady = match.hostId === user.id ? match.hostReady : match.guestReady;
      if (youReady && !match.sniped[user.id]) fail(400, 'Snipe before you ready up');
      if (match.sniped[user.id]) return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
      if ((user.snipes || 0) < 1) fail(400, 'No snipes left. The shop sells a pack of five.');
      user.snipes -= 1;
      match.sniped[user.id] = true;
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
    res.json(result);
  })
);

app.post(
  '/api/matches/:id/rematch',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      assertMatchmakingOpen(state);
      const user = state.users.find((item) => item.id === me.id);
      assertAccountOpen(user);
      const prev = state.matches.find((item) => item.id === req.params.id);
      if (!prev || prev.status !== 'done') fail(400, 'Rematch from a finished Kill Race');
      if (prev.hostId !== user.id && prev.guestId !== user.id) fail(403, 'You were not in that match');
      if (busy(state, user.id)) fail(400, 'Finish your open Kill Race before joining another');
      const otherId = prev.hostId === user.id ? prev.guestId : prev.hostId;
      const other = state.users.find((item) => item.id === otherId);
      if (!other) fail(400, 'That player is no longer on the server');
      if (prev.rematchId) {
        const next = state.matches.find((item) => item.id === prev.rematchId);
        if (next) return { match: matchDto(state, next, user.id), user: userDto(user, { self: true }) };
      }
      const ask = prev.rematchAsk;
      if (!ask || ask.fromId === user.id) {
        if (user.balance < prev.entry) fail(400, 'Not enough tokens for the same entry');
        prev.rematchAsk = { fromId: user.id, at: Date.now() };
        const note = pushMatchLine(prev, `${user.username} wants a rematch`);
        return { match: matchDto(state, prev, user.id), user: userDto(user, { self: true }), note };
      }
      if (ask.fromId !== otherId) fail(400, 'That rematch request is no longer open');
      if (user.balance < prev.entry) fail(400, 'Not enough tokens for the same entry');
      if (other.balance < prev.entry) fail(400, `${other.username} does not have enough tokens`);
      if (busy(state, user.id) || busy(state, other.id)) fail(400, 'Finish your open Kill Race before joining another');
      debit(state, other, prev.entry, 'entry', {});
      const match = freshMatch({
        host: other,
        entry: prev.entry,
        project: prev.project,
        mode: prev.mode,
        region: prev.region,
        platform: prev.platform,
        firstTo: prev.firstTo,
      });
      state.matches.unshift(match);
      joinMatch(state, match, user);
      prev.rematchId = match.id;
      prev.rematchAsk = null;
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
  })
);

app.post(
  '/api/matches/:id/rematch/decline',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const prev = state.matches.find((item) => item.id === req.params.id);
      if (!prev || prev.status !== 'done') fail(400, 'That match is finished');
      if (prev.hostId !== user.id && prev.guestId !== user.id) fail(403, 'You were not in that match');
      if (!prev.rematchAsk || prev.rematchAsk.fromId === user.id) fail(400, 'There is no rematch request to decline');
      prev.rematchAsk = null;
      const note = pushMatchLine(prev, `${user.username} declined the rematch`);
      return { match: matchDto(state, prev, user.id), user: userDto(user, { self: true }), note };
    });
    pingMatch(req.params.id);
    res.json(result);
  })
);

app.get(
  '/api/wallet',
  route((req, res) => {
    const me = requireUser(req);
    const state = load();
    const due = (state.withdrawals || []).some((row) => row.status === 'pending' && row.readyAt <= Date.now());
    const view = (current) => {
      settleWithdrawals(current);
      const user = current.users.find((item) => item.id === me.id);
      if (!user) fail(401, 'Sign in again');
      return walletSnapshot(current, user);
    };
    res.json(due ? update(view) : view(state));
  })
);

app.post(
  '/api/wallet/checkout',
  route(async (req, res) => {
    const me = requireUser(req);
    const state = load();
    const user = state.users.find((item) => item.id === me.id);
    if (!user) fail(401, 'Sign in again');
    const amount = purchaseAmount(req.body?.amount);
    const origin = checkoutOrigin(req);
    const session = req.body?.method === 'crypto'
      ? await createNowInvoice({ user, amount, origin })
      : await createCoinCheckout({ user, amount, origin });
    res.json(session);
  })
);

app.post(
  '/api/nowpayments/ipn',
  route(async (req, res) => {
    res.json(await handleNowIpn(req.body || {}, req.get('x-nowpayments-sig')));
  })
);

app.post(
  '/api/wallet/withdraw',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const withdrawal = requestWithdrawal(state, user, req.body || {});
      return { ...walletSnapshot(state, user), withdrawal: { ...withdrawal, destination: withdrawal.destination } };
    });
    const row = result.withdrawal;
    notifyWithdrawal({
      username: result.user?.username,
      method: row.method,
      amount: row.amount,
      fee: row.fee,
      payout: row.payout,
      destination: row.destination,
    }).catch(() => {});
    res.json(result);
  })
);

app.post(
  '/api/wallet/tip',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const tip = sendTip(state, user, req.body.amount, req.body.username);
      return { ...walletSnapshot(state, user), tip };
    });
    res.json(result);
  })
);

app.get(
  '/api/blackjack',
  route((req, res) => {
    const me = requireUser(req);
    const state = load();
    const user = state.users.find((item) => item.id === me.id);
    res.json(blackjackView(user));
  })
);

app.post(
  '/api/blackjack/deal',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      return dealBlackjack(state, user, req.body.bet);
    });
    res.json(result);
  })
);

app.post(
  '/api/blackjack/hit',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      return hitBlackjack(state, user);
    });
    res.json(result);
  })
);

app.post(
  '/api/blackjack/stand',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      return standBlackjack(state, user);
    });
    res.json(result);
  })
);

app.post(
  '/api/blackjack/double',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      return doubleBlackjack(state, user);
    });
    res.json(result);
  })
);

app.get(
  '/api/shop',
  route((_req, res) => res.json({ shop: SHOP }))
);

app.post(
  '/api/shop/buy',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const item = buyItem(state, user, String(req.body.itemId || ''));
      return { item, user: userDto(user, { self: true }), discordId: user.discordId, vipUntil: user.vipUntil };
    });
    if (result.item?.id === 'vip') {
      syncGoldVip({ discordId: result.discordId, vipUntil: result.vipUntil }).catch(() => {});
    }
    res.json({ item: result.item, user: result.user });
  })
);

app.post(
  '/api/shop/equip',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      equipCosmetic(user, String(req.body.slot || ''), String(req.body.id || ''));
      return { user: userDto(user, { self: true }) };
    });
    res.json(result);
  })
);

app.post(
  '/api/shop/unequip',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      unequipCosmetic(user, String(req.body.slot || ''));
      return { user: userDto(user, { self: true }) };
    });
    res.json(result);
  })
);

app.post(
  '/api/rewards/daily',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const wait = 20 * 3600000;
      if (user.dailyClaimedAt && Date.now() - user.dailyClaimedAt < wait) {
        fail(400, 'Daily is still cooling down');
      }
      const amount = 0.1;
      credit(state, user, amount, 'daily', {});
      user.dailyClaimedAt = Date.now();
      return { user: userDto(user, { self: true }), amount };
    });
    res.json(result);
  })
);

app.get(
  '/api/chat',
  route((_req, res) => {
    const state = load();
    res.json({ messages: state.chat.slice(-80).map((message) => chatDto(state, message)) });
  })
);

function chatDto(state, message) {
  const user = state.users.find((item) => item.id === message.userId);
  return {
    id: message.id,
    text: message.text,
    at: message.at,
    user: user ? userDto(user, { online: online.has(user.id) }) : null,
  };
}

app.get(
  '/api/dms',
  route((req, res) => {
    const me = requireUser(req);
    const state = load();
    const rows = state.dms
      .filter((row) => row.fromId === me.id || row.toId === me.id)
      .slice(-200)
      .map((row) => dmDto(state, row));
    res.json({ messages: rows });
  })
);

function dmDto(state, row) {
  const from = state.users.find((item) => item.id === row.fromId);
  const to = state.users.find((item) => item.id === row.toId);
  return {
    id: row.id,
    text: row.text,
    at: row.at,
    read: row.read,
    from: from ? userDto(from) : null,
    to: to ? userDto(to) : null,
  };
}

app.post(
  '/api/dms/read',
  route((req, res) => {
    const me = requireUser(req);
    const username = String(req.body.username || '');
    update((state) => {
      const other = state.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
      if (!other) return;
      for (const row of state.dms) {
        if (row.toId === me.id && row.fromId === other.id) row.read = true;
      }
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/friends',
  route((req, res) => {
    const me = requireUser(req);
    const state = load();
    const user = state.users.find((item) => item.id === me.id);
    const friends = user.friends
      .map((id) => state.users.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => userDto(item, { online: online.has(item.id) }));
    res.json({ friends });
  })
);

app.post(
  '/api/friends',
  route((req, res) => {
    const me = requireUser(req);
    const username = String(req.body.username || '').trim();
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const other = state.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
      if (!other) fail(404, 'No player by that name');
      if (other.id === user.id) fail(400, 'You are already with you');
      if (!user.friends.includes(other.id)) user.friends.push(other.id);
      if (!other.friends.includes(user.id)) other.friends.push(user.id);
      return { friends: user.friends.map((id) => userDto(state.users.find((item) => item.id === id), { online: online.has(id) })) };
    });
    res.json(result);
  })
);

app.delete(
  '/api/friends/:name',
  route((req, res) => {
    const me = requireUser(req);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      const other = state.users.find((item) => item.username.toLowerCase() === String(req.params.name).toLowerCase());
      if (!other) fail(404, 'No player by that name');
      user.friends = user.friends.filter((id) => id !== other.id);
      other.friends = (other.friends || []).filter((id) => id !== user.id);
      return { ok: true };
    });
    res.json(result);
  })
);

app.post(
  '/api/reports',
  route((req, res) => {
    const me = requireUser(req);
    const text = String(req.body.text || '').trim().slice(0, 280);
    const target = String(req.body.target || '').trim().slice(0, 24);
    if (text.length < 4) fail(400, 'Tell us what happened');
    update((state) => {
      state.reports.unshift({ id: rid('r'), userId: me.id, target, text, at: Date.now() });
      if (state.reports.length > 100) state.reports.length = 100;
    });
    res.json({ ok: true });
  })
);

const dist = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin }) => !origin || ALLOWED_ORIGINS.has(origin),
});

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.userId = null;
  ws.lastChat = 0;
  ws.whiffs = [];
  send(ws, { type: 'hello' });
  pingLobby();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      const state = load();
      const userId = msg.token ? state.sessions[msg.token] : null;
      if (ws.userId) online.delete(ws.userId);
      ws.userId = userId || null;
      if (ws.userId) online.add(ws.userId);
      return;
    }
    if (msg.type === 'chat') {
      if (!ws.userId) return send(ws, { type: 'error', error: 'Sign in to talk' });
      const text = String(msg.text || '').trim().slice(0, 180);
      if (!text) return;
      if (text === '/clear') {
        const state = load();
        const user = state.users.find((item) => item.id === ws.userId);
        const admins = String(process.env.DISCORD_ADMIN_IDS || '').split(/[,\s]+/).map((id) => id.trim()).filter(Boolean);
        if (!user || !admins.includes(String(user.discordId || ''))) {
          return send(ws, { type: 'error', error: 'You cannot clear the chat' });
        }
        clearPublicChat();
        return;
      }
      const now = Date.now();
      if (now - ws.lastChat < 700) return;
      ws.lastChat = now;
      const message = update((state) => {
        const user = state.users.find((item) => item.id === ws.userId);
        if (!user) return null;
        const row = { id: rid('c'), userId: user.id, text, at: Date.now() };
        state.chat.push(row);
        if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
        return chatDto(state, row);
      });
      if (message) broadcast({ type: 'chat', message });
      return;
    }
    if (msg.type === 'matchchat') {
      if (!ws.userId) return send(ws, { type: 'error', error: 'Sign in to talk' });
      const text = String(msg.text || '').trim().slice(0, 200);
      const matchId = String(msg.matchId || '');
      if (!text || !matchId) return;
      const now = Date.now();
      if (now - (ws.lastMatchChat || 0) < 400) return;
      ws.lastMatchChat = now;
      const delivered = update((state) => {
        const user = state.users.find((item) => item.id === ws.userId);
        const match = state.matches.find((item) => item.id === matchId);
        if (!user || !match) return null;
        if (match.hostId !== user.id && match.guestId !== user.id) return null;
        if (match.status === 'cancelled') return null;
        match.messages = match.messages || [];
        const row = { id: rid('mc'), userId: user.id, text, at: Date.now() };
        match.messages.push(row);
        if (match.messages.length > 80) match.messages.splice(0, match.messages.length - 80);
        return {
          matchId,
          message: {
            id: row.id,
            text: row.text,
            at: row.at,
            user: {
              id: user.id,
              username: user.username,
              avatar: user.avatar,
              chatIcon: user.chatIcon,
              nameColor: user.nameColor,
              discordName: discordName(user),
              discordAvatarUrl: discordAvatarUrl(user),
            },
          },
          to: [match.hostId, match.guestId].filter(Boolean),
        };
      });
      if (!delivered) return;
      for (const sock of sockets) {
        if (!delivered.to.includes(sock.userId)) continue;
        send(sock, { type: 'matchchat', matchId: delivered.matchId, message: delivered.message });
      }
      return;
    }
    if (msg.type === 'dm') {
      if (!ws.userId) return;
      const text = String(msg.text || '').trim().slice(0, 180);
      const username = String(msg.username || '').trim();
      if (!text || !username) return;
      const delivered = update((state) => {
        const user = state.users.find((item) => item.id === ws.userId);
        const other = state.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
        if (!user || !other || other.id === user.id) return null;
        const row = { id: rid('d'), fromId: user.id, toId: other.id, text, at: Date.now(), read: false };
        state.dms.push(row);
        if (state.dms.length > 400) state.dms.splice(0, state.dms.length - 400);
        return { row: dmDto(state, row), toId: other.id };
      });
      if (!delivered) return;
      send(ws, { type: 'dm', message: delivered.row });
      for (const client of sockets) {
        if (client.userId === delivered.toId) send(client, { type: 'dm', message: delivered.row });
      }
      return;
    }
    if (msg.type === 'hit' || msg.type === 'whiff') {
      if (!ws.userId) return;
      const matchId = String(msg.matchId || '');
      let scored = null;
      update((state) => {
        const match = state.matches.find((item) => item.id === matchId);
        if (!match || match.status !== 'live') return;
        if (match.hostId !== ws.userId && match.guestId !== ws.userId) return;
        if (Date.now() < match.startAt) return;
        const serverElapsed = Date.now() - match.startAt;
        const claimed = Number(msg.elapsed);
        const elapsed = Number.isFinite(claimed) && Math.abs(claimed - serverElapsed) < 450
          ? claimed
          : serverElapsed;
        if (elapsed > DURATION + 800) return;
        const actions = match.actions[ws.userId] || (match.actions[ws.userId] = []);
        if (actions.length > 500) return;
        if (msg.type === 'whiff') {
          const recent = actions.filter((action) => action.type === 'whiff' && elapsed - action.t < 1000);
          if (recent.length > 8) return;
          actions.push({ type: 'whiff', t: elapsed });
        } else {
          const noteIndex = Number(msg.note);
          if (!Number.isInteger(noteIndex)) return;
          if (actions.some((action) => action.type === 'hit' && action.note === noteIndex)) return;
          const chart = buildChart(match.seed);
          const note = chart[noteIndex];
          if (!note || note.i !== noteIndex) return;
          const offset = elapsed - note.t;
          const judgement = judge(offset);
          if (judgement === 'miss') actions.push({ type: 'whiff', t: elapsed });
          else actions.push({ type: 'hit', note: note.i, judgement, t: note.t });
        }
        const chart = buildChart(match.seed);
        const stateScore = scoreTimeline(chart, match.actions[ws.userId], elapsed);
        match.scores[ws.userId] = stateScore.score;
        scored = { score: stateScore.score, combo: stateScore.combo, elapsed };
      });
      if (scored) {
        broadcast(
          { type: 'score', matchId, userId: ws.userId, score: scored.score, combo: scored.combo },
          () => true
        );
      }
      return;
    }
    if (msg.type === 'finish') {
      const matchId = String(msg.matchId || '');
      let done = false;
      update((state) => {
        const match = state.matches.find((item) => item.id === matchId);
        if (!match || match.status !== 'live') return;
        if (Date.now() < match.startAt + DURATION) return;
        resolveMatch(state, match);
        done = true;
      });
      if (done) {
        pingMatch(matchId);
        pingLobby();
      }
    }
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (ws.userId) {
      const still = [...sockets].some((client) => client.userId === ws.userId);
      if (!still) online.delete(ws.userId);
    }
  });
});

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
server.on('error', (error) => console.error(error));
process.on('uncaughtException', (error) => console.error(error));
server.listen(port, host, () => {
  load();
  update((state) => {
    closeFinishedMatches(state);
    releaseSupersededSparring(state);
    sparringCastWin(state);
  });
  console.log(`OGVAULT API on http://${host}:${port}`);
  setReviewSettleHook((matchId) => {
    pingMatch(matchId);
    pingLobby();
  });
  setChatClearedHook(() => broadcast({ type: 'chatclear' }));
  setOnlineCount(() => sockets.size);
  startDiscordAdmin();
});

setInterval(() => {
  const finished = [];
  const notes = [];
  try {
    update((state) => {
      const tick = tickEconomy(state);
      finished.push(...tick.finished);
      notes.push(...(tick.notes || []));
      notes.push(...sparringCastWin(state));
    });
  } catch (error) {
    console.error(error);
  }
  for (const note of notes) {
    deliverMatchLine(note);
    pingMatch(note.matchId);
  }
  if (finished.length || notes.length) {
    pingLobby();
    for (const id of finished) pingMatch(id);
  }
}, 1000);
