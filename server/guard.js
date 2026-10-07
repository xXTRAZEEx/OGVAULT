import crypto from 'crypto';
import { fail } from './store.js';

const VPN_TTL_MS = 6 * 60 * 60 * 1000;
const VPN_TIMEOUT_MS = 2500;
const vpnCache = new Map();

export const VPN_MESSAGE = 'VPN detected. Turn off your VPN to prevent further sanctions.';
export const IP_MESSAGE = 'This network is already linked to another OGVAULT account. Only one account is allowed per IP.';

function normalize(ip) {
  const value = String(ip || '').trim();
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

export function clientIp(req) {
  const remote = normalize(req.socket?.remoteAddress);
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded && isPrivate(remote)) return normalize(forwarded);
  return remote;
}

export function isPrivate(ip) {
  const value = normalize(ip);
  if (!value || value === '::1' || value === 'localhost') return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true;
  return /^(fc|fd|fe80)/i.test(value);
}

function ipKey(ip) {
  const salt = String(process.env.IP_HASH_SALT || process.env.DISCORD_BOT_TOKEN || 'ogvault');
  return crypto.createHash('sha256').update(`${salt}:${normalize(ip)}`).digest('hex').slice(0, 32);
}

export function ipOwner(state, ip) {
  if (isPrivate(ip)) return null;
  const owners = state.ipOwners || {};
  const userId = owners[ipKey(ip)];
  if (!userId) return null;
  return state.users.find((user) => user.id === userId && !user.npc) || null;
}

export function assertIpFree(state, ip, user) {
  const owner = ipOwner(state, ip);
  if (owner && owner.id !== user?.id) fail(403, IP_MESSAGE);
}

function exempt(user) {
  const admins = String(process.env.DISCORD_ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  return !!user?.discordId && admins.includes(String(user.discordId));
}

export function claimIp(state, ip, user) {
  if (!user || user.npc || isPrivate(ip) || exempt(user)) return false;
  assertIpFree(state, ip, user);
  state.ipOwners = state.ipOwners || {};
  const key = ipKey(ip);
  if (state.ipOwners[key] === user.id) return false;
  state.ipOwners[key] = user.id;
  return true;
}

export function ownsIp(state, ip, user) {
  if (isPrivate(ip) || exempt(user)) return true;
  return (state.ipOwners || {})[ipKey(ip)] === user.id;
}

async function lookupVpn(ip) {
  const key = String(process.env.PROXYCHECK_KEY || '').trim();
  const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&risk=0${key ? `&key=${encodeURIComponent(key)}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VPN_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const row = data?.[ip];
    if (!row) return null;
    return row.proxy === 'yes';
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function isVpn(ip) {
  if (isPrivate(ip)) return false;
  const cached = vpnCache.get(ip);
  if (cached && cached.until > Date.now()) return cached.vpn;
  const vpn = await lookupVpn(ip);
  if (vpn == null) {
    vpnCache.set(ip, { vpn: false, until: Date.now() + 5 * 60 * 1000 });
    return false;
  }
  vpnCache.set(ip, { vpn, until: Date.now() + VPN_TTL_MS });
  if (vpnCache.size > 20000) vpnCache.delete(vpnCache.keys().next().value);
  return vpn;
}
