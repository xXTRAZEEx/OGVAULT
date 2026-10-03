import { useState } from 'react';
import { Link } from 'react-router-dom';

export function Token({ size = 14 }) {
  return (
    <svg className="token" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#2f6bff" />
      <circle cx="8" cy="8" r="3.1" fill="none" stroke="#fff" strokeWidth="1.3" />
      <path d="M8 1.8v2.1M8 12.1v2.1M1.8 8h2.1M12.1 8h2.1" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
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

export function Avatar({ user, size = 40 }) {
  const [broken, setBroken] = useState(false);
  const photo = !broken && user?.discordAvatarUrl;
  if (photo) {
    return (
      <span className={`avatar has-photo ${user?.vip ? 'vip' : ''}`} style={{ width: size, height: size }}>
        <img src={photo} alt="" width={size} height={size} onError={() => setBroken(true)} />
      </span>
    );
  }
  const [from, to] = PALETTES[user?.avatar] || PALETTES.default;
  return (
    <span
      className={`avatar ${user?.vip ? 'vip' : ''}`}
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${from}, ${to})`, fontSize: size * 0.4 }}
    >
      {(user?.username || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

function Crown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 9h10L9.5 4 7 6.5 6 3 5 6.5 2.5 4z" fill="#f5c451" />
    </svg>
  );
}

function Flame() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1s2 2.2 2 4.2c0 1-.6 1.6-1.2 1.6.8-.2 1.7-1 1.7-2.2C10 7 8.4 10 6 10S2 7.2 2 5c0-1.2.8-2 1.4-2.6C4 4 4.6 5 5.2 5 5 3.4 6 1 6 1z" fill="#ff8a4c" />
    </svg>
  );
}

export function Name({ user, link = false }) {
  if (!user) return null;
  const body = (
    <span className={`uname c-${user.nameColor || 'default'}`}>
      {user.chatIcon === 'crown' && <Crown />}
      {user.chatIcon === 'flame' && <Flame />}
      {user.username}
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
