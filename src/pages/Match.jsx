import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, onWs, sendWs } from '../api';
import { useApp } from '../App';
import { formatDate, useNow } from '../format';
import { Amount, Avatar, Name } from '../ui';

const STEPS = [
  ['waiting', 'Waiting'],
  ['readyup', 'ReadyUp'],
  ['playing', 'Playing'],
  ['result', 'Result'],
  ['completed', 'Completed'],
];

export function Match() {
  const { id } = useParams();
  const { me, setMe, setAuth, toast, refreshMe } = useApp();
  const [match, setMatch] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function load() {
    try {
      const data = await api(`/api/matches/${id}`);
      setMatch(data.match);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    const stop = onWs((msg) => {
      if (msg.type === 'match' && msg.matchId === id) load();
    });
    return () => { clearInterval(timer); stop(); };
  }, [id]);

  async function act(path, body, note) {
    if (!me) { setAuth('in'); return; }
    try {
      const data = await api(path, { method: 'POST', body: body || {} });
      if (data.user) setMe(data.user);
      if (data.match) setMatch(data.match);
      if (note) toast(note);
      if (path.endsWith('/rematch') && data.match) navigate(`/match/${data.match.id}`);
      if (path.endsWith('/leave') || path.endsWith('/forfeit') || path.endsWith('/report')) refreshMe();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  if (error && !match) return <p className="error">{error}</p>;
  if (!match) return <p className="muted">Opening the lobby…</p>;

  return <Listing match={match} me={me} act={act} id={id} toast={toast} setAuth={setAuth} />;
}

function Listing({ match, me, act, id, toast, setAuth }) {
  const youHost = me && match.host?.id === me.id;
  const youGuest = me && match.guest?.id === me.id;
  const youIn = youHost || youGuest;
  const ready = youHost ? match.hostReady : match.guestReady;
  const phase = match.phase || 'waiting';
  const step = Math.max(0, STEPS.findIndex(([key]) => key === phase));
  const locked = ['playing', 'result', 'completed'].includes(phase);
  const created = formatDate(match.createdAt, {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  async function share() {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Lobby link copied');
    } catch {
      toast(location.href);
    }
  }

  return (
    <div className="lobby">
      <section className="lobby-banner">
        <div>
          <p>Created {created}</p>
          <h1>{match.mode}</h1>
        </div>
        <div className="stake">
          <div>
            <span>Entry</span>
            <Amount value={match.entry} />
          </div>
          <b aria-hidden="true">→</b>
          <div className="prize">
            <span>Prize</span>
            <Amount value={match.pot} />
          </div>
        </div>
        <button className="iconbtn share" onClick={share} aria-label="Copy lobby link">↗</button>
      </section>

      <div className="lobby-meta">
        <div className="pills">
          <span>{match.platform === 'All' ? 'All platform' : match.platform}</span>
          <span>{match.region} region</span>
          <span>1v1 team size</span>
          <span>{match.firstTo} first to</span>
        </div>
        <ol className="stepper">
          {STEPS.map(([key, label], index) => (
            <li key={key} className={index === step ? 'now' : index < step ? 'done' : ''}>
              <i />
              {label}
            </li>
          ))}
        </ol>
      </div>

      <div className="lobby-grid">
        <Seat side="host" user={match.host} ready={match.hostReady} you={youHost} label="Host" />
        <section className="lobby-center">
          <div className="vs-badge">VS</div>
          {phase === 'waiting' || phase === 'readyup' ? (
            <Expiry expiresAt={match.expiresAt} />
          ) : (
            <p className="expire-label">{phase === 'completed' ? 'Match closed' : phase === 'playing' ? 'In game' : 'Reporting'}</p>
          )}
          {youIn && !locked && (
            <button
              className="btn ready"
              disabled={!match.guest || ready}
              onClick={() => act(`/api/matches/${id}/ready`, {}, 'Ready.')}
            >
              {ready ? 'Ready' : 'Ready'}
            </button>
          )}
          {!youIn && match.status === 'open' && (
            <button className="btn ready" onClick={() => act(`/api/matches/${id}/join`, {}, 'You are in the lobby.')}>
              Join · <Amount value={match.entry} />
            </button>
          )}
          {youIn && !locked && (
            <button className="btn leave" onClick={() => act(`/api/matches/${id}/leave`, {}, 'You left the lobby.')}>
              Leave lobby
            </button>
          )}
          {youIn && (phase === 'playing' || phase === 'result') && (
            <Report match={match} me={me} onPick={(winnerId) => act(`/api/matches/${id}/report`, { winnerId }, 'Result sent.')} onForfeit={() => act(`/api/matches/${id}/forfeit`, {}, 'Forfeit recorded.')} />
          )}
          {phase === 'completed' && <Done match={match} me={me} onRematch={() => act(`/api/matches/${id}/rematch`)} />}
          <dl className="game-info">
            <div><dt>Game info</dt><dd>{match.project}</dd></div>
            <div><dt>Status</dt><dd>{STEPS[step]?.[1] || phase}</dd></div>
            <div><dt>Host</dt><dd>{match.host?.username || '—'}</dd></div>
            <div><dt>Guest</dt><dd>{match.guest?.username || '—'}</dd></div>
          </dl>
          {phase === 'playing' && (
            <p className="load-note">Load into {match.project} and play {match.mode}, first to {match.firstTo}. Then both players report the winner here.</p>
          )}
        </section>
        <Seat
          side="guest"
          user={match.guest}
          ready={match.guestReady}
          you={youGuest}
          label="Guest"
          empty={!match.guest}
          onJoin={!youIn && match.status === 'open' ? () => act(`/api/matches/${id}/join`, {}, 'You are in the lobby.') : null}
        />
      </div>

      <Room match={match} me={me} youIn={youIn} setAuth={setAuth} />
      {match.status === 'cancelled' && <p className="muted">This listing expired or was cancelled. <Link to="/play">Back to listings.</Link></p>}
    </div>
  );
}

function Seat({ side, user, ready, you, label, empty, onJoin }) {
  return (
    <article className={`seat ${side} ${you ? 'you' : ''} ${empty ? 'empty' : ''}`}>
      <header>
        <span>{label}</span>
        <span>Solo game</span>
      </header>
      {empty || !user ? (
        <div className="seat-empty">
          <p>Waiting for a player</p>
          {onJoin && <button className="btn" onClick={onJoin}>Join</button>}
        </div>
      ) : (
        <div className="seat-body">
          <Avatar user={user} size={64} />
          <div>
            <Name user={user} link />
            <p className={ready ? 'tag good' : 'tag'}>{ready ? 'Ready' : 'Not ready'}</p>
          </div>
        </div>
      )}
    </article>
  );
}

function Expiry({ expiresAt }) {
  const now = useNow();
  const left = Math.max(0, (expiresAt || 0) - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <div className="expire">
      <span>Match expires in</span>
      <strong>{m}:{String(s).padStart(2, '0')}</strong>
    </div>
  );
}

function Report({ match, me, onPick, onForfeit }) {
  const [confirm, setConfirm] = useState(false);
  const other = me?.id === match.host?.id ? match.guest : match.host;
  return (
    <div className="report">
      {match.report?.conflict && <p className="error">Those reports do not match. Agree in the room, then send it again.</p>}
      {match.report?.mine && !match.report?.conflict && match.status !== 'done' && <p className="muted">Waiting on the other player to confirm.</p>}
      <button className="btn" onClick={() => onPick(me.id)}>I won</button>
      {other && <button className="btn ghost" onClick={() => onPick(other.id)}>{other.username} won</button>}
      {confirm ? (
        <button className="btn danger" onClick={onForfeit}>Confirm forfeit</button>
      ) : (
        <button className="btn ghost" onClick={() => setConfirm(true)}>Forfeit</button>
      )}
    </div>
  );
}

function Done({ match, me, onRematch }) {
  const won = match.winnerId && match.winnerId === me?.id;
  const tie = !match.winnerId;
  const winner = [match.host, match.guest].find((user) => user?.id === match.winnerId);
  return (
    <div className="report">
      <p>{tie ? 'Split. Entries refunded.' : won ? 'You took the prize.' : winner ? `${winner.username} took the prize.` : 'Lobby closed.'}</p>
      {!tie && !match.practice && <p className="payout"><Amount value={match.payout} /> paid, after the 5% fee.</p>}
      <button className="btn" onClick={onRematch}>Run it back</button>
      <Link className="btn ghost" to="/play">Listings</Link>
    </div>
  );
}

function Room({ match, me, youIn, setAuth }) {
  const [rows, setRows] = useState(match.messages || []);
  const [text, setText] = useState('');
  const box = useRef(null);

  useEffect(() => {
    setRows(match.messages || []);
  }, [match.id, match.messages]);

  useEffect(() => {
    return onWs((msg) => {
      if (msg.type !== 'matchchat' || msg.matchId !== match.id || !msg.message) return;
      setRows((prev) => (prev.some((row) => row.id === msg.message.id) ? prev : [...prev, msg.message]));
    });
  }, [match.id]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [rows]);

  function send(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (!me) { setAuth('in'); return; }
    sendWs({ type: 'matchchat', matchId: match.id, text: value });
    setText('');
  }

  return (
    <section className="room">
      <header>
        <h2>Private room</h2>
        <p>{youIn ? 'Only you and the other player can read this.' : 'Join the listing to talk.'}</p>
      </header>
      <div className="room-log" ref={box}>
        {rows.map((row) => (
          <p key={row.id} className={row.user?.id === me?.id ? 'mine' : ''}>
            <b>{row.user?.username || 'Player'}</b>
            <span>{row.text}</span>
          </p>
        ))}
        {!rows.length && <p className="muted">No messages yet.</p>}
      </div>
      {youIn ? (
        <form onSubmit={send}>
          <input value={text} maxLength={200} onChange={(event) => setText(event.target.value)} placeholder="Message the other player" />
          <button className="btn" type="submit">Send</button>
        </form>
      ) : (
        <p className="muted">This chat stays between the host and the guest.</p>
      )}
    </section>
  );
}
