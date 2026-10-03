import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { ago, format, pad, parts, useNow, withZone } from '../format';
import { Amount, Avatar, Name, PageHead, Token } from '../ui';

export function Home({ missing = false }) {
  const { rev, setAuth } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const now = useNow();

  useEffect(() => {
    let stop = false;
    api(withZone('/api/home'))
      .then((payload) => { if (!stop) setData(payload); })
      .catch((err) => { if (!stop) setError(err.message); });
    return () => { stop = true; };
  }, [rev]);

  const weekOver = !!(data?.potw?.endsAt && now >= data.potw.endsAt);
  useEffect(() => {
    if (!weekOver) return undefined;
    let stop = false;
    api(withZone('/api/home'))
      .then((payload) => { if (!stop) setData(payload); })
      .catch(() => {});
    return () => { stop = true; };
  }, [weekOver]);

  if (missing) {
    return <PageHead kicker="404" title="That room is locked" text="The page is not on this server." />;
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Opening the vault…</p>;
  const time = parts(data.potw.endsAt, now);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <img className="hero-logo" src="/logo.png" alt="OGVAULT" />
          <h1>OG 1v1s. Real pots.</h1>
          <p>Go back in time to the days of OG 1v1 kill race like nothing done before. Play for real money and see who really has the skill.</p>
          <div className="hero-cta">
            <Link className="btn" to="/play">Create a 1v1</Link>
            <Link className="btn ghost" to="/how-to-play">How a lobby works</Link>
          </div>
          <div className="stats">
            <div><span>Players</span><strong>{format(data.stats.users)}</strong></div>
            <div><span>Tokens won</span><strong><Token /> {format(data.stats.prizes)}</strong></div>
            <div><span>Duels</span><strong>{format(data.stats.duels)}</strong></div>
          </div>
        </div>
        <div className="hero-cards">
          <Link to="/tournaments" className="feature">
            <CupMark />
            <h2>Tournaments</h2>
            <p>Free cups and buy-in cups. Points come from finished 1v1s.</p>
          </Link>
          <Link to="/play" className="feature">
            <RingMark />
            <h2>Eon and Retrac</h2>
            <p>Box fights, build fights, and zone wars. The lobby is here. The game is on the project.</p>
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="section-h">
          <div>
            <h2>Player of the week</h2>
            <p>Whoever was credited the most for winning finished 1v1s. The top three take 15, 10, and 5 when the week closes.</p>
          </div>
          <div className="count-row">
            <Countdown parts={time} />
            <Link className="btn" to="/potw">View ranking</Link>
          </div>
        </div>
        {data.potw.leaders.length ? (
          <div className="podium">
            {data.potw.leaders.slice(0, 3).map((user, index) => (
              <article key={user.id} className={`pod pod-${index}`}>
                <Avatar user={user} size={64} />
                <Name user={user} link />
                <div className="split">
                  <span><Amount value={user.won} /> won</span>
                  {user.reward ? <span><b>{user.reward}</b> prize</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No finished 1v1 payouts this week yet.</p>
        )}
      </section>

      <section className="panel">
        <div className="section-h">
          <div>
            <h2>Open listings</h2>
            <p>Player listings show up when someone opens one.</p>
          </div>
          <Link to="/play">View all</Link>
        </div>
        <MatchTable matches={data.matches} setAuth={setAuth} />
      </section>
    </div>
  );
}

export function MatchTable({ matches, setAuth }) {
  const { me, toast, setMe } = useApp();
  const navigate = useNavigate();
  if (!matches?.length) {
    return <p className="muted">No open listings. Create a 1v1 and wait for a player.</p>;
  }
  return (
    <div className="table">
      <div className="tr head"><span>Host</span><span>Project</span><span>Mode</span><span>Entry</span><span>Prize</span><span /></div>
      {matches.map((match) => (
        <div className="tr" key={match.id}>
          <span className="who"><Avatar user={match.host} size={28} /><Name user={match.host} link /></span>
          <span>{match.project || 'Eon'}</span>
          <span>{match.mode || '1v1 Box Fight'}</span>
          <span><Amount value={match.entry} /></span>
          <span><Amount value={match.pot} /></span>
          <span>
            {me?.id === match.host?.id ? (
              <Link className="btn ghost" to={`/match/${match.id}`}>Your table</Link>
            ) : (
              <button className="btn" onClick={async () => {
                if (!me) { setAuth('in'); return; }
                try {
                  const data = await api(`/api/matches/${match.id}/join`, { method: 'POST', body: {} });
                  if (data.user) setMe(data.user);
                  navigate(`/match/${data.match.id}`);
                } catch (err) {
                  toast(err.message, 'bad');
                }
              }}>Join</button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function Countdown({ parts: time }) {
  return (
    <div className="cd" aria-label="Time remaining">
      <b>{pad(time.d)}<small>d</small></b>
      <b>{pad(time.h)}<small>h</small></b>
      <b>{pad(time.m)}<small>m</small></b>
    </div>
  );
}

function CupMark() {
  return <svg viewBox="0 0 64 64" className="mark"><path d="M18 14h28v6a14 14 0 0 1-28 0zM22 50h20M32 34v16" /></svg>;
}
function RingMark() {
  return <svg viewBox="0 0 64 64" className="mark"><circle cx="32" cy="32" r="16" /><circle cx="32" cy="32" r="5" /><path d="M32 16v8M32 40v8M18 38l7-4M39 30l7-4" /></svg>;
}

export function agoLabel(ts) {
  return ago(ts);
}
