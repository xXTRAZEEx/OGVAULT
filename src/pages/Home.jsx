import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { ago, format, useNow, withZone } from '../format';
import { Amount, Avatar, Name, PageHead, Stake, Token } from '../ui';

export function Home({ missing = false }) {
  const { rev, setAuth, me } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    api(withZone('/api/home'))
      .then((payload) => { if (!stop) setData(payload); })
      .catch((err) => { if (!stop) setError(err.message); });
    return () => { stop = true; };
  }, [rev]);

  if (missing) {
    return <PageHead kicker="404" title="That room is locked" text="The page is not on this server." />;
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Opening the vault…</p>;

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <h1>OG Kill Race Real money earned</h1>
          <p>Go back in time to the days of OG Kill Race like nothing done before. Play for real money and see who really has the skill.</p>
          <div className="hero-cta">
            <Link className="btn" to="/play">Create a Kill Race</Link>
            <Link className="btn ghost" to="/how-to-play">How a lobby works</Link>
          </div>
          <div className="stats">
            <div><span>Online now</span><strong><i className="online-dot" aria-hidden="true" /><CountUp value={data.stats.online || 0} /></strong></div>
            <div><span>Tokens won</span><strong><Token /> <CountUp value={data.stats.prizes} /></strong></div>
            <div><span>Duels</span><strong><CountUp value={data.stats.duels} /></strong></div>
          </div>
        </div>
        <div className="hero-cards">
          {me ? <ProfileCard me={me} /> : (
            <Link to="/play" className="feature">
              <RingMark />
              <h2>Making OG Projects Great Again</h2>
              <p>Play prime fortnite and particapate in kill races. Making OG Fortnite interesting again. </p>
            </Link>
          )}
        </div>
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
    return <p className="muted">No open listings. Create a Kill Race and wait for a player.</p>;
  }
  return (
    <div className="listing-stack">
      {matches.map((match) => (
        <article className="listing-card" key={match.id}>
          <header className="listing-head">
            <span className="who"><Avatar user={match.host} size={32} /><Name user={match.host} link /></span>
            <h3>{match.mode === '1v1 Kill Race' || !match.mode ? 'Kill Race' : match.mode}</h3>
          </header>
          <div className="pills listing-pills">
            <span>Platform {match.platform || 'PC'}</span>
            <span>Region {match.region || 'EU'}</span>
            <span>Project {match.project || 'Eon'}</span>
            <span>First to {match.firstTo || 1}</span>
          </div>
          <div className="listing-foot">
            <div className="stake">
              <div>
                <span>Entry</span>
                <Stake value={match.entry} currency={match.currency} />
              </div>
              <b aria-hidden="true">→</b>
              <div className="prize">
                <span>Prize</span>
                <Stake value={match.pot} currency={match.currency} />
              </div>
            </div>
            <div className="listing-actions">
              <ListingExpiry expiresAt={match.expiresAt} />
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
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ListingExpiry({ expiresAt }) {
  const now = useNow();
  const left = Math.max(0, (expiresAt || 0) - now);
  const totalMinutes = Math.floor(left / 60000);
  let label = `${totalMinutes}m`;
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    label = minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  } else if (left > 0 && totalMinutes === 0) {
    label = '<1m';
  }
  return (
    <div className="listing-expire" title="Match expires in">
      <span>Expires in</span>
      <strong>{label}</strong>
    </div>
  );
}

function CountUp({ value }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(() => (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? target : 0
  ));
  const [glow, setGlow] = useState(0);
  const shownRef = useRef(shown);
  const firstRef = useRef(true);
  useEffect(() => {
    const first = firstRef.current;
    firstRef.current = false;
    if (!first) setGlow((n) => n + 1);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const from = shownRef.current;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / (first ? 1100 : 700));
      const eased = 1 - Math.pow(1 - t, 4);
      const value = from + (target - from) * eased;
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  const decimals = Number.isInteger(target) ? 0 : 2;
  return <em key={glow} className={`count-num${glow ? ' count-glow' : ''}`}>{format(Number(shown.toFixed(decimals)))}</em>;
}

function ProfileCard({ me }) {
  const stats = me.stats || {};
  return (
    <Link to={`/u/${me.username}`} className="feature profile-card">
      <div className="profile-card-head">
        <Avatar user={me} size={52} />
        <div>
          <strong><Name user={me} label={me.discordName || me.username} /></strong>
          <span>@{me.username}</span>
        </div>
      </div>
      <div className="profile-card-stats">
        <div><span>Wins</span><strong>{format(stats.wins || 0)}</strong></div>
        <div><span>Losses</span><strong>{format(stats.losses || 0)}</strong></div>
        <div><span>Win rate</span><strong>{stats.winRate || 0}%</strong></div>
        <div><span>Earned</span><strong><Token /> {format(stats.earned || 0)}</strong></div>
        <div><span>Streak</span><strong>{stats.streak || 0}</strong></div>
        <div><span>Best streak</span><strong>{stats.bestStreak || 0}</strong></div>
      </div>
    </Link>
  );
}

function RingMark() {
  return <svg viewBox="0 0 64 64" className="mark"><circle cx="32" cy="32" r="16" /><circle cx="32" cy="32" r="5" /><path d="M32 16v8M32 40v8M18 38l7-4M39 30l7-4" /></svg>;
}

export function agoLabel(ts) {
  return ago(ts);
}
