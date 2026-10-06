import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'data.json');

export const FEE = 0.2;

export const SHOP = [
  {
    id: 'vip',
    name: 'OG VIP',
    price: 14,
    tag: 'Membership',
    blurb: '30 days. Gold frame, crown, and 10 snipes.',
  },
  {
    id: 'snipes',
    name: 'Snipe pack',
    price: 4,
    tag: 'Utility',
    blurb: 'Five looks at an opponent’s record before you ready up.',
  },
  {
    id: 'shield',
    name: 'Streak shield',
    price: 3,
    tag: 'Utility',
    blurb: 'The next loss keeps your win streak intact.',
  },
  {
    id: 'avatar-heat',
    name: 'Heat portrait',
    price: 3,
    tag: 'Style',
    blurb: 'An ember ring for your profile and chat.',
  },
  {
    id: 'avatar-frost',
    name: 'Frost portrait',
    price: 3,
    tag: 'Style',
    blurb: 'A cold ring for your profile and chat.',
  },
  {
    id: 'avatar-gold',
    name: 'Gold portrait',
    price: 5,
    tag: 'Style',
    blurb: 'A trophy ring for your profile and chat.',
  },
  {
    id: 'avatar-retrac',
    name: 'Retrac',
    price: 2,
    tag: 'Style',
    blurb: 'A small green Retrac mark beside your name.',
  },
  {
    id: 'avatar-eon',
    name: 'Eon',
    price: 2,
    tag: 'Style',
    blurb: 'A small Eon mark beside your name.',
  },
  {
    id: 'color-blue',
    name: 'Blue name',
    price: 2.5,
    tag: 'Style',
    blurb: 'Your name renders in vault blue.',
  },
  {
    id: 'color-gold',
    name: 'Gold name',
    price: 5,
    tag: 'Style',
    blurb: 'Your name renders in gold.',
  },
];

