import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { ago, format, formatDate } from '../format';
import { Amount, Avatar, Name, PageHead } from '../ui';

export function Friends() {
  const { me, setAuth, toast } = useApp();
  const [friends, setFriends] = useState([]);
  const [name, setName] = useState('');
  const load = () => api('/api/friends').then((data) => setFriends(data.friends));
  useEffect(() => { if (me) load().catch(() => {}); }, [me?.id]);
  if (!me) {
    return <PageHead kicker="Lobby" title="Friends" text="Sign in to pin players."><button className="btn" onClick={() => setAuth('in')}>Sign in</button></PageHead>;
  }
  return (
    <div className="stack-lg">
      <PageHead kicker="Lobby" title="Friends" text="Adding someone pins them here and, if they are a player, pins you back." />
      <form className="panel row-form" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const data = await api('/api/friends', { method: 'POST', body: { username: name } });
          setFriends(data.friends);
          setName('');
          toast('Added');
        } catch (err) { toast(err.message, 'bad'); }
      }}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="username" aria-label="Friend username" />
        <button className="btn" type="submit">Add</button>
      </form>
      <div className="panel">
        {friends.map((user) => (
          <div className="tr friend" key={user.id}>
            <span className="who"><Avatar user={user} size={36} /><Name user={user} link />{user.online && <span className="live-dot">live</span>}</span>
            <span>{user.stats.wins} wins</span>
            <span className="row-actions">
              <button className="btn ghost" onClick={async () => {
                await api(`/api/friends/${user.username}`, { method: 'DELETE' });
                load();
              }}>Remove</button>
            </span>
          </div>
        ))}
        {!friends.length && <p className="muted">Nobody pinned yet.</p>}
      </div>
    </div>
  );
}

export function Profile() {
  const { name } = useParams();
  const { me, setMe, setAuth, toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [rename, setRename] = useState('');
  const [report, setReport] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setData(null);
    api(`/api/users/${name}`).then(setData).catch((err) => setError(err.message));
  }, [name]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Looking up that player…</p>;
  const loaded = data.user;
  const self = me?.id === loaded.id;
  const user = self && me
    ? { ...loaded, avatar: me.avatar, chatIcon: me.chatIcon, nameColor: me.nameColor, vip: me.vip, discordAvatarUrl: me.discordAvatarUrl || loaded.discordAvatarUrl }
    : loaded;
  const stats = [
    ['Won', user.stats.earned],
    ['Wins', user.stats.wins],
    ['Losses', user.stats.losses],
    ['Matches', user.stats.matches],
    ['Streak', user.stats.streak],
    ['Best streak', user.stats.bestStreak],
    ['Win rate', `${user.stats.winRate}%`],
    ['Best score', format(user.stats.bestScore)],
  ];

  return (
    <div className="stack-lg">
      <section className="panel profile">
        <Avatar user={user} size={84} />
        <div>
          <p className="kicker">Player {user.vip && '· VIP'}</p>
          <h1><Name user={user} label={user.discordName || user.username} /></h1>
          {user.discordName && (
            <p className="muted">Discord{user.discordUsername ? ` @${user.discordUsername}` : ''} · {user.username}</p>
          )}
          <p className="muted">Joined {formatDate(user.createdAt)}</p>
        </div>
        <div className="page-actions">
          {self && <Link className="btn ghost" to="/shop#inventory">Inventory</Link>}
          {!self && (
            <button className="btn ghost" onClick={async () => {
              if (!me) { setAuth('in'); return; }
              try {
                await api('/api/friends', { method: 'POST', body: { username: user.username } });
                toast('Added');
              } catch (err) { toast(err.message, 'bad'); }
            }}>{data.friend ? 'Friends' : 'Add friend'}</button>
          )}
        </div>
      </section>
      <div className="stat-grid">
        {stats.map(([label, value]) => (
          <article key={label} className="panel stat-card">
            <span>{label}</span>
            <strong>{typeof value === 'number' && label === 'Won' ? <Amount value={value} /> : value}</strong>
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>Recent matches</h2>
        {data.recent.map((row) => {
          const mine = row.players.find((player) => player.id === user.id);
          const other = row.players.find((player) => player.id !== user.id);
          const result = !row.winnerId ? 'Tie' : row.winnerId === user.id ? 'Win' : 'Loss';
          return (
            <div className="tr match-line" key={row.id}>
              <span>{row.mode || '1v1'}</span>
              <span>{row.practice ? 'Practice' : 'Duel'}</span>
              <span><Amount value={row.entry} /></span>
              <span className={result === 'Win' ? 'up' : result === 'Loss' ? 'down' : ''}>{result} {mine ? Number(mine.score).toLocaleString() : ''}{other ? ` vs ${other.username}` : ''}</span>
              <span className="muted">{ago(row.at)}</span>
            </div>
          );
        })}
        {!data.recent.length && <p className="muted">No finished duels yet.</p>}
      </section>
      <section className="panel">
        <h2>Username history</h2>
        {user.usernameHistory?.length ? user.usernameHistory.map((row) => (
          <p key={row.at}>{row.name} · {ago(row.at)}</p>
        )) : <p className="muted">No previous names.</p>}
        <p className="muted">Current · {user.username}</p>
        {self && (
          <form className="row-form" onSubmit={async (event) => {
            event.preventDefault();
            try {
              const next = await api('/api/me/rename', { method: 'POST', body: { username: rename } });
              setMe(next.user);
              toast('Name updated');
              navigate(`/u/${next.user.username}`);
            } catch (err) { toast(err.message, 'bad'); }
          }}>
            <input value={rename} onChange={(event) => setRename(event.target.value)} placeholder="New username" />
            <button className="btn" type="submit">{user.usernameHistory?.length ? 'Rename · 5' : 'Rename free'}</button>
          </form>
        )}
      </section>
      {!self && me && (
        <form className="panel stack" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api('/api/reports', { method: 'POST', body: { target: user.username, text: report } });
            setReport('');
            toast('Report filed');
          } catch (err) { toast(err.message, 'bad'); }
        }}>
          <h2>Report</h2>
          <textarea value={report} onChange={(event) => setReport(event.target.value)} placeholder="What happened" />
          <button className="btn ghost" type="submit">Send report</button>
        </form>
      )}
    </div>
  );
}

