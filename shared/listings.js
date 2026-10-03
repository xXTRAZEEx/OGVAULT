export const PROJECTS = ['Eon', 'Retrac'];
export const MODES = ['1v1 Box Fight', '1v1 Build Fight', '1v1 Zone Wars'];
export const REGIONS = ['EU', 'NAE', 'NAW', 'NAC', 'BR', 'ASIA', 'ME'];
export const PLATFORMS = ['All', 'PC', 'Console'];
export const FIRST_TO = [1, 2, 3, 5];
export const LISTING_MS = 30 * 60 * 1000;

export function listingPhase(match) {
  if (!match) return 'waiting';
  if (match.status === 'done') return 'completed';
  if (match.status === 'result') return 'result';
  if (match.status === 'playing' || match.status === 'live') return 'playing';
  if (match.status === 'cancelled') return 'cancelled';
  if (match.guestId) return 'readyup';
  return 'waiting';
}
