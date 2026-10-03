import crypto from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;
const usedStates = new Set();

// Local redirect (APP_ORIGIN unset), received by this API process:
//   http://127.0.0.1:8787/api/auth/discord/callback
// Production when APP_ORIGIN is https://ogvault.co.uk:
//   https://ogvault.co.uk/api/auth/discord/callback

const DISCORD_ENV_NAMES = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];

function discordEnvValue(name) {
  return String(process.env[name] || '').trim();
}

export function discordMissingEnv() {
  return DISCORD_ENV_NAMES.filter((name) => !discordEnvValue(name));
}

export function discordConfigured() {
  return discordMissingEnv().length === 0;
}

export function discordConfigMessage() {
  const missing = discordMissingEnv();
  if (!missing.length) return null;
  return `Discord login is not configured. Missing ${missing.join(' and ')}.`;
}

export function discordRedirectUri() {
  const origin = configuredOrigin();
  if (origin) return `${origin}/api/auth/discord/callback`;
  return 'http://127.0.0.1:8787/api/auth/discord/callback';
}

export function discordAppOrigin() {
  return configuredOrigin() || 'http://127.0.0.1:5173';
}

function configuredOrigin() {
  const configured = process.env.APP_ORIGIN;
  if (!configured) return null;
  let url;
  try {
    url = new URL(configured);
  } catch {
    const error = new Error('APP_ORIGIN is not a valid URL');
    error.status = 500;
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const error = new Error('APP_ORIGIN is not a valid URL');
    error.status = 500;
    throw error;
  }
  return url.origin;
}

export function discordAuthorizeUrl(state, redirectUri = discordRedirectUri()) {
  const clientId = discordEnvValue('DISCORD_CLIENT_ID');
  if (!clientId || !redirectUri) return '';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function createDiscordState() {
  const payload = `${crypto.randomBytes(16).toString('hex')}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', process.env.DISCORD_CLIENT_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function consumeDiscordState(state) {
  const value = String(state || '');
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [nonce, at, sig] = parts;
  if (!/^[a-f0-9]{32}$/.test(nonce) || !/^\d+$/.test(at) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const payload = `${nonce}.${at}`;
  const expected = crypto.createHmac('sha256', process.env.DISCORD_CLIENT_SECRET).update(payload).digest('hex');
  const left = Buffer.from(sig, 'hex');
  const right = Buffer.from(expected, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  const time = Number(at);
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > STATE_TTL_MS) return false;
  if (usedStates.has(value)) return false;
  usedStates.add(value);
  if (usedStates.size > 500) usedStates.delete(usedStates.values().next().value);
  return true;
}

export function discordAvatarUrl(user) {
  if (!user?.discordId || !/^\d{5,32}$/.test(String(user.discordId))) return null;
  const id = String(user.discordId);
  if (user.discordAvatar && /^[A-Za-z0-9_]{2,64}$/.test(user.discordAvatar)) {
    return `https://cdn.discordapp.com/avatars/${id}/${user.discordAvatar}.png`;
  }
  const index = Number((BigInt(id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function discordName(user) {
  if (!user?.discordId) return null;
  const name = String(user.discordGlobalName || user.discordUsername || '').trim();
  return name || null;
}

function clip(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export async function fetchDiscordIdentity(code, redirectUri = discordRedirectUri()) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokenPayload = await tokenRes.json().catch(() => ({}));
  const accessToken = typeof tokenPayload.access_token === 'string' ? tokenPayload.access_token : '';
  if (!tokenRes.ok || !accessToken) {
    console.error('Discord token exchange failed', tokenRes.status);
    const error = new Error('Discord login failed');
    error.status = 502;
    throw error;
  }
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await userRes.json().catch(() => ({}));
  if (!userRes.ok) {
    console.error('Discord user lookup failed', userRes.status);
    const error = new Error('Discord login failed');
    error.status = 502;
    throw error;
  }
  const id = clip(profile.id, 32);
  const username = clip(profile.username, 32);
  const globalName = clip(profile.global_name, 32);
  const avatar = /^[A-Za-z0-9_]{2,64}$/.test(String(profile.avatar || '')) ? String(profile.avatar) : null;
  if (!/^\d{5,32}$/.test(id) || !username) {
    const error = new Error('Discord login failed');
    error.status = 502;
    throw error;
  }
  return { id, username, globalName: globalName || null, avatar };
}
