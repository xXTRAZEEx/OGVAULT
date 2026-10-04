import crypto from 'crypto';
import { credit, debit, userDto } from './logic.js';
import { fail, rid, round } from './store.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function freshShoe() {
  const cards = [];
  for (let deck = 0; deck < 6; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit });
    }
  }
  return shuffle(cards);
}

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
    if (aces === 0) soft = false;
  }
  return { total, soft: soft && total <= 21 };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards).total === 21;
}

function draw(hand) {
  const card = hand.shoe.pop();
  if (!card) fail(500, 'Shoe empty');
  return card;
}

export function parseBet(raw, balance) {
  const text = String(raw ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) fail(400, 'Bet must be at least 1 token, with at most 2 decimal places');
  const value = round(text);
  if (value < 1) fail(400, 'Minimum bet is 1 token');
  if (balance + 1e-9 < value) fail(400, 'Not enough tokens');
  return value;
}

export const BLACKJACK_BIAS_DEFAULT = 8;
export const BLACKJACK_BIAS_MAX = 40;

export function blackjackBiasPercent(state) {
  const raw = state?.settings?.blackjackBias;
  if (raw == null || raw === '') return BLACKJACK_BIAS_DEFAULT;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return BLACKJACK_BIAS_DEFAULT;
  return Math.max(0, Math.min(BLACKJACK_BIAS_MAX, n));
}

export function setBlackjackBias(state, percent) {
  const n = Math.round(Number(percent));
  if (!Number.isFinite(n) || n < 0 || n > BLACKJACK_BIAS_MAX) fail(400, 'Bias percent must be from 0 to 40');
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) state.settings = {};
  state.settings.blackjackBias = n;
  return n;
}

function biasRolls(state) {
  const percent = blackjackBiasPercent(state);
  if (percent <= 0) return false;
  return crypto.randomInt(10000) < percent * 100;
}

