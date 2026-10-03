import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'data.json');

export const FEE = 0.05;
export const WELCOME = 25;

export const SHOP = [
  {
    id: 'vip',
    name: 'OG VIP',
    price: 30,
    tag: 'Membership',
    blurb: '30 days. Gold frame, crown in chat, 10 snipes, a richer daily, and a bigger referral bonus.',
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
    price: 6,
    tag: 'Style',
    blurb: 'An ember ring for your profile and chat.',
  },
  {
    id: 'avatar-frost',
    name: 'Frost portrait',
    price: 6,
    tag: 'Style',
    blurb: 'A cold ring for your profile and chat.',
  },
  {
    id: 'avatar-gold',
    name: 'Gold portrait',
    price: 8,
    tag: 'Style',
    blurb: 'A trophy ring for your profile and chat.',
  },
  {
    id: 'icon-flame',
    name: 'Flame mark',
    price: 5,
    tag: 'Style',
    blurb: 'A flame beside your name in chat.',
  },
  {
    id: 'icon-crown',
    name: 'Crown mark',
    price: 8,
    tag: 'Style',
    blurb: 'A crown beside your name in chat.',
  },
  {
    id: 'color-blue',
    name: 'Blue name',
    price: 6,
    tag: 'Style',
    blurb: 'Your name renders in vault blue.',
  },
  {
    id: 'color-gold',
    name: 'Gold name',
    price: 8,
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
    tournaments: [
      {
        id: 'cup_friday',
        name: 'Friday Vault Cup',
        blurb: 'Free entry. Play 1v1 listings before the clock ends. Wins become cup points.',
        entry: 0,
        prize: 100,
        endsAt: ends(3),
        paidOut: false,
        board: [],
      },
      {
        id: 'cup_stakes',
        name: 'High Stakes Sunday',
        blurb: 'Five tokens to enter. The buy-in stacks onto the prize.',
        entry: 5,
        prize: 40,
        endsAt: ends(6),
        paidOut: false,
        board: [],
      },
      {
        id: 'cup_last',
        name: 'Midnight Lock',
        blurb: 'Last cup. Paid out.',
        entry: 0,
        prize: 80,
        endsAt: Date.now() - 86400000,
        paidOut: true,
        board: [],
      },
    ],
    prizes: 0,
    reports: [],
    withdrawals: [],
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
      match.mode = '1v1 Box Fight';
      match.region = index % 2 ? 'NAE' : 'EU';
      match.platform = 'All';
      match.firstTo = 1;
      match.expiresAt = Date.now() + 30 * 60 * 1000;
      match.messages = match.messages || [];
      match.reports = match.reports || {};
    });
    if (stripBots(state)) migrated = true;
    if (state.potw && (state.potw.candidates || state.potw.voters || typeof state.potw.endsAt !== 'number')) {
      state.potw = { endsAt: state.potw.endsAt || Date.now() + 7 * 86400000 };
      migrated = true;
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
