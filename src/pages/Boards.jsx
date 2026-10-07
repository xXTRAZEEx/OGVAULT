import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { format, pad, parts, useNow, withZone } from '../format';
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
      <PageHead kicker="Ranks" title="Leaderboard" text="All-time is tokens won. The clocks count profit from finished Kill Races.">
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
      <PageHead kicker="Silver Vault Points" title="Weekly Vault" text="Earn points from your daily claim and every Kill Race you finish. The top three this week take 8, 4, and 2 tokens when the clock hits zero.">
        <div className="cd">
          <b>{pad(time.d)}<small>d</small></b>
          <b>{pad(time.h)}<small>h</small></b>
          <b>{pad(time.m)}<small>m</small></b>
          <b>{pad(time.s)}<small>s</small></b>
        </div>
      </PageHead>
      <div className="weekly-prizes">
        {[['1st', 8], ['2nd', 4], ['3rd', 2]].map(([place, prize], index) => (
          <div key={place} className={`weekly-prize place-${index + 1}`}>
            <span>{place}</span>
            <strong><Amount value={prize} /></strong>
          </div>
        ))}
        <div className="weekly-earn">
          <span>How to earn</span>
          <p><Points value={1} /> daily claim · <Points value={5} /> per token Kill Race win · play Kill Races for Vault Points too</p>
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
      {!leaders.length && <p className="muted">No points earned this week yet. Claim your daily or finish a Kill Race to get on the board.</p>}
    </div>
  );
}

export function Tournaments() {
  const [cups, setCups] = useState([]);
  useEffect(() => { api('/api/tournaments').then((data) => setCups(data.tournaments)); }, []);
  return (
    <div className="stack-lg">
      <PageHead kicker="Cups" title="Tournaments" text="Cups score finished Kill Race listings. Join, play, and the wins turn into points." />
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
