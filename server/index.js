import './env.js';
import http from 'http';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DURATION, GOOD, buildChart, judge, scoreTimeline } from '../shared/chart.js';
import { FIRST_TO, MODES, PLATFORMS, PROJECTS, REGIONS } from '../shared/listings.js';
import { calendarWindow, safeTimeZone } from '../shared/time.js';
import {
  buyItem,
  credit,
  debit,
  ensureCups,
  ensurePotw,
  freshMatch,
  matchDto,
  POTW_PRIZES,
  potwLeaders,
  potwWindow,
  referralBonus,
  resolveMatch,
  settleAgreed,
  sendTip,
  assertReferralCode,
  purchaseAmount,
  requestWithdrawal,
  settleWithdrawals,
  startPlaying,
  userDto,
  walletSnapshot,
} from './logic.js';
import { SHOP, WELCOME, fail, isVip, load, rid, round, update } from './store.js';
import { checkoutOrigin, createCoinCheckout, handleStripeWebhook } from './checkout.js';
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
} from './discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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

function requestZone(req) {
  return safeTimeZone(req.query.tz);
}

function tickEconomy(state, timeZone) {
  const potw = ensurePotw(state, timeZone);
  const cups = ensureCups(state);
  const finished = [];
  finished.push(...expireListings(state));
  for (const match of state.matches) {
    if (match.status === 'live' && match.startAt && Date.now() >= match.startAt + DURATION + 1200) {
      resolveMatch(state, match);
      finished.push(match.id);
    }
  }
  return { potw, cups, finished };
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
    endsAt: cup.endsAt,
    paidOut: cup.paidOut,
    players: cup.board.length,
    board,
  };
}

function busy(state, userId) {
  return state.matches.some(
    (match) =>
      ['live', 'playing', 'result'].includes(match.status) &&
      (match.hostId === userId || match.guestId === userId)
  );
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

function assertPlay() {}

app.get('/api/health', route((_req, res) => res.json({ ok: true })));

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
      credit(state, user, WELCOME, 'welcome', {});
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
  let name = base;
  for (let n = 0; n < 10000; n += 1) {
    if (n > 0) {
      const suffix = String(n);
      name = `${base.slice(0, Math.max(0, 12 - suffix.length))}${suffix}`;
    }
    if (!/^[a-zA-Z0-9]{3,12}$/.test(name)) continue;
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
    credit(state, user, WELCOME, 'welcome', {});
  }
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
    const fresh = load().users.find((item) => item.id === user.id);
    res.json({ user: userDto(fresh, { self: true, online: true }) });
  })
);