function isTen(card) {
  return !!card && (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K');
}

function pull(shoe, pred) {
  const index = shoe.findIndex(pred);
  if (index < 0) return null;
  return shoe.splice(index, 1)[0];
}

function releaseExtraDealer(hand) {
  if (hand.hole) {
    hand.shoe.push(hand.hole);
    hand.hole = null;
  }
  if (hand.dealer.length > 1) {
    hand.shoe.push(...hand.dealer.slice(1));
    hand.dealer = [hand.dealer[0]];
  }
}

function takeCards(shoe, cards) {
  for (const card of cards) {
    const index = shoe.indexOf(card);
    if (index >= 0) shoe.splice(index, 1);
  }
}

export function dealerNeedsCard(cards) {
  return !cards || cards.length < 2 || handTotal(cards).total < 17;
}

export function dealerHandLegal(cards) {
  if (!cards || cards.length < 2 || cards.some((card) => !card || card.hidden)) return false;
  for (let i = 2; i < cards.length; i += 1) {
    if (!dealerNeedsCard(cards.slice(0, i))) return false;
  }
  const total = handTotal(cards).total;
  return total > 21 || !dealerNeedsCard(cards);
}

function findBeat(upcard, shoe, playerTotal) {
  if (playerTotal >= 21) return null;
  const used = new Set();
  function search(cards) {
    const total = handTotal(cards).total;
    if (cards.length >= 2 && total >= 17) {
      if (total <= 21 && total > playerTotal) return cards;
      return null;
    }
    if (cards.length >= 6) return null;
    const seen = new Set();
    for (let i = 0; i < shoe.length; i += 1) {
      if (used.has(i)) continue;
      const rank = shoe[i].rank;
      if (seen.has(rank)) continue;
      seen.add(rank);
      used.add(i);
      const found = search(cards.concat(shoe[i]));
      used.delete(i);
      if (found) return found;
    }
    return null;
  }
  return search([upcard]);
}

function dealerBlackjack(upcard, shoe, lockUpcard) {
  if (lockUpcard) {
    if (upcard.rank === 'A') {
      const ten = shoe.find(isTen);
      return ten ? [upcard, ten] : null;
    }
    if (isTen(upcard)) {
      const ace = shoe.find((card) => card.rank === 'A');
      return ace ? [upcard, ace] : null;
    }
    return null;
  }
  const ace = shoe.find((card) => card.rank === 'A');
  const ten = shoe.find(isTen);
  if (!ace || !ten) return null;
  return [ace, ten];
}

function installDealer(hand, cards) {
  takeCards(hand.shoe, cards.filter((card) => card !== hand.dealer[0]));
  const upStill = cards.includes(hand.dealer[0]);
  if (!upStill) {
    const index = hand.shoe.indexOf(hand.dealer[0]);
    if (index >= 0) hand.shoe.splice(index, 1);
    hand.shoe.push(hand.dealer[0]);
    takeCards(hand.shoe, cards);
  }
  hand.dealer = cards;
  hand.hole = null;
}

function downgradeBlackjack(hand) {
  const tenIndex = isTen(hand.player[1]) ? 1 : 0;
  const removed = hand.player[tenIndex];
  hand.shoe.push(removed);
  const replacement = pull(hand.shoe, (card) => card !== removed && !isTen(card) && card.rank !== 'A');
  if (!replacement) return false;
  hand.player[tenIndex] = replacement;
  return !isBlackjack(hand.player) && handTotal(hand.player).total <= 21;
}

function placeBeatingDealer(hand, lockUpcard, playerTotal) {
  releaseExtraDealer(hand);
  if (playerTotal === 21) {
    const natural = dealerBlackjack(hand.dealer[0], hand.shoe, lockUpcard);
    if (!natural) return false;
    installDealer(hand, natural);
    return isBlackjack(hand.dealer);
  }
  let found = findBeat(hand.dealer[0], hand.shoe, playerTotal);
  if (!found && !lockUpcard) {
    const up = hand.dealer[0];
    const seen = new Set();
    for (let i = 0; i < hand.shoe.length && !found; i += 1) {
      const candidate = hand.shoe[i];
      if (seen.has(candidate.rank)) continue;
      seen.add(candidate.rank);
      const rest = hand.shoe.filter((_, index) => index !== i);
      rest.push(up);
      found = findBeat(candidate, rest, playerTotal);
      if (found) {
        hand.dealer = [candidate];
        hand.shoe.splice(i, 1);
        hand.shoe.push(up);
      }
    }
  }
  if (!found || !dealerHandLegal(found)) return false;
  installDealer(hand, found);
  const dealer = handTotal(hand.dealer).total;
  return dealerHandLegal(hand.dealer) && dealer <= 21 && dealer > playerTotal;
}

function tryBias(state, hand, lockShown) {
  if (!biasRolls(state)) return null;
  const snapshot = {
    player: hand.player.map((card) => ({ ...card })),
    dealer: hand.dealer.map((card) => ({ ...card })),
    shoe: hand.shoe.map((card) => ({ ...card })),
    hole: hand.hole ? { ...hand.hole } : null,
  };
  const restore = () => {
    hand.player = snapshot.player;
    hand.dealer = snapshot.dealer;
    hand.shoe = snapshot.shoe;
    hand.hole = snapshot.hole;
  };
  let outcome = null;
  if (isBlackjack(hand.player)) {
    if (!lockShown && downgradeBlackjack(hand)) {
      const total = handTotal(hand.player).total;
      if (placeBeatingDealer(hand, false, total)) outcome = 'lose';
    }
    if (!outcome) {
      restore();
      releaseExtraDealer(hand);
      const natural = dealerBlackjack(hand.dealer[0], hand.shoe, lockShown);
      if (natural) {
        installDealer(hand, natural);
        if (isBlackjack(hand.dealer) && isBlackjack(hand.player)) outcome = 'push';
      }
    }
  } else {
    const total = handTotal(hand.player).total;
    if (placeBeatingDealer(hand, lockShown, total)) outcome = 'lose';
  }
  if (!outcome) {
    restore();
    return null;
  }
  const player = handTotal(hand.player).total;
  const dealer = handTotal(hand.dealer).total;
  const cardsMatch = outcome === 'push'
    ? player === dealer
    : dealer <= 21 && (dealer > player || (isBlackjack(hand.dealer) && player === 21 && !isBlackjack(hand.player)));
  if (!cardsMatch || !dealerHandLegal(hand.dealer)) {
    restore();
    return null;
  }
  return outcome;
}

function settle(state, user, hand, outcome) {
  if (hand.settled) fail(400, 'Hand already settled');
  hand.settled = true;
  hand.status = 'done';
  hand.outcome = outcome;
  const stake = hand.bet;
  let creditAmount = 0;
  if (outcome === 'push') creditAmount = stake;
  else if (outcome === 'win') creditAmount = round(stake * 2);
  else if (outcome === 'blackjack') creditAmount = round(stake * 2.5);
  hand.payout = creditAmount;
  if (creditAmount > 0) credit(state, user, creditAmount, 'blackjack', { hand: hand.id, outcome });
  user.blackjack = null;
  user.blackjackLast = publicHand(hand, true);
}

function revealHole(hand) {
  if (hand.hole) {
    hand.dealer.push(hand.hole);
    hand.hole = null;
    return;
  }
  if (hand.dealer.length < 2) hand.dealer.push(draw(hand));
}

function dealerPlay(hand) {
  revealHole(hand);
  while (dealerNeedsCard(hand.dealer)) hand.dealer.push(draw(hand));
}

function finishAgainstDealer(state, user, hand) {
  dealerPlay(hand);
  const player = handTotal(hand.player).total;
  const dealer = handTotal(hand.dealer).total;
  let outcome;
  if (dealer > 21 || player > dealer) outcome = 'win';
  else if (player === dealer) outcome = 'push';
  else outcome = 'lose';
  if (outcome === 'win') outcome = tryBias(state, hand, true) || outcome;
  settle(state, user, hand, outcome);
}

export function publicHand(hand, reveal) {
  if (!hand) return null;
  const show = reveal || hand.status === 'done';
  const player = handTotal(hand.player);
  const dealerCards = show
    ? (hand.hole && hand.dealer.length < 2 ? hand.dealer.concat(hand.hole) : hand.dealer)
    : [hand.dealer[0], { hidden: true }];
  const dealer = show ? handTotal(hand.dealer) : handTotal([hand.dealer[0]]);
  return {
    id: hand.id,
    bet: hand.bet,
    status: hand.status,
    outcome: hand.outcome || null,
    payout: hand.payout || 0,
    player: hand.player,
    dealer: dealerCards,
    playerTotal: player.total,
    dealerTotal: show ? dealer.total : null,
    dealerShows: dealer.total,
    canHit: hand.status === 'play',
    canStand: hand.status === 'play',
    canDouble: hand.status === 'play' && hand.player.length === 2 && !hand.doubled,
  };
}

export function blackjackView(user) {
  return {
    hand: user.blackjack ? publicHand(user.blackjack, false) : null,
    last: user.blackjackLast || null,
    balance: round(user.balance),
    user: userDto(user, { self: true, online: true }),
  };
}

export function dealBlackjack(state, user, rawBet) {
  if (user.blackjack && user.blackjack.status === 'play') fail(400, 'Finish the hand in progress');
  const bet = parseBet(rawBet, user.balance);
  debit(state, user, bet, 'blackjack', {});
  const hand = {
    id: rid('bj'),
    bet,
    shoe: freshShoe(),
    player: [],
    dealer: [],
    doubled: false,
    status: 'play',
    outcome: null,
    payout: 0,
    settled: false,
  };
  hand.player.push(draw(hand), draw(hand));
  hand.dealer.push(draw(hand));
  user.blackjack = hand;
  const playerBj = isBlackjack(hand.player);
  const dealerUp = hand.dealer[0];
  const dealerMaybeBj = dealerUp.rank === 'A' || dealerUp.rank === '10' || 'JQK'.includes(dealerUp.rank);
  if (playerBj || dealerMaybeBj) {
    const hole = draw(hand);
    hand.dealer.push(hole);
    const dealerBj = isBlackjack(hand.dealer);
    if (playerBj && dealerBj) settle(state, user, hand, 'push');
    else if (playerBj) settle(state, user, hand, tryBias(state, hand, false) || 'blackjack');
    else if (dealerBj) settle(state, user, hand, 'lose');
    else {
      hand.dealer.pop();
      hand.hole = hole;
    }
  }
  return blackjackView(user);
}

export function hitBlackjack(state, user) {
  const hand = user.blackjack;
  if (!hand || hand.status !== 'play') fail(400, 'No hand in progress');
  hand.player.push(draw(hand));
  if (handTotal(hand.player).total > 21) {
    revealHole(hand);
    settle(state, user, hand, 'lose');
  } else if (hand.doubled) finishAgainstDealer(state, user, hand);
  return blackjackView(user);
}

export function standBlackjack(state, user) {
  const hand = user.blackjack;
  if (!hand || hand.status !== 'play') fail(400, 'No hand in progress');
  finishAgainstDealer(state, user, hand);
  return blackjackView(user);
}

export function doubleBlackjack(state, user) {
  const hand = user.blackjack;
  if (!hand || hand.status !== 'play') fail(400, 'No hand in progress');
  if (hand.player.length !== 2 || hand.doubled) fail(400, 'Double is only on the first two cards');
  const extra = hand.bet;
  if (user.balance + 1e-9 < extra) fail(400, 'Not enough tokens to double');
  debit(state, user, extra, 'blackjack', { hand: hand.id, double: true });
  hand.bet = round(hand.bet + extra);
  hand.doubled = true;
  hand.player.push(draw(hand));
  if (handTotal(hand.player).total > 21) {
    revealHole(hand);
    settle(state, user, hand, 'lose');
  } else finishAgainstDealer(state, user, hand);
  return blackjackView(user);
}
