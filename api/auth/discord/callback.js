import { finishDiscordLogin, sendPage } from '../../discordPage.js';

export default async function handler(req, res) {
  if (req.query?.error) {
    sendPage(res, 400, 'Discord login cancelled', 'Discord sent you back without signing in. Try Continue with Discord again.');
    return;
  }
  try {
    const profile = await finishDiscordLogin(req);
    const name = profile.globalName || profile.username;
    sendPage(
      res,
      200,
      'Discord connected',
      `Discord recognized ${name}. This Vercel site does not run the OGVAULT game server, so a vault session was not saved. Point ogvault.co.uk at the host that runs the API, then sign in again.`
    );
  } catch (error) {
    sendPage(res, error.status || 502, 'Discord login', error.message || 'Discord login failed. Try again.');
  }
}
