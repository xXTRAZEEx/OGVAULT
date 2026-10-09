import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { PageHead, PointIcon, Token } from '../ui';
import { celebrate, sfx } from '../fx';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const DEAL_MS = 340;
let dealAudio = null;

function dealAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!dealAudio) dealAudio = new AudioCtx();
  return dealAudio;
}

function resumeDealAudio() {
  const ctx = dealAudioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function playCardSound() {
  const ctx = dealAudioContext();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const sampleRate = ctx.sampleRate;
  const frames = Math.floor(sampleRate * 0.045);
  const buffer = ctx.createBuffer(1, frames, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    const fade = 1 - i / frames;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  filter.Q.value = 0.7;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(740, now);
  osc.frequency.exponentialRampToValueAtTime(320, now + 0.05);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  noise.connect(filter);
  filter.connect(gain);
  osc.connect(gain);
  gain.connect(ctx.destination);
  noise.start(now);
  osc.start(now);
  noise.stop(now + 0.05);
  osc.stop(now + 0.07);
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cardTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards || []) {
    if (!card || card.hidden) continue;
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function resultFx(hand) {
  if (hand.outcome === 'blackjack') celebrate();
  else if (hand.outcome === 'win') sfx.coin();
  else if (hand.outcome === 'lose') sfx.lose();
}

function outcomeText(hand) {
  if (!hand || hand.status !== 'done' || !hand.showResult) return '';
  if (hand.outcome === 'blackjack') return 'Blackjack. Paid 3:2.';
  if (hand.outcome === 'win') return 'You win. Paid 1:1.';
  if (hand.outcome === 'push') return 'Push. Stake returned.';
  if (hand.outcome === 'lose') return hand.playerTotal > 21 ? 'Bust. Stake lost.' : 'Dealer wins. Stake lost.';
  return '';
}

function frame(next, player, dealer, done, motion) {
  const hidden = (dealer || []).some((card) => card.hidden);
  const up = hidden ? [dealer[0]] : dealer;
  return {
    ...next,
    player,
    dealer,
    status: done ? 'done' : 'play',
    outcome: done ? next.outcome : null,
    payout: done ? next.payout : 0,
    playerTotal: cardTotal(player),
    dealerTotal: hidden || !done ? null : cardTotal(dealer),
    dealerShows: cardTotal(up),
    canHit: !done && !!next.canHit,
    canStand: !done && !!next.canStand,
    canDouble: !done && !!next.canDouble,
    motion,
    showResult: done,
  };
}

function dealSteps(next) {
  const player = next.player || [];
  const dealer = next.dealer || [];
  const reveal = next.status === 'done';
  const steps = [];
  let shownPlayer = [];
  let shownDealer = [];
  const opening = Math.max(Math.min(player.length, 2), Math.min(dealer.length, 2));
  for (let i = 0; i < opening; i += 1) {
    if (player[i]) {
      shownPlayer = player.slice(0, i + 1);
      steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'player', index: i, kind: 'deal' }));
    }
    if (dealer[i]) {
      const hole = i === 1 && (dealer[i].hidden || reveal);
      shownDealer = shownDealer.concat(hole ? { hidden: true } : dealer[i]);
      steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'dealer', index: i, kind: 'deal' }));
    }
  }
  for (let i = 2; i < player.length; i += 1) {
    shownPlayer = player.slice(0, i + 1);
    steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'player', index: i, kind: 'deal' }));
  }
  if (reveal && shownDealer[1]?.hidden) {
    shownDealer = dealer.length >= 2 ? dealer.slice(0, 2) : shownDealer;
    steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'dealer', index: 1, kind: 'flip' }));
  }
  for (let i = 2; i < dealer.length; i += 1) {
    shownDealer = dealer.slice(0, i + 1);
    steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'dealer', index: i, kind: 'deal' }));
  }
  if (reveal) steps.push(frame(next, player, dealer.length >= 2 ? dealer : shownDealer, true, null));
  else if (!steps.length) steps.push(frame(next, player, dealer, false, null));
  return steps;
}

