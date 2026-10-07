let socket = null;
const listeners = new Set();
const pending = [];

const PROD_API_ORIGIN = 'https://api.ogvault.co.uk';

export function apiOrigin() {
  if (!import.meta.env.PROD) return '';
  const fromEnv = String(import.meta.env.VITE_API_ORIGIN || '').trim().replace(/\/$/, '');
  return fromEnv || PROD_API_ORIGIN;
}

export function apiUrl(path) {
  const origin = apiOrigin();
  if (!origin || /^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export function connectWs() {
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  const origin = apiOrigin();
  const url = origin
    ? `${origin.replace(/^http/i, 'ws')}/ws`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  socket = new WebSocket(url);
  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    listeners.forEach((fn) => fn(msg));
  };
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'hello', token: localStorage.getItem('ogv_token') }));
    while (pending.length && socket.readyState === 1) socket.send(pending.shift());
  };
  socket.onclose = () => {
    socket = null;
    setTimeout(connectWs, 1200);
  };
}

export function onWs(fn) {
  listeners.add(fn);
  connectWs();
  return () => listeners.delete(fn);
}

export function sendWs(payload) {
  const raw = JSON.stringify(payload);
  if (socket && socket.readyState === 1) socket.send(raw);
  else {
    pending.push(raw);
    connectWs();
  }
}

export function setToken(token) {
  if (token) localStorage.setItem('ogv_token', token);
  else localStorage.removeItem('ogv_token');
  sendWs({ type: 'hello', token: token || null });
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem('ogv_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = res.status;
    if (data.vpn) window.dispatchEvent(new CustomEvent('ogv:vpn'));
    throw error;
  }
  return data;
}
