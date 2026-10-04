import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { format, pad, parts, useNow, withZone } from '../format';
import { Amount, Avatar, Name, PageHead } from '../ui';

export function Leaderboard() {
  const [period, setPeriod] = useState('all');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api(withZone(`/api/leaderboard?period=${period}`)).then((data) => setRows(data.rows)).catch(() => setRows([]));
  }, [period]);
  return (
    <div>
      <PageHead kicker="Ranks" title="Leaderboard" text="All-time is tokens won. The clocks count profit from finished 1v1s.">
        <div className="seg">
          {[['all', 'All time'], ['daily', 'Today'], ['weekly', 'Week'], ['monthly', 'Month']].map(([id, label]) => (
            <button key={id} className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
      </PageHead>
      <div className="panel">
        <div className="tr head board"><span>#</span><span>Player</span><span>Record</span><span>Tokens</span></div>
        {rows.map((row, index) => (
          <div className="tr board" key={row.user.id}>
            <span>{index + 1}</span>
            <span className="who"><Avatar user={row.user} size={32} /><Name user={row.user} link /></span>
            <span>{row.user.stats.wins}W-{row.user.stats.losses}L</span>
            <span><Amount value={row.value} /></span>
          </div>
        ))}
        {!rows.length && <p className="muted">No payouts in this window yet.</p>}
      </div>
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
      <PageHead kicker="Community" title="Player of the week" text="Ranked by the winner payout credited on finished 1v1s this week. The top three take 15, 10, and 5 when the week closes.">
        <div className="cd">
          <b>{pad(time.d)}<small>d</small></b>
          <b>{pad(time.h)}<small>h</small></b>
          <b>{pad(time.m)}<small>m</small></b>
          <b>{pad(time.s)}<small>s</small></b>
        </div>
      </PageHead>
      <div className="panel">
        <div className="tr head board"><span>#</span><span>Player</span><span>Wins</span><span>Tokens won</span></div>
        {leaders.map((user, index) => (
          <div className="tr board" key={user.id}>
            <span>{index + 1}</span>
            <span className="who"><Avatar user={user} size={32} /><Name user={user} link /></span>
            <span>{user.wins}</span>
            <span><Amount value={user.won} /></span>
          </div>
        ))}
        {!leaders.length && <p className="muted">No finished 1v1 payouts this week yet.</p>}
      </div>
    </div>
  );
}

export function Tournaments() {
  const [cups, setCups] = useState([]);
  useEffect(() => { api('/api/tournaments').then((data) => setCups(data.tournaments)); }, []);
  return (
    <div className="stack-lg">
      <PageHead kicker="Cups" title="Tournaments" text="Cups score finished 1v1 listings. Join, play, and the wins turn into points." />
      <div className="cup-grid">
        {cups.map((cup) => (
          <Link key={cup.id} to={`/tournaments/${cup.id}`} className="panel cup">
            <p className="kicker">{cup.paidOut ? 'Paid' : cup.entry ? 'Buy-in' : 'Free'}</p>
            <h2>{cup.name}</h2>
            <p>{cup.blurb}</p>
            <div className="split">
              <span>Prize <Amount value={cup.prize} /></span>
              <span>{cup.maxPlayers ? `${cup.players}/${cup.maxPlayers}` : cup.players} players</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Tournament() {
  const { id } = useParams();
  const { me, setAuth, setMe, toast } = useApp();
  const [data, setData] = useState(null);
  const now = useNow();
  const load = () => api(`/api/tournaments/${id}`).then(setData);
  useEffect(() => { load(); }, [id]);
  if (!data) return <p className="muted">Loading the cup…</p>;
  const cup = data.tournament;
  const time = parts(cup.endsAt, now);
  return (
    <div className="stack-lg">
      <PageHead kicker={cup.paidOut ? 'Closed' : 'Live cup'} title={cup.name} text={cup.blurb}>
        {!cup.paidOut && (
          <div className="cd">
            <b>{pad(time.d)}<small>d</small></b>
            <b>{pad(time.h)}<small>h</small></b>
            <b>{pad(time.m)}<small>m</small></b>
          </div>
        )}
      </PageHead>
      <div className="panel actions">
        <div>
          <p>Prize <Amount value={cup.prize} /> · entry {cup.entry ? <Amount value={cup.entry} /> : 'free'}</p>
          <p className="muted">
            {cup.places
              ? `Prizes ${cup.places.map((amount) => amount).join(' / ')} for 1st, 2nd, and 3rd. A win is 100 points plus your score ÷ 100.`
              : 'A win is worth 100 points plus your score ÷ 100. Payout is 60 / 25 / 15.'}
          </p>
        </div>
        {data.joined ? (
          <>
            <Link className="btn" to="/play">Play a table</Link>
            {!cup.paidOut && now < cup.endsAt && (
              <button className="btn ghost" onClick={async () => {
                try {
                  const next = await api(`/api/tournaments/${id}/leave`, { method: 'POST', body: {} });
                  setMe(next.user);
                  toast('You left the cup');
                  load();
                } catch (err) { toast(err.message, 'bad'); }
              }}>Leave tournament</button>
            )}
          </>
        ) : (
          <button className="btn" onClick={async () => {
            if (!me) { setAuth('in'); return; }
            try {
              const next = await api(`/api/tournaments/${id}/join`, { method: 'POST', body: {} });
              setMe(next.user);
              toast('You are in the cup');
              load();
            } catch (err) { toast(err.message, 'bad'); }
          }}>Join cup</button>
        )}
      </div>
      <div className="panel">
        <div className="tr head board"><span>#</span><span>Player</span><span>Plays</span><span>Points</span></div>
        {cup.board.map((row) => (
          <div className={`tr board${row.place <= 3 ? ` place-${row.place}` : ''}`} key={row.user?.id || row.place}>
            <span>{row.place}</span>
            <span className="who">{row.user && <Avatar user={row.user} size={28} />}{row.user && <Name user={row.user} link />}</span>
            <span>{row.plays}</span>
            <span>{row.prize ? <Amount value={row.prize} /> : format(row.points)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