export function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function rid(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export function isVip(user) {
  return !!user && user.vipUntil > Date.now();
}

export function winRate(user) {
  const m = user.stats.matches || 0;
  if (!m) return 0;
  return Math.round((user.stats.wins / m) * 1000) / 10;
}

function seed() {
  const ends = (days) => Date.now() + days * 86400000;
  return {
    version: 1,
    users: [],
    matches: [],
    history: [],
    txs: [],
    chat: [],
    dms: [],
    sessions: {},
    potw: { endsAt: ends(7) },
    tournaments: [],
    prizes: 0,
    reports: [],
    withdrawals: [],
    reviewers: [],
  };
}

function stripBots(state) {
  const npcIds = new Set(state.users.filter((user) => user.npc).map((user) => user.id));
  let changed = false;
  if (npcIds.size) {
    changed = true;
    for (const match of state.matches) {
      const involved = npcIds.has(match.hostId) || (match.guestId && npcIds.has(match.guestId));
      if (!involved || !['open', 'staging', 'playing', 'result', 'live'].includes(match.status)) continue;
      for (const userId of [match.hostId, match.guestId]) {
        if (!userId || npcIds.has(userId) || match.practice || !(match.entry > 0)) continue;
        const person = state.users.find((user) => user.id === userId);
        if (!person) continue;
        person.balance = round(person.balance + match.entry);
        state.txs.unshift({
          id: rid('t'),
          userId: person.id,
          amount: match.entry,
          type: 'refund',
          meta: { match: match.id },
          at: Date.now(),
        });
      }
    }
    state.matches = state.matches.filter((match) => !npcIds.has(match.hostId) && !npcIds.has(match.guestId));
    state.users = state.users.filter((user) => !user.npc);
    state.history = (state.history || []).filter((row) => (row.players || []).every((player) => !npcIds.has(player.id)));
    state.chat = (state.chat || []).filter((row) => !npcIds.has(row.userId));
    state.dms = (state.dms || []).filter((row) => !npcIds.has(row.fromId) && !npcIds.has(row.toId));
    state.txs = (state.txs || []).filter((row) => !npcIds.has(row.userId));
    for (const user of state.users) user.friends = (user.friends || []).filter((id) => !npcIds.has(id));
    if (state.potw && (state.potw.candidates || state.potw.voters)) {
      state.potw = { endsAt: state.potw.endsAt || Date.now() + 7 * 86400000 };
    }
    for (const cup of state.tournaments || []) {
      cup.board = (cup.board || []).filter((row) => !npcIds.has(row.userId));
    }
  }
  for (const user of state.users) {
    if (user.excludedUntil) {
      user.excludedUntil = 0;
      changed = true;
    }
  }
  const earned = round(state.users.reduce((sum, user) => sum + (user.stats?.earned || 0), 0));
  if (state.prizes !== earned) {
    state.prizes = earned;
    changed = true;
  }
  return changed;
}

let state;

export function load() {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.version !== 1) throw new Error('reset');
    state = parsed;
    let migrated = false;
    state.matches.forEach((match, index) => {
      if (match.project) return;
      migrated = true;
      match.project = index % 2 ? 'Retrac' : 'Eon';
      match.mode = 'Kill Race';
      match.region = index % 2 ? 'NAE' : 'EU';
      match.platform = 'All';
      match.firstTo = 1;
      match.expiresAt = Date.now() + 30 * 60 * 1000;
      match.messages = match.messages || [];
      match.reports = match.reports || {};
    });
    if (stripBots(state)) migrated = true;
    if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
      state.settings = {};
      migrated = true;
    }
    if (state.settings.blackjackBias == null || state.settings.blackjackBias === '') {
      state.settings.blackjackBias = 8;
      migrated = true;
    }
    if (state.potw && (state.potw.candidates || state.potw.voters || typeof state.potw.endsAt !== 'number')) {
      state.potw = { endsAt: state.potw.endsAt || Date.now() + 7 * 86400000 };
      migrated = true;
    }
    for (const user of state.users) {
      const before = JSON.stringify([user.ownedAvatars, user.ownedMarks, user.ownedColors, user.avatar, user.chatIcon, user.nameColor]);
      const portraits = new Set(Array.isArray(user.ownedAvatars) ? user.ownedAvatars : []);
      const marks = new Set(Array.isArray(user.ownedMarks) ? user.ownedMarks : []);
      const colors = new Set(Array.isArray(user.ownedColors) ? user.ownedColors : []);
      const revoked = new Set(Array.isArray(user.revokedShop) ? user.revokedShop : []);
      const kept = (id) => id && !revoked.has(id);
      const portraitIds = ['avatar-heat', 'avatar-frost', 'avatar-gold'];
      const markIds = ['avatar-retrac', 'avatar-eon'];
      if (kept(user.avatar) && portraitIds.includes(user.avatar)) portraits.add(user.avatar);
      if (markIds.includes(user.avatar)) {
        if (kept(user.avatar)) {
          marks.add(user.avatar);
          if (!user.chatIcon || user.chatIcon === 'none' || user.chatIcon === 'flame' || user.chatIcon === 'crown') user.chatIcon = user.avatar;
        }
        user.avatar = 'default';
      }
      if (user.chatIcon === 'flame' || user.chatIcon === 'crown') user.chatIcon = 'none';
      marks.delete('flame');
      marks.delete('crown');
      for (const id of markIds) {
        if (portraits.has(id)) {
          if (kept(id)) marks.add(id);
          portraits.delete(id);
        }
      }
      if (user.nameColor === 'blue' && kept('color-blue')) colors.add('blue');
      if (user.nameColor === 'gold' && kept('color-gold')) colors.add('gold');
      for (const tx of state.txs || []) {
        if (tx.userId !== user.id || tx.type !== 'shop') continue;
        const item = tx.meta && tx.meta.item;
        if (!kept(item)) continue;
        if (portraitIds.includes(item)) portraits.add(item);
        if (markIds.includes(item)) marks.add(item);
        if (item === 'color-blue') colors.add('blue');
        if (item === 'color-gold') colors.add('gold');
      }
      user.ownedAvatars = [...portraits];
      user.ownedMarks = [...marks];
      user.ownedColors = [...colors];
      if (before !== JSON.stringify([user.ownedAvatars, user.ownedMarks, user.ownedColors, user.avatar, user.chatIcon, user.nameColor])) migrated = true;
    }
    if (migrated) save();
  } catch {
    state = seed();
    save();
  }
  return state;
}

export function save() {
  fs.writeFileSync(file, JSON.stringify(state));
}

export function update(fn) {
  const current = load();
  const snap = JSON.stringify(current);
  try {
    const result = fn(current);
    save();
    return result;
  } catch (err) {
    state = JSON.parse(snap);
    throw err;
  }
}

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
