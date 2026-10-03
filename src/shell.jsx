import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, onWs, sendWs, setToken } from './api';
import { useApp } from './App';
import { ago } from './format';
import { Amount, Avatar, Modal, Name, Token } from './ui';

const NAV = [
  ['Home', '/', HomeIcon],
  ['1v1s', '/play', PlayIcon],
  ['Tournaments', '/tournaments', CupIcon],
  ['Leaderboard', '/leaderboard', BoardIcon],
  ['Player of the Week', '/potw', StarIcon],
  ['Shop', '/shop', ShopIcon],
  ['Wallet', '/wallet', WalletIcon],
  ['Rewards', '/rewards', GiftIcon],
];

export function Shell({ children }) {
  const { me, setMe, toast, auth, setAuth, chatOpen, setChatOpen, signOut, toasts, news, setNews, refreshMe } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api(`/api/users?q=${encodeURIComponent(q.trim())}`)
        .then((data) => setHits(data.users))
        .catch(() => setHits([]));
    }, 160);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className={`app ${chatOpen ? 'chat-open' : ''}`}>
      <aside className="rail">
        <NavLink to="/" className="rail-logo" aria-label="OGVAULT home">
          <img src="/logo.png" alt="" />
        </NavLink>
        <nav>
          {NAV.map(([label, to, Icon]) => (
            <NavLink key={to} to={to} title={label} aria-label={label} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">18+</div>
      </aside>
      <div className="maincol">
        <header className="top">
          <div className="search">
            <SearchIcon />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search player"
              aria-label="Search by username"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && hits[0]) {
                  navigate(`/u/${hits[0].username}`);
                  setQ('');
                  setHits([]);
                }
              }}
            />
            {hits.length > 0 && (
              <div className="search-pop">
                {hits.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      navigate(`/u/${user.username}`);
                      setQ('');
                      setHits([]);
                    }}
                  >
                    <Avatar user={user} size={28} />
                    <Name user={user} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="top-spacer" />
          {me && (
            <NavLink to="/wallet" className="balance">
              <Token />
              <strong>{Number(me.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
            </NavLink>
          )}
          {me ? (
            <>
              <NavLink to={`/u/${me.username}`} className="me-link" title={me.username}>
                <Avatar user={me} size={28} />
                <span className="me-name">{me.discordName || me.username}</span>
              </NavLink>
              <button className="btn ghost" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setAuth('in')}>Sign in</button>
              <button className="btn" onClick={() => setAuth('up')}>Register</button>
            </>
          )}
          <button className={`iconbtn chat-toggle ${chatOpen ? 'on' : ''}`} aria-label="Chat" onClick={() => setChatOpen((v) => !v)}>
            <ChatIcon />
          </button>
        </header>
        <div className="content">{children}<Footer /></div>
      </div>
      {chatOpen && <Chat />}
      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.kind}`}>{item.text}</div>
        ))}
      </div>
      {auth && (
        <AuthModal
          mode={auth}
          onClose={() => setAuth(null)}
          onMode={setAuth}
          onDone={async (token, user) => {
            setToken(token);
            setMe(user);
            setAuth(null);
            await refreshMe();
            toast(auth === 'up' ? 'Vault open. 25 tokens are on your balance.' : `Welcome back, ${user.username}`);
          }}
        />
      )}
      {news && (
        <Modal title="The vault is open" onClose={() => { localStorage.setItem('ogv_news', 'listings'); setNews(false); }}>
          <p>List a 1v1 for Eon or Retrac. Both players sit in the lobby, ready up, and use the private room. The match is played on that project, then both report the winner. The pot pays minus a 5% fee.</p>
          <p>Open a listing when you want another account in the other seat. The private room is only for the two of you.</p>
          <button className="btn" onClick={() => { localStorage.setItem('ogv_news', 'listings'); setNews(false); }}>Got it</button>
        </Modal>
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="foot-brand">
        <img src="/logo.png" alt="OGVAULT" />
        <p>Skill-based 1v1 listings for OG projects. Ready up here, play on Eon or Retrac, and settle the pot in the lobby. Vault Tokens are the ledger on this server.</p>
      </div>
      <div>
        <h2>Play</h2>
        <NavLink to="/how-to-play">How a lobby works</NavLink>
        <NavLink to="/rewards">Rewards</NavLink>
        <NavLink to="/play">Open a listing</NavLink>
      </div>
      <div>
        <h2>Legal</h2>
        <NavLink to="/legal/terms">Terms</NavLink>
        <NavLink to="/legal/privacy">Privacy</NavLink>
        <NavLink to="/legal/responsible">Responsible play</NavLink>
        <NavLink to="/legal/cookies">Cookies</NavLink>
      </div>
      <p className="fine">18+ only. © {new Date().getFullYear()} OGVAULT. Game titles and marks belong to their owners. This server keeps a local token ledger.</p>
    </footer>
  );
}

function Chat() {
  const { me, setAuth } = useApp();
  const [tab, setTab] = useState('Global');
  const [messages, setMessages] = useState([]);
  const [dms, setDms] = useState([]);
  const [text, setText] = useState('');
  const [thread, setThread] = useState('');
  const [rules, setRules] = useState(false);
  const [vault, setVault] = useState([{ from: 'vault', text: 'Ask about 1v1 listings, fees, VIP, tokens, cups, or snipes.' }]);
  const scroller = useRef(null);

  useEffect(() => {
    api('/api/chat').then((data) => setMessages(data.messages)).catch(() => {});
    return onWs((msg) => {
      if (msg.type === 'chat') setMessages((list) => list.some((item) => item.id === msg.message.id) ? list : [...list, msg.message]);
      if (msg.type === 'dm') setDms((list) => list.some((item) => item.id === msg.message.id) ? list : [...list, msg.message]);
    });
  }, []);

  useEffect(() => {
    if (!me || tab !== 'Messages') return;
    api('/api/dms').then((data) => setDms(data.messages)).catch(() => {});
  }, [me, tab]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, tab, vault, thread, dms]);

  const unread = useMemo(() => {
    if (!me) return 0;
    return dms.filter((row) => row.to?.id === me.id && !row.read).length;
  }, [dms, me]);

  const threads = useMemo(() => {
    const map = new Map();
    for (const row of dms) {
      const other = row.from?.id === me?.id ? row.to : row.from;
      if (!other) continue;
      map.set(other.username, { user: other, last: row });
    }
    return [...map.values()];
  }, [dms, me]);

  const threadRows = dms.filter((row) => row.from?.username === thread || row.to?.username === thread);

  function send() {
    const value = text.trim();
    if (!value) return;
    if (tab === 'Global') sendWs({ type: 'chat', text: value });
    if (tab === 'Messages' && thread) sendWs({ type: 'dm', username: thread, text: value });
    if (tab === 'Vault') {
      setVault((list) => [...list, { from: 'me', text: value }, { from: 'vault', text: vaultAnswer(value) }]);
    }
    setText('');
  }

  return (
    <aside className="chat">
      <div className="chat-tabs">
        {['Global', 'Messages', 'Friends', 'Vault'].map((name) => (
          <button key={name} className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>
            {name}
            {name === 'Messages' && unread > 0 && <i>{unread}</i>}
          </button>
        ))}
      </div>
      <div className="chat-log" ref={scroller}>
        {tab === 'Global' && messages.filter((message) => message.user).map((message) => (
          <article key={message.id}>
            <Avatar user={message.user} size={28} />
            <div>
              <header><Name user={message.user} link /> <time>{ago(message.at)}</time></header>
              <p>{message.text}</p>
            </div>
          </article>
        ))}
        {tab === 'Messages' && !me && <p className="muted">Sign in to message players.</p>}
        {tab === 'Messages' && me && !thread && threads.map((item) => (
          <button key={item.user.username} className="thread" onClick={() => {
            setThread(item.user.username);
            api('/api/dms/read', { method: 'POST', body: { username: item.user.username } }).catch(() => {});
          }}>
            <Avatar user={item.user} size={28} />
            <span><Name user={item.user} /><small>{item.last.text}</small></span>
          </button>
        ))}
        {tab === 'Messages' && thread && (
          <>
            <button className="linkish" onClick={() => setThread('')}>All messages</button>
            {threadRows.map((row) => (
              <article key={row.id}>
                <Avatar user={row.from} size={28} />
                <div><header><Name user={row.from} /></header><p>{row.text}</p></div>
              </article>
            ))}
          </>
        )}
        {tab === 'Friends' && <FriendList />}
        {tab === 'Vault' && vault.map((line, index) => (
          <article key={index} className={line.from === 'vault' ? 'vault-line' : ''}>
            <div><p>{line.text}</p></div>
          </article>
        ))}
      </div>
      <form className="chat-form" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <input
          value={text}
          maxLength={180}
          disabled={!me && tab !== 'Vault'}
          placeholder={me || tab === 'Vault' ? 'Type your message' : 'Sign in to talk'}
          aria-label="Type your message"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => { if (!me && tab !== 'Vault') setAuth('in'); }}
        />
        <div>
          <button type="button" className="linkish" onClick={() => setRules(true)}>Rules</button>
          <span>{text.length}/180</span>
          <button className="btn" type="submit" disabled={!text.trim() || (!me && tab !== 'Vault')}>Send</button>
        </div>
      </form>
      {rules && (
        <Modal title="Chat rules" onClose={() => setRules(false)}>
          <ul className="clean">
            <li>Keep it about the lobby, the 1v1, and the pots.</li>
            <li>No payment info, no begging, no slurs.</li>
            <li>Reports land with the server. Repeat heat gets the door.</li>
          </ul>
        </Modal>
      )}
    </aside>
  );
}

function FriendList() {
  const { me, setAuth } = useApp();
  const [friends, setFriends] = useState([]);
  useEffect(() => {
    if (!me) return;
    api('/api/friends').then((data) => setFriends(data.friends)).catch(() => {});
  }, [me]);
  if (!me) return <p className="muted">Sign in to keep a list. <button className="linkish" onClick={() => setAuth('up')}>Register</button></p>;
  if (!friends.length) return <p className="muted">No friends yet. Add one from a profile.</p>;
  return friends.map((user) => (
    <article key={user.id}>
      <Avatar user={user} size={28} />
      <div>
        <header><Name user={user} link /> {user.online && <span className="live-dot">live</span>}</header>
        <p className="muted">{user.stats.wins} wins · {user.stats.winRate}% </p>
      </div>
    </article>
  ));
}

function vaultAnswer(text) {
  const q = text.toLowerCase();
  if (/fee|rake|pot|payout/.test(q)) return 'Winner takes the pot minus 5%. A 2 token entry makes a 4 token pot and a 3.80 payout. Ties refund both entries.';
  if (/vip/.test(q)) return 'OG VIP is 30 tokens for 30 days: gold frame, crown, 10 snipes, a 3 token daily, an 8 token referral bonus, and fee-free tips.';
  if (/snipe/.test(q)) return 'A snipe shows the other player’s record before you ready up. Packs of five are in the shop. VIP includes 10.';
  if (/token|wallet|withdraw|deposit|tip/.test(q)) return 'Vault Tokens are this server’s play ledger. Deposit packs open checkout at one US dollar per coin, and tokens are added after the payment is confirmed. Withdrawals stay pending for 24 hours. Tips send tokens to another player, with a 5% fee unless you have OG VIP.';
  if (/cup|tournament/.test(q)) return 'Join a cup, then play 1v1 listings. A win is 100 points. Prizes pay 60 / 25 / 15 when the clock ends.';
  if (/play|cook|eon|retrac|lobby|1v1|box|ready/.test(q)) return 'Create a listing for Eon or Retrac. Both players ready up, play the 1v1 on that project, and report the winner in the private room. Agreeing reports pay the pot minus 5%.';
  return 'I can talk through 1v1 listings, the 5% fee, VIP, snipes, tokens, and cups. Ask one of those.';
}

function DiscordButton() {
  const [configured, setConfigured] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    api('/api/auth/discord')
      .then((data) => {
        if (live) setConfigured(!!data.configured);
      })
      .catch(() => {
        if (!live) return;
        setConfigured(false);
        setMessage('Discord login is not configured');
      });
    return () => {
      live = false;
    };
  }, []);

  async function start() {
    try {
      const data = configured === null ? await api('/api/auth/discord') : { configured };
      if (!data.configured) {
        setConfigured(false);
        setMessage('Discord login is not configured');
        return;
      }
      window.location.assign('/api/auth/discord/start');
    } catch {
      setConfigured(false);
      setMessage('Discord login is not configured');
    }
  }

  const unconfigured = configured === false || message;

  return (
    <div className="discord-login">
      <button type="button" className="btn discord" onClick={start}>
        <DiscordMark />
        Continue with Discord
      </button>
      {unconfigured && <p className="discord-note">Discord login is not configured</p>}
    </div>
  );
}

function DiscordMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19.27 5.33A16.4 16.4 0 0 0 15.2 4l-.4.82a14.7 14.7 0 0 1 3.63 1.4 15.3 15.3 0 0 0-12.86 0A13.5 13.5 0 0 1 9.2 4.82L8.8 4a16.5 16.5 0 0 0-4.08 1.33C2.2 8.55 1.5 11.68 1.7 14.78A16.8 16.8 0 0 0 7 17.3l.72-1.12a11 11 0 0 1-1.78-.86l.45-.35c3.55 1.64 7.4 1.64 10.92 0l.45.35c-.57.35-1.16.64-1.78.86L16.7 17.3a16.8 16.8 0 0 0 5.3-2.52c.28-3.55-.55-6.65-2.73-9.45ZM8.78 13.4c-.98 0-1.78-.9-1.78-2s.8-2 1.78-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.44 0c-.98 0-1.78-.9-1.78-2s.78-2 1.78-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}

function AuthModal({ mode, onClose, onMode, onDone }) {
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ email: '', login: '', username: '', password: '', referral: '', age: false });
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = mode === 'up'
        ? await api('/api/auth/register', { method: 'POST', body: { email: form.email, username: form.username, password: form.password, referral: form.referral, age: form.age } })
        : await api('/api/auth/login', { method: 'POST', body: { login: form.login, password: form.password } });
      onDone(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={mode === 'up' ? 'Create your account' : 'Sign in'} onClose={onClose}>
      <DiscordButton />
      <div className="auth-or">or</div>
      <form className="stack" onSubmit={submit}>
        {mode === 'up' ? (
          <>
            <label>Email<input value={form.email} onChange={set('email')} type="email" required autoComplete="email" /></label>
            <label>Username<input value={form.username} onChange={set('username')} required minLength={3} maxLength={12} />
              <small>3–12 letters and numbers.</small>
            </label>
            <label>Referral <span>(optional)</span><input value={form.referral} onChange={set('referral')} /></label>
          </>
        ) : (
          <label>Email or username<input value={form.login} onChange={set('login')} required autoComplete="username" /></label>
        )}
        <label>Password
          <span className="pw">
            <input value={form.password} onChange={set('password')} type={show ? 'text' : 'password'} required minLength={8} maxLength={25} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
            <button type="button" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
          </span>
          {mode === 'up' && <small>8–25 characters with a letter and a number.</small>}
        </label>
        {mode === 'up' && (
          <label className="check">
            <input type="checkbox" checked={form.age} onChange={set('age')} />
            I am 18 or older, I agree to the terms and privacy notes, and this is my only OGVAULT account on this server.
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn" type="submit">{mode === 'up' ? 'Register' : 'Sign in'}</button>
        <button type="button" className="linkish" onClick={() => onMode(mode === 'up' ? 'in' : 'up')}>
          {mode === 'up' ? 'Already have an account? Sign in' : 'Need an account? Register'}
        </button>
      </form>
    </Modal>
  );
}

function HomeIcon() { return <svg viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>; }
function CupIcon() { return <svg viewBox="0 0 24 24"><path d="M7 4h10v3a5 5 0 0 1-10 0zM8 20h8M12 12v8M5 6H3v1a4 4 0 0 0 4 4M19 6h2v1a4 4 0 0 1-4 4" /></svg>; }
function BoardIcon() { return <svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" /></svg>; }
function StarIcon() { return <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3" /><path d="M6 20c1-3 3-4.5 6-4.5S17 17 18 20" /></svg>; }
function ShopIcon() { return <svg viewBox="0 0 24 24"><path d="M4 8h16l-1 12H5zM8 8V6a4 4 0 0 1 8 0v2" /></svg>; }
function WalletIcon() { return <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14h3" /></svg>; }
function GiftIcon() { return <svg viewBox="0 0 24 24"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2 0-3-2-2-3s3 0 2 3zM12 7c2 0 3-2 2-3s-3 0-2 3z" /></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24"><path d="M5 6h14v9H8l-3 3z" /></svg>; }
