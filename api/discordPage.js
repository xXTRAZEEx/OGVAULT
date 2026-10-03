import { discordAuthorizeUrl, createDiscordState, fetchDiscordIdentity } from '../server/discord.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

export function requestOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (!forwarded) return '';
  return `${proto}://${forwarded}`;
}

export function callbackUri(req) {
  const origin = requestOrigin(req);
  return origin ? `${origin}/api/auth/discord/callback` : '';
}

export function authorizeUrl(req) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return '';
  try {
    return discordAuthorizeUrl(createDiscordState(), callbackUri(req));
  } catch {
    return '';
  }
}

export function sendPage(res, status, title, message) {
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;min-height:100vh;background:#07080d;color:#f4f7fb;font-family:Segoe UI,sans-serif;display:grid;place-items:center">
  <main style="max-width:34rem;padding:24px">
    <h1 style="font-size:1.45rem;margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="line-height:1.5;margin:0 0 16px">${escapeHtml(message)}</p>
    <p style="margin:0"><a href="/" style="color:#8eb0ff">Back to OGVAULT</a></p>
  </main>
</body>
</html>`;
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export async function finishDiscordLogin(req) {
  const redirectUri = callbackUri(req);
  const code = String(req.query?.code || '');
  if (!code || !redirectUri) {
    const error = new Error('Discord did not return a login code');
    error.status = 400;
    throw error;
  }
  if (!process.env.DISCORD_CLIENT_SECRET) {
    const error = new Error('Discord login is not configured on this deployment');
    error.status = 503;
    throw error;
  }
  return fetchDiscordIdentity(code, redirectUri);
}