function continueSteps(prev, next) {
  const steps = [];
  let shownPlayer = (prev.player || []).slice();
  let shownDealer = (prev.dealer || []).map((card) => ({ ...card }));
  const player = next.player || [];
  const dealer = next.dealer || [];
  for (let i = shownPlayer.length; i < player.length; i += 1) {
    shownPlayer = player.slice(0, i + 1);
    steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'player', index: i, kind: 'deal' }));
  }
  const reveal = next.status === 'done';
  if (reveal && shownDealer.some((card) => card.hidden)) {
    const hole = dealer[1] && !dealer[1].hidden ? dealer[1] : shownDealer[1];
    shownDealer = [dealer[0] || shownDealer[0], hole].filter(Boolean);
    steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'dealer', index: 1, kind: 'flip' }));
  }
  for (let i = shownDealer.length; i < dealer.length; i += 1) {
    shownDealer = dealer.slice(0, i + 1);
    steps.push(frame(next, shownPlayer, shownDealer, false, { side: 'dealer', index: i, kind: 'deal' }));
  }
  const settledDealer = dealer.length >= shownDealer.length ? dealer : shownDealer;
  if (reveal) steps.push(frame(next, player, settledDealer, true, null));
  if (!steps.length) steps.push(frame(next, player, dealer, reveal, null));
  return steps;
}