app.post(
  '/api/me/rename',
  route((req, res) => {
    const username = String(req.body.username || '').trim();
    if (!/^[a-zA-Z0-9]{3,12}$/.test(username)) fail(400, 'Username is 3–12 letters and numbers');
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

app.get(
  '/api/users/:name',
  route((req, res) => {
    const state = load();
    const user = state.users.find((item) => item.username.toLowerCase() === String(req.params.name).toLowerCase());
    if (!user) fail(404, 'No player by that name');
    const viewer = currentUser(req);
    const recent = state.history
      .filter((row) => row.players.some((player) => player.id === user.id))
      .slice(0, 12);
    res.json({
      user: userDto(user, { self: viewer?.id === user.id, online: online.has(user.id) }),
      recent,
      friend: !!(viewer && viewer.friends.includes(user.id)),
    });
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
      if (cup.board.some((row) => row.userId === user.id)) fail(400, 'You are already in');
      if (cup.entry > 0) debit(state, user, cup.entry, 'entry', { cup: cup.id });
      cup.prize = round(cup.prize + cup.entry);
      cup.board.push({ userId: user.id, points: 0, plays: 0 });
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
    const changed = update((state) => tickEconomy(state).finished);
    const state = load();
    const match = state.matches.find((item) => item.id === req.params.id);
    if (!match) fail(404, 'Match not found');
    const viewer = currentUser(req);
    if (changed.length) pingLobby();
    res.json({ match: matchDto(state, match, viewer?.id) });
  })
);

app.post(
  '/api/matches',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const practice = !!req.body.practice;
    const entry = practice ? 0 : round(req.body.entry);
    const opponent = String(req.body.opponent || '').trim();
    const project = PROJECTS.includes(req.body.project) ? req.body.project : 'Eon';
    const mode = MODES.includes(req.body.mode) ? req.body.mode : '1v1 Box Fight';
    const region = REGIONS.includes(req.body.region) ? req.body.region : 'EU';
    const platform = PLATFORMS.includes(req.body.platform) ? req.body.platform : 'All';
    const firstTo = FIRST_TO.includes(Number(req.body.firstTo)) ? Number(req.body.firstTo) : 1;
    if (!practice && (!entry || entry < 0.5 || entry > 100)) fail(400, 'Entry is between 0.5 and 100 tokens');
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      if (busy(state, user.id)) fail(400, 'Finish your open 1v1 before joining another');
      const openCount = state.matches.filter(
        (match) =>
          match.hostId === user.id && ['open', 'staging', 'live', 'playing', 'result'].includes(match.status)
      ).length;
      if (openCount >= 3) fail(400, 'You already have three tables open');
      let invitee = null;
      if (opponent) {
        const other = state.users.find((item) => item.username.toLowerCase() === opponent.toLowerCase());
        if (!other) fail(404, 'No player by that name');
        if (other.id === user.id) fail(400, 'You cannot challenge yourself');
        invitee = other.username;
      }
      if (practice) fail(400, 'Open a real listing');
      debit(state, user, entry, 'entry', {});
      const match = freshMatch({ host: user, entry, invitee, project, mode, region, platform, firstTo });
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
      const user = state.users.find((item) => item.id === me.id);
      if (busy(state, user.id)) fail(400, 'Finish your open 1v1 before joining another');
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
      if (user.balance >= 0.5) {
        debit(state, user, 0.5, 'entry', {});
        const match = freshMatch({ host: user, entry: 0.5 });
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
  return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
}

app.post(
  '/api/matches/:id/join',
  route((req, res) => {
    const me = requireUser(req);
    assertPlay(me);
    const result = update((state) => {
      const user = state.users.find((item) => item.id === me.id);
      if (busy(state, user.id)) fail(400, 'Finish your open 1v1 before joining another');
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
      if (['live', 'playing', 'result'].includes(match.status)) fail(400, 'The 1v1 is in progress. Report the result or forfeit.');
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
      if (!['live', 'playing', 'result'].includes(match.status)) fail(400, 'This 1v1 is not in progress');
      if (match.hostId !== user.id && match.guestId !== user.id) fail(403, 'You are not in this match');
      if (match.status === 'live') resolveMatch(state, match, { forfeitId: user.id });
      else {
        const winnerId = match.hostId === user.id ? match.guestId : match.hostId;
        settleAgreed(state, match, winnerId, { forfeitId: user.id });
      }
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
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
      match.reports[user.id] = winnerId;
      if (match.reports[host.id] && match.reports[guest.id]) {
        if (match.reports[host.id] === match.reports[guest.id]) settleAgreed(state, match, match.reports[host.id]);
        else match.status = 'result';
      } else match.status = 'result';
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
    pingMatch(req.params.id);
    pingLobby();
    res.json(result);
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
      if (match.sniped[user.id]) return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
      if (user.snipes < 1) fail(400, 'No snipes left. The shop sells a pack of five.');
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
      const user = state.users.find((item) => item.id === me.id);
      const prev = state.matches.find((item) => item.id === req.params.id);
      if (!prev || prev.status !== 'done') fail(400, 'Rematch from a finished 1v1');
      if (prev.hostId !== user.id && prev.guestId !== user.id) fail(403, 'You were not in that match');
      if (busy(state, user.id)) fail(400, 'Finish your open 1v1 before joining another');
      const otherId = prev.hostId === user.id ? prev.guestId : prev.hostId;
      const other = state.users.find((item) => item.id === otherId);
      if (!other) fail(400, 'That player is no longer on the server');
      if (user.balance < prev.entry) fail(400, 'Not enough tokens for the same entry');
      debit(state, user, prev.entry, 'entry', {});
      const match = freshMatch({
        host: user,
        entry: prev.entry,
        invitee: other.username,
        project: prev.project,
        mode: prev.mode,
        region: prev.region,
        platform: prev.platform,
        firstTo: prev.firstTo,
      });
      state.matches.unshift(match);
      return { match: matchDto(state, match, user.id), user: userDto(user, { self: true }) };
    });
    pingLobby();
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
    const referral = assertReferralCode(state, user, req.body?.referral);
    const session = await createCoinCheckout({
      user,
      amount,
      referral,
      origin: checkoutOrigin(req),
    });
    res.json(session);
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
      return { item, user: userDto(user, { self: true }) };
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
      const amount = isVip(user) ? 3 : 1.5;
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
const wss = new WebSocketServer({ server, path: '/ws' });

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
server.on('error', (error) => console.error(error));
process.on('uncaughtException', (error) => console.error(error));
server.listen(port, '127.0.0.1', () => {
  load();
  console.log(`OGVAULT API on http://127.0.0.1:${port}`);
});

setInterval(() => {
  const finished = [];
  try {
    update((state) => {
      finished.push(...tickEconomy(state).finished);
    });
  } catch (error) {
    console.error(error);
  }
  if (finished.length) {
    pingLobby();
    for (const id of finished) pingMatch(id);
  }
}, 1000);
