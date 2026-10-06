export const PROJECTS = ['Eon', 'Retrac'];
export const MODES = ['Kill Race'];
export const REGIONS = ['EU', 'NA'];
export const PLATFORMS = ['PC'];
export const MIN_ENTRY = 1;
export const LISTING_MS = 30 * 60 * 1000;
export const MATCH_FEE = 0.2;

export function listingFee(entry) {
  const amount = Number(entry);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 2 * MATCH_FEE * 100) / 100;
}

export function listingPrize(entry) {
  const amount = Number(entry);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 2 * (1 - MATCH_FEE) * 100) / 100;
}

export function parseEntry(raw) {
  const value = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(value) || value < MIN_ENTRY) return null;
  return value;
}

export function listingPhase(match) {
  if (!match) return 'waiting';
  if (match.status === 'done') return 'completed';
  if (match.status === 'result') return 'result';
  if (match.status === 'playing' || match.status === 'live') return 'playing';
  if (match.status === 'cancelled') return 'cancelled';
  if (match.guestId) return 'readyup';
  return 'waiting';
}
