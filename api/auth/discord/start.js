import { authorizeUrl, sendPage } from '../../discordPage.js';

export default function handler(req, res) {
  const url = authorizeUrl(req);
  if (!url) {
    sendPage(
      res,
      503,
      'Discord login',
      'Discord login is not configured on this deployment. Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in the host settings, then redeploy.'
    );
    return;
  }
  if (String(req.headers.accept || '').includes('application/json')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ url }));
    return;
  }
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