export function HowTo() {
  return (
    <div className="stack-lg prose">
      <PageHead kicker="Rules" title="How a lobby works" text="1v1 listings are for OG projects such as Eon and Retrac. You ready up here. You play there." />
      <section className="panel">
        <h2>The listing</h2>
        <ol className="steps">
          <li>Create a lobby and pick the project, mode, region, platform, and first to. Your entry locks.</li>
          <li>The other player joins the guest seat. The private room is only for the two of you.</li>
          <li>Both press ready. Load into Eon or Retrac and play the 1v1.</li>
          <li>Both report the same winner. That pays the pot minus 20%. Disagreeing reports stay open until you agree. An open lobby expires in 30 minutes and refunds the entry.</li>
        </ol>
      </section>
      <section className="panel">
        <h2>Tokens</h2>
        <p>Entry locks when you open or join a listing. Winner receives the pot minus 20%. A split sends both entries back. A player listing stays open until another account sits down.</p>
      </section>
      <section className="panel">
        <h2>Around the lobby</h2>
        <p>Cups turn finished 1v1s into points. The shop sells VIP, snipes, and streak shields. A snipe shows a record before you ready up. A shield keeps your streak after one loss. Player of the week pays 15, 10, and 5 tokens to the players who won the most from finished 1v1s.</p>
        <p><Link to="/play">Open a listing</Link></p>
      </section>
    </div>
  );
}

const LEGAL = {
  terms: {
    title: 'Terms',
    body: [
      'OGVAULT on this server is a skill lobby for OG project 1v1s. You must be 18 or older and you may hold one account.',
      'Vault Tokens are the ledger used for entries, shop items, and rewards. A match pays when both players report the same winner.',
      'Collusion, multi-accounting, and selling accounts are grounds for a lock. The operator of a deployed OGVAULT server is responsible for any real-money rules that apply where they operate.',
    ],
  },
  privacy: {
    title: 'Privacy',
    body: [
      'This server stores your email, username, password hash, token ledger, matches, chat, and friends in its local data file. If you continue with Discord, it also stores your Discord id, username, and avatar hash. The Discord access token is used only to finish that login and is not kept.',
      'Passwords are hashed with scrypt. Chat and direct messages are stored so the lobby can reload them.',
      'Do not put payment card numbers or government IDs into chat. This build does not ask for them.',
    ],
  },
  responsible: {
    title: 'Responsible play',
    body: [
      '1v1 listings are skill contests with an entry. Only play with tokens you are willing to lose on this server.',
      'If competing for tokens is getting away from you, stop and talk to someone you trust.',
    ],
  },
  cookies: {
    title: 'Cookies',
    body: [
      'The site keeps your sign-in token and a couple of interface choices, such as sound and the news card, in local storage on this browser.',
      'There is no third-party ad cookie and no tracking pixel in this build.',
    ],
  },
};

export function Legal() {
  const { slug } = useParams();
  const page = LEGAL[slug];
  if (!page) return <PageHead title="Not a policy" text="That page is not on the server." />;
  return (
    <div className="stack-lg prose">
      <PageHead kicker="OGVAULT" title={page.title} />
      {page.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    </div>
  );
}
