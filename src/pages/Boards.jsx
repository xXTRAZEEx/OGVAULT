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
  const now = useNow();
  useEffect(() => { api('/api/tournaments').then((data) => setCups(data.tournaments || [])).catch(() => setCups([])); }, []);
  const live = cups.filter((cup) => !cup.paidOut && cup.endsAt > now);
  const past = cups.filter((cup) => cup.paidOut || cup.endsAt <= now);
  return (
    <div className="stack-lg">
      <PageHead kicker="Cups" title="Tournaments" text="Hosted on Discord. Register here or in #tournaments. Kill Race cups score your 1v1s. Scrim cups score practice and live matches." />
      {!live.length && <p className="muted">No live tournament right now. When one opens, it shows up here and in Discord.</p>}
      {!!live.length && (
        <div className="cup-grid">
          {live.map((cup) => <CupCard key={cup.id} cup={cup} now={now} />)}
        </div>
      )}
      {!!past.length && (
        <section className="shop-section">
          <div className="shop-section-head">
            <h2>Past cups</h2>
            <p>Paid out or closed.</p>
          </div>
          <div className="cup-grid">
            {past.map((cup) => <CupCard key={cup.id} cup={cup} now={now} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function CupCard({ cup, now }) {
  const open = !cup.paidOut && cup.endsAt > now;
  const time = parts(cup.endsAt, now);
  return (
    <Link to={`/tournaments/${cup.id}`} className={`panel cup ${open ? 'live' : ''}`}>
      <p className="kicker">{open ? 'Live' : 'Closed'} · {cup.kindLabel || 'Kill Race'}</p>
      <h2>{cup.name}</h2>
      <p>{cup.entry ? <>Entry <Amount value={cup.entry} /></> : 'Free entry'} · {cup.maxPlayers ? `${cup.players}/${cup.maxPlayers}` : cup.players} registered</p>
      {!!cup.places?.length && (
        <div className="cup-places">
          {[['1st', cup.places[0]], ['2nd', cup.places[1]], ['3rd', cup.places[2]]].filter(([, value]) => value != null).map(([place, value]) => (
            <span key={place}><b>{place}</b> <Amount value={value} /></span>
          ))}
        </div>
      )}
      {open && <p className="muted">{pad(time.d)}d {pad(time.h)}h {pad(time.m)}m left</p>}
    </Link>
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
      <PageHead kicker={cup.paidOut ? 'Closed' : `Live · ${cup.kindLabel || 'Kill Race'}`} title={cup.name} text={cup.kind === 'scrim' ? 'Play scrims and practice listings. Wins score 100 points plus your score.' : 'Play Kill Races on the site. Wins score 100 points plus your score.'}>
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
          <p>Prize pool <Amount value={cup.prize} /> · entry {cup.entry ? <Amount value={cup.entry} /> : 'free'} · {cup.maxPlayers ? `${cup.players}/${cup.maxPlayers}` : cup.players} registered</p>
          {!!cup.places?.length && (
            <div className="cup-places">
              {[['1st', cup.places[0]], ['2nd', cup.places[1]], ['3rd', cup.places[2]]].filter(([, value]) => value != null).map(([place, value]) => (
                <span key={place}><b>{place}</b> <Amount value={value} /></span>
              ))}
            </div>
          )}
          <p className="muted">{cup.kind === 'scrim' ? 'Scrim cups count practice listings too.' : 'Kill Race cups only count real 1v1s, not practice.'}</p>
        </div>
        {data.joined ? (
          <>
            <Link className="btn" to="/play">{cup.kind === 'scrim' ? 'Open a listing' : 'Play a Kill Race'}</Link>
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
              }}>Register</button>
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
