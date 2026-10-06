import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api, apiUrl, onWs, sendWs, setToken } from './api';
import { useApp } from './App';
import { ago } from './format';
import { Amount, Avatar, Modal, Name, Token } from './ui';

const NAV = [
  ['Home', '/', HomeIcon],
  ['Kill Race', '/play', PlayIcon],
  ['Leaderboard', '/leaderboard', BoardIcon],
  ['Player of the Week', '/potw', StarIcon],
  ['Shop', '/shop', ShopIcon],
  ['Wallet', '/wallet', WalletIcon],
  ['Rewards', '/rewards', GiftIcon],
  ['Blackjack', '/blackjack', CardIcon],
];

export function Shell({ children }) {
  const { me, setMe, activeMatchId, toast, auth, setAuth, chatOpen, setChatOpen, signOut, toasts, news, setNews, refreshMe } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showLobbyBar = me && activeMatchId && pathname !== `/match/${activeMatchId}`;
  const [withSomeone, setWithSomeone] = useState(false);

  useEffect(() => {
    if (!activeMatchId) {
      setWithSomeone(false);
      return undefined;
    }
    let stop = false;
    const pull = () => {
      api(`/api/matches/${activeMatchId}`)
        .then((data) => { if (!stop) setWithSomeone(!!data.match?.guest); })
        .catch(() => { if (!stop) setWithSomeone(false); });
    };
    pull();
    const off = onWs((msg) => {
      if (msg.type === 'match' || msg.type === 'lobby') pull();
    });
    return () => { stop = true; off(); };
  }, [activeMatchId]);

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
        <div className="top-stack">
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
                <span className="me-name"><Name user={me} label={me.discordName || me.username} /></span>
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
        {showLobbyBar && (
          <button className="lobby-return" type="button" onClick={() => navigate(`/match/${activeMatchId}`)}>
            <span>You're in a lobby</span>
            <strong>Return to match</strong>
          </button>
        )}
        </div>
        <div className="content">{children}<Footer /></div>
      </div>
      <div className="chat-slot">
        {withSomeone ? <LobbyGuide /> : <Chat />}
      </div>
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
            toast(auth === 'up' ? 'Vault open.' : `Welcome back, ${user.username}`);
          }}
        />
      )}
      {news && (
        <Modal title="The vault is open" onClose={() => { localStorage.setItem('ogv_news', 'listings'); setNews(false); }}>
          <p>Go head to head in a Kill Race in your favourite OG project and wager just like the good old days.</p>
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
        <p>Skill-based Kill Race listings for OG projects. Ready up here, play on Eon or Retrac, and settle the pot in the lobby. Vault Tokens are the ledger on this server.</p>
      </div>
      <div>
        <h2>Play</h2>
        <NavLink to="/how-to-play">How a lobby works</NavLink>
        <NavLink to="/rewards">Rewards</NavLink>
        <NavLink to="/shop#inventory">Inventory</NavLink>
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

function LobbyGuide() {
  return (
    <aside className="chat">
      <div className="chat-tabs">
        <button className="on" type="button">Lobby</button>
      </div>
      <div className="chat-log lobby-guide">
        <h2>How to play</h2>
        <ol>
          <li>Create an account and sign in with Discord.</li>
          <li>Make a lobby on the site, or join one.</li>
          <li>Both players ready up on the site.</li>
          <li><strong>You must screen record the entire screen.</strong></li>
          <li>After the game, report how many kills you got in the private lobby chat and pick who won.</li>
          <li>If you disagree, both players must upload their footage and vote again. If you still do not agree, press Send for review and a reviewer will decide who won.</li>
        </ol>
        <h2>Rules</h2>
        <ol>
          <li>You must be 18 or older.</li>
          <li>No slurs, harassment, or threats.</li>
          <li>One account per person.</li>
          <li>Record the full match. A reviewer decides the winner if you still disagree.</li>
          <li>The winner is paid the pot after the 20% fee.</li>
          <li>Do not post payment details in public chat.</li>
        </ol>
      </div>
    </aside>
  );
}

function Chat() {
  const { me, setAuth } = useApp();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [rules, setRules] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    api('/api/chat').then((data) => setMessages(data.messages)).catch(() => {});
    return onWs((msg) => {
      if (msg.type === 'chatclear') {
        setMessages([]);
        return;
      }
      if (msg.type !== 'chat' || !msg.message) return;
      setMessages((list) => {
        if (list.some((item) => item.id === msg.message.id)) return list;
        const user = msg.message.user?.id === me?.id
          ? { ...msg.message.user, avatar: me.avatar, chatIcon: me.chatIcon, nameColor: me.nameColor, vip: me.vip }
          : msg.message.user;
        return [...list, { ...msg.message, user }];
      });
    });
  }, [me?.id, me?.avatar, me?.chatIcon, me?.nameColor, me?.vip]);

  useEffect(() => {
    if (!me) return;
    setMessages((list) => list.map((message) => (
      message.user?.id === me.id
        ? { ...message, user: { ...message.user, avatar: me.avatar, chatIcon: me.chatIcon, nameColor: me.nameColor, vip: me.vip } }
        : message
    )));
  }, [me?.id, me?.avatar, me?.chatIcon, me?.nameColor, me?.vip]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);

  function send() {
    const value = text.trim();
    if (!value || !me) return;
    sendWs({ type: 'chat', text: value });
    setText('');
  }

  return (
    <aside className="chat">
      <div className="chat-tabs">
        <button className="on" type="button">Live Chat</button>
      </div>
      <div className="chat-log" ref={scroller}>
        {messages.filter((message) => message.user).map((message) => (
          <article key={message.id}>
            <Avatar user={message.user} size={28} />
            <div>
              <header><Name user={message.user} link /> <time>{ago(message.at)}</time></header>
              <p>{message.text}</p>
            </div>
          </article>
        ))}
      </div>
      <form className="chat-form" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <input
          value={text}
          maxLength={180}
          disabled={!me}
          placeholder={me ? 'Type your message' : 'Sign in to talk'}
          aria-label="Type your message"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => { if (!me) setAuth('in'); }}
        />
        <div>
          <button type="button" className="linkish" onClick={() => setRules(true)}>Rules</button>
          <span>{text.length}/180</span>
          <button className="btn" type="submit" disabled={!text.trim() || !me}>Send</button>
        </div>
      </form>
      {rules && (
        <Modal title="Chat rules" onClose={() => setRules(false)}>
          <ul className="clean">
            <li>Keep it about the lobby, the Kill Race, and the pots.</li>
            <li>No payment info, no begging, no slurs.</li>
            <li>Reports land with the server. Repeat heat gets the door.</li>
          </ul>
        </Modal>
      )}
    </aside>
  );
}

