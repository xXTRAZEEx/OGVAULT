import { useEffect, useState } from 'react';

export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function withZone(path) {
  const tz = encodeURIComponent(viewerTimeZone());
  return `${path}${path.includes('?') ? '&' : '?'}tz=${tz}`;
}

export function formatDate(ts, options = {}) {
  return new Date(ts).toLocaleDateString(undefined, {
    ...options,
    timeZone: viewerTimeZone(),
  });
}

export function format(n) {
  const value = Math.round(Number(n || 0) * 100) / 100;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function ago(ts) {
  const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const delay = ms >= 1000 ? Math.max(200, ms - (current % ms)) : ms;
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, ms >= 1000 ? Math.max(200, ms - (Date.now() % ms)) : ms);
    const wake = () => setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [ms]);
  return now;
}

export function parts(endsAt, now) {
  const left = Math.max(0, Math.floor((endsAt - now) / 1000));
  return {
    d: Math.floor(left / 86400),
    h: Math.floor((left % 86400) / 3600),
    m: Math.floor((left % 3600) / 60),
    s: left % 60,
  };
}

export function pad(n) {
  return String(n).padStart(2, '0');
}
