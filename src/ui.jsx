import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

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