function clientDiscordUrl() {
  const id = String(import.meta.env.VITE_DISCORD_CLIENT_ID || '').trim();
  if (!/^\d{17,20}$/.test(id)) return '';
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: `${window.location.origin}/api/auth/discord/callback`,
    response_type: 'code',
    scope: 'identify',
    state: crypto.randomUUID().replace(/-/g, ''),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function DiscordButton() {
  const { toast } = useApp();
  const [message, setMessage] = useState('');

  function showError(text) {
    const next = text || 'Discord login is unavailable';
    setMessage(next);
    toast(next, 'bad');
  }

  useEffect(() => {
    let live = true;
    api('/api/auth/discord')
      .then((data) => {
        if (!live || data.configured) return;
        setMessage(data.error || 'Discord login is not configured');
      })
      .catch((err) => {
        if (!live) return;
        setMessage(err.message || 'Discord login is unavailable');
      });
    return () => {
      live = false;
    };
  }, []);

  async function start() {
    const direct = clientDiscordUrl();
    try {
      const res = await fetch(apiUrl('/api/auth/discord/start'), { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      const url = typeof data.url === 'string' ? data.url.trim() : '';
      if (res.ok && url.startsWith('https://discord.com/')) {
        window.location.assign(url);
        return;
      }
      if (direct) {
        window.location.assign(direct);
        return;
      }
      showError(data.error || 'Discord login is not configured');
    } catch (err) {
      if (direct) {
        window.location.assign(direct);
        return;
      }
      window.location.assign(apiUrl('/api/auth/discord/start'));
    }
  }

  return (
    <div className="discord-login">
      <button type="button" className="btn discord" onClick={start}>
        <DiscordMark />
        Continue with Discord
      </button>
      {message && <p className="discord-note" role="alert">{message}</p>}
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
function BoardIcon() { return <svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" /></svg>; }
function StarIcon() { return <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3" /><path d="M6 20c1-3 3-4.5 6-4.5S17 17 18 20" /></svg>; }
function ShopIcon() { return <svg viewBox="0 0 24 24"><path d="M4 8h16l-1 12H5zM8 8V6a4 4 0 0 1 8 0v2" /></svg>; }
function WalletIcon() { return <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14h3" /></svg>; }
function GiftIcon() { return <svg viewBox="0 0 24 24"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2 0-3-2-2-3s3 0 2 3zM12 7c2 0 3-2 2-3s-3 0-2 3z" /></svg>; }
function CardIcon() { return <svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="16" rx="2" /><path d="M12 8v4M10 10h4" /></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24"><path d="M5 6h14v9H8l-3 3z" /></svg>; }
