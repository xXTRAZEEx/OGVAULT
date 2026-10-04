import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiUrl, onWs, sendWs } from '../api';
import { useApp } from '../App';
import { formatDate, useNow } from '../format';
import { Amount, Avatar, Modal, Name } from '../ui';

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
  const watch = useRef(null);

  function showMatch(next) {
    if (!next) return;
    const settled = next.status === 'done';
    if (watch.current === 'live' && settled) {
      watch.current = 'left';
      navigate('/play');
      return;
    }
    if (watch.current == null) watch.current = settled ? 'history' : 'live';
    setMatch(next);
  }

  async function load() {
    try {
      const data = await api(`/api/matches/${id}`);
      showMatch(data.match);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    watch.current = null;
    setMatch(null);
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
      if (data.match) showMatch(data.match);
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
          {youIn && match.guest && (match.sniped || (!locked && !ready)) && (
            <Snipe match={match} me={me} onSnipe={() => act(`/api/matches/${id}/snipe`, {}, 'Record revealed.')} />
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
            <Report
              match={match}
              me={me}
              toast={toast}
              onPick={(winnerId) => act(`/api/matches/${id}/report`, { winnerId }, 'Result sent.')}
              onReview={() => act(`/api/matches/${id}/review`, {}, 'Sent for review.')}
            />
          )}
          {youIn && (phase === 'readyup' || phase === 'playing' || phase === 'result') && (
            <Forfeit onForfeit={() => act(`/api/matches/${id}/forfeit`, {}, 'Forfeit recorded.')} />
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

function Snipe({ match, me, onSnipe }) {
  const opponent = me?.id === match.host?.id ? match.guest : match.host;
  if (!opponent) return null;
  if (match.sniped && opponent.record) {
    const { matches, wins, losses } = opponent.record;
    return (
      <p className="snipe-record">
        {opponent.username}: {matches} played, {wins} wins, {losses} losses
      </p>
    );
  }
  if ((me?.snipes || 0) < 1) {
    return <button className="btn" type="button" disabled>No snipes</button>;
  }
  return <button className="btn" type="button" onClick={onSnipe}>Snipe</button>;
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
            <Name user={user} />
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

function Report({ match, me, toast, onPick, onReview }) {
  const [sending, setSending] = useState(false);
  const now = useNow();
  const other = me?.id === match.host?.id ? match.guest : match.host;
  const mine = match.report?.mine || null;
  const unlockAt = match.report?.voteUnlockAt || 0;
  const bothClips = !!(match.clips?.host && match.clips?.guest);
  const votesOpen = bothClips && unlockAt > 0 && now >= unlockAt;
  const locked = !!mine && !votesOpen;
  const waiting = locked && !match.report?.theirs && !match.report?.conflict && match.status !== 'done';
  const pick = mine === me?.id
    ? 'You reported that you won.'
    : mine && other && mine === other.id
      ? `You reported that ${other.username} won.`
      : mine
        ? 'Your report is locked.'
        : '';
  const stillApart = !!match.report?.canReview;
  const reportDeadline = match.report?.reportDeadline || 0;
  const oneVote = (!!mine) !== (!!match.report?.theirs);
  const reportLeft = Math.max(0, reportDeadline - now);
  const reportM = Math.floor(reportLeft / 60000);
  const reportS = Math.floor((reportLeft % 60000) / 1000);
  const left = Math.max(0, unlockAt - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <div className="report">
      {match.report?.conflict && !votesOpen && <p className="error">Those reports do not match. Upload gameplay below. Your pick stays locked.</p>}
      {match.report?.conflict && bothClips && !votesOpen && unlockAt > 0 && (
        <p className="muted">Votes unlock in {m}:{String(s).padStart(2, '0')}.</p>
      )}
      {votesOpen && <p className="muted">Votes are open. You can change who won.</p>}
      {match.report?.conflict && <Clips match={match} toast={toast} />}
      {locked && <p className="muted">{pick}</p>}
      {votesOpen && mine && <p className="muted">{pick}</p>}
      {waiting && <p className="muted">Waiting on the other player to report who won.</p>}
      {oneVote && reportDeadline > 0 && !match.report?.conflict && match.status !== 'done' && (
        <p className="muted">Report closes in {reportM}:{String(reportS).padStart(2, '0')}.</p>
      )}
      {votesOpen && match.report?.revoted && !match.report?.bothRevoted && <p className="muted">Waiting on the other player to vote again.</p>}
      <button className="btn" disabled={locked} onClick={() => onPick(me.id)}>I won</button>
      {other && <button className="btn ghost" disabled={locked} onClick={() => onPick(other.id)}>{other.username} won</button>}
      {stillApart && (
        <button
          className="btn"
          disabled={!!match.report?.reviewSent || sending}
          onClick={async () => {
            if (match.report?.reviewSent || sending) return;
            setSending(true);
            try { await onReview(); } finally { setSending(false); }
          }}
        >
          {match.report?.reviewSent ? 'Sent for review' : sending ? 'Sending…' : 'Send for review'}
        </button>
      )}
    </div>
  );
}

function Forfeit({ onForfeit }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button className="btn ghost" type="button" onClick={() => setConfirm(true)}>Forfeit</button>
      {confirm && (
        <Modal title="Are you sure?" onClose={() => setConfirm(false)}>
          <p>Are you sure?</p>
          <div className="modal-actions">
            <button className="btn danger" type="button" onClick={() => { setConfirm(false); onForfeit(); }}>Confirm</button>
            <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}

const CLIP_CAP = 500 * 1024 * 1024;

function Clips({ match, toast }) {
  const [busy, setBusy] = useState(false);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('ogv_token') : '';

  function clipSrc(side) {
    return apiUrl(`/api/matches/${match.id}/clip/${side}?token=${encodeURIComponent(token || '')}`);
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type !== 'video/mp4' || !file.name.toLowerCase().endsWith('.mp4')) {
      toast('MP4 only', 'bad');
      return;
    }
    if (file.size > CLIP_CAP) {
      toast('MP4, up to 500MB', 'bad');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/matches/${match.id}/clip`), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast('Gameplay uploaded');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="clips">
      <p>Reports disagree. Both players submit their own gameplay. MP4, up to 500MB.</p>
      <ClipRow label={match.host?.username || 'Host'} clip={match.clips?.host} src={clipSrc('host')} />
      <ClipRow label={match.guest?.username || 'Guest'} clip={match.clips?.guest} src={clipSrc('guest')} />
      <label className={`btn ghost ${busy ? 'wait' : ''}`}>
        {busy ? 'Uploading…' : 'Upload my MP4'}
        <input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={upload} hidden />
      </label>
    </section>
  );
}

function ClipRow({ label, clip, src }) {
  return (
    <div className="clip-row">
      <p><b>{label}</b> · {clip?.name || 'Not uploaded'}</p>
      {clip && (
        <>
          <video src={src} controls preload="metadata" />
          <a href={src} download={clip.name || 'gameplay.mp4'}>Download</a>
        </>
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
  const [tab, setTab] = useState('chat');
  const [rows, setRows] = useState(match.messages || []);
  const [text, setText] = useState('');
  const box = useRef(null);

  useEffect(() => {
    setRows(match.messages || []);
  }, [match.id, match.messages]);

  useEffect(() => {
    return onWs((msg) => {
      if (msg.type !== 'matchchat' || msg.matchId !== match.id || !msg.message) return;
      setRows((prev) => {
        if (prev.some((row) => row.id === msg.message.id)) return prev;
        const user = msg.message.user?.id === me?.id
          ? { ...msg.message.user, avatar: me.avatar, chatIcon: me.chatIcon, nameColor: me.nameColor, vip: me.vip }
          : msg.message.user;
        return [...prev, { ...msg.message, user }];
      });
    });
  }, [match.id, me?.id, me?.avatar, me?.chatIcon, me?.nameColor, me?.vip]);

  useEffect(() => {
    if (!me) return;
    setRows((prev) => prev.map((row) => (
      row.user?.id === me.id
        ? { ...row, user: { ...row.user, avatar: me.avatar, chatIcon: me.chatIcon, nameColor: me.nameColor, vip: me.vip } }
        : row
    )));
  }, [me?.id, me?.avatar, me?.chatIcon, me?.nameColor, me?.vip]);

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
        <div className="room-tabs">
          <button type="button" className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
          <button type="button" className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Rules</button>
        </div>
        {tab === 'chat' && <p>{youIn ? 'Only you and the other player can read this.' : 'Join the listing to talk.'}</p>}
      </header>
      {tab === 'rules' ? (
        <div className="rules-copy">
          <p>Both players must record their full screen from the moment they are in the lobby until the point they die or win the game.</p>
        </div>
      ) : (
        <>
          <div className="room-log" ref={box}>
            {rows.map((row) => (
              row.system ? (
                <p key={row.id} className="system"><span>{row.text}</span></p>
              ) : (
                <p key={row.id} className={row.user?.id === me?.id ? 'mine' : ''}>
                  <span className="who">
                    <Avatar user={row.user} size={22} />
                    <Name user={row.user} />
                  </span>
                  <span>{row.text}</span>
                </p>
              )
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
        </>
      )}
    </section>
  );
}
