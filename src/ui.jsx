import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function Select({ value, onChange, options, label }) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const root = useRef(null);
  const items = options.map((item) => (typeof item === 'string' ? { value: item, label: item } : item));
  const current = items.find((item) => item.value === value) || items[0];

  useEffect(() => {
    if (!open) return undefined;
    setHot(Math.max(0, items.findIndex((item) => item.value === value)));
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (item) => { onChange(item.value); setOpen(false); };
  const onKey = (event) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHot((index) => (index + step + items.length) % items.length);
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      pick(items[hot]);
    }
  };

  return (
    <div className={`select ${open ? 'open' : ''}`} ref={root}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={(event) => { event.preventDefault(); setOpen((v) => !v); }}
        onKeyDown={onKey}
      >
        <span>{current?.label}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
      </button>
      {open && (
        <ul className="select-menu" role="listbox">
          {items.map((item, index) => (
            <li
              key={item.value}
              role="option"
              aria-selected={item.value === value}
              className={`${item.value === value ? 'on' : ''} ${index === hot ? 'hot' : ''}`}
              onMouseEnter={() => setHot(index)}
              onMouseDown={(event) => { event.preventDefault(); pick(item); }}
            >
              <span>{item.label}</span>
              {item.value === value && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Token({ size = 14 }) {
  return (
    <svg className="token" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#f5c451" />
      <circle cx="8" cy="8" r="3.1" fill="none" stroke="#fff" strokeWidth="1.3" />
      <path d="M8 1.8v2.1M8 12.1v2.1M1.8 8h2.1M12.1 8h2.1" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function VaultLogo() {
  return (
    <span className="vault-logo">
      <span className="vault-art">
        <img src="/logo.png" alt="" />
        <span className="vault-hole" />
        <span className="vault-wheel"><img src="/logo.png" alt="" /></span>
      </span>
    </span>
  );
}

export function PointIcon({ size = 14 }) {
  return (
    <svg className="point-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#c9d1dc" />
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="#8e98a8" strokeWidth="1" />
      <path d="M8 4.4l1.05 2.3 2.5.25-1.9 1.7.55 2.45L8 9.85 5.8 11.1l.55-2.45-1.9-1.7 2.5-.25z" fill="#5d6675" />
    </svg>
  );
}

export function Points({ value }) {
  return (
    <span className="points">
      <PointIcon />
      <span>{Number(value || 0).toLocaleString()}</span>
    </span>
  );
}

export function Stake({ value, currency }) {
  return currency === 'points' ? <Points value={value} /> : <Amount value={value} />;
}

export function Amount({ value, plus = false }) {
  const n = Number(value || 0);
  return (
    <span className={`amount ${n < 0 ? 'down' : ''}`}>
      <Token />
      {plus && n > 0 ? '+' : ''}
      {n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );
}

const PALETTES = {
  default: ['#18233a', '#2f6bff'],
  'avatar-heat': ['#3a160f', '#ff6a3d'],
  'avatar-frost': ['#102636', '#7ee0ff'],
  'avatar-gold': ['#3a2d10', '#f5c451'],
};

const NAME_MARKS = {
  'avatar-retrac': '/styles/retrac.png',
  'avatar-eon': '/styles/eon.png',
};

function portraitRing(avatar) {
  if (avatar === 'avatar-heat') return 'ring-heat';
  if (avatar === 'avatar-frost') return 'ring-frost';
  if (avatar === 'avatar-gold') return 'ring-gold';
  return '';
}

function NameMark({ icon }) {
  const src = NAME_MARKS[icon];
  if (!src) return null;
  const kind = icon === 'avatar-retrac' ? 'retrac' : 'eon';
  return <img className={`name-mark ${kind}`} src={src} alt="" />;
}

export function FrameFx({ heat = false, frost = false, vip = false }) {
  if (!heat && !frost && !vip) return null;
  const flakes = [0, 1, 2, 3, 4];
  return (
    <>
      {heat && (
        <span className="frame-fx fx-fire" aria-hidden="true">
          <i /><i /><i />
        </span>
      )}
      {frost && (
        <span className="frame-fx fx-snow" aria-hidden="true">
          {flakes.map((n) => <i key={n} />)}
        </span>
      )}
      {vip && (
        <span className="frame-fx fx-gold" aria-hidden="true">
          {flakes.map((n) => <i key={n} />)}
        </span>
      )}
    </>
  );
}

export function Avatar({ user, size = 40 }) {
  const [broken, setBroken] = useState(false);
  const photo = !broken && user?.discordAvatarUrl;
  const ring = portraitRing(user?.avatar);
  const vipFrame = !!user?.vip && !ring;
  const klass = `avatar ${vipFrame ? 'vip' : ''} ${ring}`.trim();
  const fx = (
    <FrameFx
      heat={user?.avatar === 'avatar-heat'}
      frost={user?.avatar === 'avatar-frost'}
      vip={vipFrame}
    />
  );
  if (photo) {
    return (
      <span className={`${klass} has-photo`} style={{ width: size, height: size }}>
        <img src={photo} alt="" width={size} height={size} onError={() => setBroken(true)} />
        {fx}
      </span>
    );
  }
  const [from, to] = PALETTES[user?.avatar] || PALETTES.default;
  return (
    <span
      className={klass}
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${from}, ${to})`, fontSize: size * 0.4 }}
    >
      <span className="avatar-letter">{(user?.username || '?').slice(0, 1).toUpperCase()}</span>
      {fx}
    </span>
  );
}

export function Name({ user, link = false, label }) {
  if (!user) return null;
  const body = (
    <span className={`uname c-${user.nameColor || 'default'}`}>
      {label || user.username}
      <NameMark icon={user.chatIcon} />
      {user.vip && <em>VIP</em>}
    </span>
  );
  if (!link) return body;
  return <Link to={`/u/${user.username}`}>{body}</Link>;
}

export function WelcomeNotice() {
  const [name, setName] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    const show = (event) => setName(event.detail?.name || 'player');
    window.addEventListener('ogv:welcome', show);
    return () => window.removeEventListener('ogv:welcome', show);
  }, []);
  if (name == null) return null;
  const close = () => setName(null);
  const go = (to) => { close(); navigate(to); };
  return (
    <div className="modal-back welcome-back" onMouseDown={close}>
      <div className="modal welcome-modal" role="dialog" aria-labelledby="welcome-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="welcome-glow" aria-hidden="true" />
        <span className="welcome-kicker">Account created</span>
        <h2 id="welcome-title">Welcome to the vault, {name}</h2>
        <p className="welcome-lead">Thanks for joining OGVAULT. Here is a starter gift to get you going.</p>
        <div className="welcome-gift">
          <PointIcon size={40} />
          <div>
            <strong>+5 Vault Points</strong>
            <small>Added to your account</small>
          </div>
        </div>
        <ul className="welcome-list">
          <li><b>Play for free.</b> Use your points to enter a Vault Points Kill Race or a hand of blackjack.</li>
          <li><b>Earn more.</b> Claim 1 point every day and win 5 for every token Kill Race win.</li>
          <li><b>Win tokens.</b> The top 3 in the Weekly Vault win 8, 4 and 2 tokens every week.</li>
        </ul>
        <div className="welcome-actions">
          <button className="btn" type="button" onClick={() => go('/play')}>Find a match</button>
          <button className="btn ghost" type="button" onClick={() => go('/rewards')}>Claim daily reward</button>
        </div>
        <button className="welcome-skip" type="button" onClick={close}>Maybe later</button>
      </div>
    </div>
  );
}

export function VpnNotice() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('ogv:vpn', show);
    if (/VPN detected/i.test(decodeURIComponent(window.location.hash))) setOpen(true);
    return () => window.removeEventListener('ogv:vpn', show);
  }, []);
  if (!open) return null;
  return (
    <div className="modal-back vpn-back">
      <div className="modal vpn-modal" role="alertdialog" aria-labelledby="vpn-title">
        <div className="vpn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" />
            <path d="M12 8v5" />
            <path d="M12 16.5h.01" />
          </svg>
        </div>
        <h2 id="vpn-title">VPN detected</h2>
        <p>Turn off your VPN to prevent further sanctions. OGVAULT allows one account per network, and VPNs or proxies are not allowed.</p>
        <button className="btn" onClick={() => window.location.reload()}>I turned it off</button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHead({ kicker, title, text, children }) {
  return (
    <div className="page-head">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h1>{title}</h1>
        {text && <p className="lede">{text}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function LaunchGate({ goal, members, invite }) {
  const pct = goal > 0 ? Math.min(100, (members / goal) * 100) : 0;
  const left = Math.max(0, goal - members);
  return (
    <section className="website-down launch-gate">
      <img src="/logo.png" alt="OGVAULT" />
      <span className="launch-kicker">Coming soon</span>
      <h1>OGVAULT goes live at {goal.toLocaleString()} Discord members</h1>
      <p className="launch-count"><strong>{members.toLocaleString()}</strong><span>/{goal.toLocaleString()}</span></p>
      <div className="launch-bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={members}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="launch-note">{left > 0 ? `${left.toLocaleString()} more to go. Bring your friends.` : 'Goal reached. Opening now.'}</p>
      {invite ? <a className="btn launch-join" href={invite} target="_blank" rel="noreferrer">Join the Discord</a> : null}
      <p className="launch-live"><span className="dot" /> Live count, bots not included</p>
    </section>
  );
}

export function WebsiteDown({ reason, until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  const left = until ? Math.max(0, until - now) : 0;
  const totalSeconds = Math.floor(left / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  return (
    <section className="website-down">
      <img src="/logo.png" alt="OGVAULT" />
      <h1>{reason || 'Down for maintenance'}</h1>
      {until ? <p className="website-clock">{days ? `${days}d ` : ''}{clock}</p> : null}
    </section>
  );
}
