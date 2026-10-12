import { useEffect, useState } from 'react';
import { api } from '../api';
import { pad, parts, useNow, withZone } from '../format';
import { Amount, Avatar, Name, PageHead, Points } from '../ui';

function Podium({ places }) {
  const shown = places.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="podium">
      {shown.map((place) => (
        <article key={place.rank} className={`pod place-${place.rank}`}>
          <span className="place">{place.rank === 1 ? '1st' : place.rank === 2 ? '2nd' : '3rd'}</span>
          <Avatar user={place.user} size={place.rank === 1 ? 72 : 56} />
          <Name user={place.user} link />
          <strong>{place.detail}</strong>
        </article>
      ))}
    </div>
  );
}

export function Leaderboard() {
  const [period, setPeriod] = useState('all');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api(withZone(`/api/leaderboard?period=${period}`)).then((data) => setRows(data.rows)).catch(() => setRows([]));
  }, [period]);
  return (
    <div>
      <PageHead kicker="Ranks" title="Leaderboard" text="Only Kill Race profit counts. Daily claims, Discord status, deposits, and other free tokens do not.">
        <div className="seg">
          {[['all', 'All time'], ['daily', 'Today'], ['weekly', 'Week'], ['monthly', 'Month']].map(([id, label]) => (
            <button key={id} className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
      </PageHead>
      <Podium places={rows.slice(0, 3).map((row, index) => ({
        rank: index + 1,
        user: row.user,
        detail: <Amount value={row.value} />,
      }))} />
      {rows.length > 3 && (
      <div className="panel">
        <div className="tr head board"><span>#</span><span>Player</span><span>Record</span><span>Tokens</span></div>
        {rows.slice(3).map((row, index) => (
          <div className="tr board" key={row.user.id}>
            <span>{index + 4}</span>
            <span className="who"><Avatar user={row.user} size={32} /><Name user={row.user} link /></span>
            <span>{row.user.stats.wins}W-{row.user.stats.losses}L</span>
            <span><Amount value={row.value} /></span>
          </div>
        ))}
      </div>
      )}
      {!rows.length && <p className="muted">No payouts in this window yet.</p>}
    </div>
  );
}

export function Potw() {
  const [data, setData] = useState(null);
  const now = useNow();
  const weekOver = !!(data?.potw?.endsAt && now >= data.potw.endsAt);
  useEffect(() => {
    let stop = false;
    api(withZone('/api/potw'))
      .then((payload) => { if (!stop) setData(payload); })
      .catch(() => {});
    return () => { stop = true; };
  }, [weekOver]);
  if (!data) return <p className="muted">Loading the card…</p>;
  const time = parts(data.potw.endsAt, now);
  const leaders = data.potw.leaders || [];
  return (
    <div className="stack-lg">
      <PageHead kicker="Silver Vault Points" title="Weekly Vault" text="Rank from Kill Race Vault Points only. Daily and Discord status claims still pay you, but they do not move this board. Top three take 4, 2, and 1 tokens when the clock hits zero.">
        <div className="cd">
          <b>{pad(time.d)}<small>d</small></b>
          <b>{pad(time.h)}<small>h</small></b>
          <b>{pad(time.m)}<small>m</small></b>
          <b>{pad(time.s)}<small>s</small></b>
        </div>
      </PageHead>
      <div className="weekly-prizes">
        {[['1st', 4], ['2nd', 2], ['3rd', 1]].map(([place, prize], index) => (
          <div key={place} className={`weekly-prize place-${index + 1}`}>
            <span>{place}</span>
            <strong><Amount value={prize} /></strong>
          </div>
        ))}
        <div className="weekly-earn">
          <span>How to earn</span>
          <p><Points value={5} /> per token Kill Race win · finish Kill Races for Vault Points · daily and status claims pay you but do not rank here</p>
        </div>
      </div>
      <Podium places={leaders.slice(0, 3).map((user, index) => ({
        rank: index + 1,
        user,
        detail: <Points value={user.points} />,
      }))} />
      {leaders.length > 3 && (
      <div className="panel">
        <div className="tr head board"><span>#</span><span>Player</span><span>Wins</span><span>Points</span></div>
        {leaders.slice(3).map((user, index) => (
          <div className="tr board" key={user.id}>
            <span>{index + 4}</span>
            <span className="who"><Avatar user={user} size={32} /><Name user={user} link /></span>
            <span>{user.wins}</span>
            <span><Points value={user.points} /></span>
          </div>
        ))}
      </div>
      )}
      {!leaders.length && <p className="muted">No Kill Race points this week yet. Finish a match to get on the board.</p>}
    </div>
  );
}
