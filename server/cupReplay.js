import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let parseReplay;
function replayParser() {
  if (!parseReplay) parseReplay = require('fortnite-replay-parser');
  return parseReplay;
}

const MAGIC = 0x1CA2E27F;

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function fromEvents(parsed, aliases) {
  const events = parsed.events || [];
  const byPlayer = new Map();
  let matchStats = null;
  for (const event of events) {
    if (event.group === 'playerElim' && event.eliminator && event.eliminated && !event.knocked) {
      const key = String(event.eliminator).toLowerCase();
      byPlayer.set(key, (byPlayer.get(key) || 0) + 1);
    }
    if (event.metadata === 'AthenaMatchStats' && event.eliminations != null) {
      matchStats = event.eliminations;
    }
  }
  const players = [...byPlayer.entries()]
    .map(([name, elims]) => ({ name, elims }))
    .sort((a, b) => b.elims - a.elims)
    .slice(0, 24);
  const mine = aliases
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .map((name) => players.find((row) => sameName(row.name, name))?.elims)
    .find((n) => n != null);
  return { elims: mine ?? matchStats ?? 0, matchStats, players, events };
}

export async function parseCupReplay(buf, aliases = []) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) {
    return { elims: 0, method: 'replay', players: [], note: 'That replay is empty.' };
  }
  if (buf.readUInt32LE(0) !== MAGIC) {
    return { elims: 0, method: 'replay', players: [], note: 'That file is not a Fortnite replay.' };
  }
  try {
    const parsed = await replayParser()(buf, { parseEvents: true, parsePackets: false });
    const stats = fromEvents(parsed, aliases);
    const ver = parsed.header ? `${parsed.header.Major}.${parsed.header.Minor}` : '';
    const title = parsed.info?.FriendlyName || 'Replay';
    if (stats.elims) {
      return {
        elims: stats.elims,
        method: 'replay',
        players: stats.players,
        note: `${title} (${ver}): ${stats.elims} elimination${stats.elims === 1 ? '' : 's'}.`,
      };
    }
    const groups = [...new Set((parsed.events || []).map((event) => event.group || event.metadata).filter(Boolean))];
    return {
      elims: 0,
      method: 'replay',
      players: stats.players,
      note: `${title} is a real Fortnite ${ver} replay, but it has no elim events (${groups.join(', ') || 'no playerElim / match stats'}). Type the count from the match.`,
    };
  } catch (error) {
    return {
      elims: 0,
      method: 'replay',
      players: [],
      note: `Opened the replay, but could not read elims (${error.message}). Type the count from the match.`,
    };
  }
}