export function Blackjack() {
  const { me, setMe, setAuth, toast } = useApp();
  const [bet, setBet] = useState('1');
  const [currency, setCurrency] = useState('tokens');
  const [hand, setHand] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const shownRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  function clearTimers() {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current = [];
  }

  function present(next, animate) {
    clearTimers();
    if (!next) {
      shownRef.current = null;
      setHand(null);
      setBusy(false);
      return;
    }
    const sequence = shownRef.current?.id === next.id ? continueSteps(shownRef.current, next) : dealSteps(next);
    sequence.forEach((step, index) => {
      if (step.motion?.kind !== 'deal' && step.motion?.kind !== 'flip') return;
      const id = setTimeout(() => playCardSound(), DEAL_MS * index);
      timers.current.push(id);
    });
    if (!animate) {
      const done = frame(next, next.player || [], next.dealer || [], next.status === 'done', null);
      shownRef.current = done;
      setHand(done);
      setBusy(false);
      if (done.showResult) {
        toast(outcomeText(done));
        resultFx(done);
      }
      return;
    }
    setBusy(true);
    sequence.forEach((step, index) => {
      const id = setTimeout(() => {
        shownRef.current = step;
        setHand(step);
        if (index === sequence.length - 1) {
          setBusy(false);
          if (step.showResult) {
            toast(outcomeText(step));
            resultFx(step);
          }
        }
      }, DEAL_MS * index);
      timers.current.push(id);
    });
  }

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!me) {
      clearTimers();
      shownRef.current = null;
      setHand(null);
      return;
    }
    api('/api/blackjack')
      .then((data) => {
        if (data.user) setMe(data.user);
        const next = data.hand || data.last || null;
        if (!next) {
          shownRef.current = null;
          setHand(null);
          return;
        }
        const done = frame(next, next.player || [], next.dealer || [], next.status === 'done', null);
        shownRef.current = done;
        setHand(done);
      })
      .catch((err) => setError(err.message));
  }, [me?.id, setMe]);

  async function act(path, body) {
    if (!me) {
      setAuth('in');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api(path, { method: 'POST', body: body || {} });
      if (data.user) setMe(data.user);
      present(data.hand || data.last || null, true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const playing = hand?.status === 'play' && !busy;
  const shown = hand;

  return (
    <div className="bj-page">
      <PageHead
        kicker="House game"
        title="Blackjack"
        text="Bet vault tokens or Vault Points against the dealer. The shoe, hits, and payout stay on the server. Blackjack pays 3:2. Dealer stands on 17."
      />
      {!me && (
        <div className="panel bj-signin">
          <p>Sign in to bet tokens.</p>
          <button className="btn" type="button" onClick={() => setAuth('in')}>Sign in</button>
        </div>
      )}
      {me && (
          <div className="bj-table panel">
            <div className="bj-meta">
              <span>Balance <Token /> <strong>{Number(me.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span>
              <span>Points <PointIcon size={14} /> <strong>{Math.round(me.points || 0).toLocaleString()}</strong></span>
              {shown && (
                <span>Bet {shown.currency === 'points' ? <PointIcon size={14} /> : <Token />} <strong>{Number(shown.bet).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span>
              )}
            </div>
            <HandRow label="Dealer" side="dealer" cards={shown?.dealer} total={shown?.status === 'done' ? shown.dealerTotal : shown?.dealerShows} hidden={!shown || shown.status === 'play'} motion={shown?.motion} />
            <HandRow label="You" side="player" cards={shown?.player} total={shown?.playerTotal} motion={shown?.motion} />
            {shown?.showResult && <p className="bj-result show">{outcomeText(shown)}</p>}
            {!shown && <p className="bj-wait">Place a bet and deal.</p>}
            {error && <p className="error">{error}</p>}
          </div>
      )}
      <div className="bj-actions">
        {!playing && (
          <div className="bj-currency" role="radiogroup" aria-label="Bet with">
            <button type="button" role="radio" aria-checked={currency === 'tokens'} className={currency === 'tokens' ? 'on' : ''} disabled={busy} onClick={() => setCurrency('tokens')}>
              <Token /> Tokens
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={currency === 'points'}
              className={`points ${currency === 'points' ? 'on' : ''}`}
              disabled={busy}
              onClick={() => { setCurrency('points'); setBet((value) => String(Math.max(1, Math.floor(Number(value) || 1)))); }}
            >
              <PointIcon size={14} /> Points
            </button>
          </div>
        )}
        {!playing && (
          <label className="bj-bet">
            Bet
            <input
              value={bet}
              onChange={(event) => setBet(event.target.value)}
              inputMode={currency === 'points' ? 'numeric' : 'decimal'}
              aria-label="Bet amount"
              disabled={busy}
            />
          </label>
        )}
        {!playing && (
          <button className="btn" type="button" disabled={busy} onClick={() => { resumeDealAudio(); act('/api/blackjack/deal', { bet, currency }); }}>Deal</button>
        )}
        <button className="btn" type="button" disabled={busy || !playing || !hand?.canHit} onClick={() => act('/api/blackjack/hit')}>Hit</button>
        <button className="btn ghost" type="button" disabled={busy || !playing || !hand?.canStand} onClick={() => act('/api/blackjack/stand')}>Stand</button>
        <button className="btn ghost" type="button" disabled={busy || !playing || !hand?.canDouble} onClick={() => act('/api/blackjack/double')}>Double</button>
      </div>
    </div>
  );
}

function HandRow({ label, side, cards, total, hidden, motion }) {
  return (
    <div className="bj-hand">
      <div className="bj-hand-label">
        <span>{label}</span>
        {cards && <strong>{hidden ? 'Showing' : 'Total'} {total ?? '—'}</strong>}
      </div>
      <div className="bj-cards">
        {(cards || []).map((card, index) => (
          <CardFace
            key={`${label}-${index}-${card.hidden ? 'hole' : `${card.rank}${card.suit}`}`}
            card={card}
            motion={motion?.side === side && motion.index === index ? motion.kind : ''}
          />
        ))}
        {!cards?.length && <span className="bj-empty">No cards</span>}
      </div>
    </div>
  );
}

function CardFace({ card, motion }) {
  const motionClass = motion === 'deal' || motion === 'flip' ? motion : '';
  if (!card || card.hidden) return <div className={`bj-card back ${motionClass}`} aria-label="Hole card" />;
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <div className={`bj-card ${red ? 'red' : 'black'} ${motionClass}`}>
      <span>{card.rank}</span>
      <span>{SUIT[card.suit]}</span>
    </div>
  );
}
