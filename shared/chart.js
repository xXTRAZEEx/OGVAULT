export const LANES = ['A', 'S', 'D'];
export const DURATION = 40000;
export const APPROACH = 1250;
export const PERFECT = 60;
export const GREAT = 110;
export const GOOD = 165;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function judge(offset) {
  const abs = Math.abs(offset);
  if (abs <= PERFECT) return 'perfect';
  if (abs <= GREAT) return 'great';
  if (abs <= GOOD) return 'good';
  return 'miss';
}

export function applyJudgement(state, judgement) {
  if (judgement === 'whiff') {
    state.combo = 0;
    return state;
  }
  if (judgement === 'miss') {
    state.combo = 0;
    state.score = Math.max(0, state.score - 5);
    return state;
  }
  if (judgement === 'good') {
    state.score += 40;
    state.combo = Math.max(state.combo, 1);
    return state;
  }
  state.combo += 1;
  const mult = Math.min(state.combo, 8);
  state.score += (judgement === 'perfect' ? 100 : 70) * mult;
  return state;
}

export function buildChart(seed) {
  const rand = mulberry32(seed >>> 0);
  const notes = [];
  const laneAt = [-1e9, -1e9, -1e9];
  let t = 1500;
  let last = -1;
  while (t < DURATION - 600) {
    let lane = Math.floor(rand() * 3);
    if (lane === last && rand() < 0.72) lane = (lane + 1 + Math.floor(rand() * 2)) % 3;
    if (t - laneAt[lane] < 280) lane = (lane + 1) % 3;
    if (t - laneAt[lane] < 280) lane = (lane + 1) % 3;
    notes.push({ i: notes.length, t: Math.round(t), lane });
    laneAt[lane] = t;
    last = lane;
    const progress = t / DURATION;
    const gap = 760 - progress * 420;
    t += gap * (0.86 + rand() * 0.28);
  }
  return notes;
}

export function scoreTimeline(notes, actions, elapsed) {
  const state = { score: 0, combo: 0 };
  const whiffs = actions
    .filter((a) => a.type === 'whiff' && a.t <= elapsed)
    .sort((a, b) => a.t - b.t);
  let wi = 0;
  const flush = (until) => {
    while (wi < whiffs.length && whiffs[wi].t <= until) {
      applyJudgement(state, 'whiff');
      wi += 1;
    }
  };
  for (const note of notes) {
    if (note.t > elapsed) break;
    const hit = actions.find((a) => a.type === 'hit' && a.note === note.i);
    if (!hit && elapsed < note.t + GOOD) break;
    flush(hit ? note.t : note.t + GOOD);
    applyJudgement(state, hit ? hit.judgement : 'miss');
  }
  flush(elapsed);
  return state;
}

export function simulateBot(notes, skill, seed) {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const actions = [];
  const clamped = Math.max(0.2, Math.min(0.96, skill));
  for (const note of notes) {
    const hitChance = 0.34 + clamped * 0.64;
    if (rand() > hitChance) continue;
    const spread = 158 - clamped * 112;
    const offset = (rand() - 0.5) * 2 * spread;
    const judgement = judge(offset);
    if (judgement === 'miss') continue;
    actions.push({ type: 'hit', note: note.i, judgement, t: note.t });
  }
  const end = (notes.at(-1)?.t || 0) + GOOD + 1;
  const events = [];
  let prev = 0;
  for (const note of notes) {
    const scored = scoreTimeline(notes, actions, note.t + GOOD);
    if (scored.score !== prev) events.push({ t: note.t, score: scored.score });
    prev = scored.score;
  }
  return { score: scoreTimeline(notes, actions, end).score, events, actions };
}
