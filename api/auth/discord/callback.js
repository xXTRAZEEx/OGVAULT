const API_ORIGIN = 'https://api.ogvault.co.uk';

function queryString(req) {
  const params = new URLSearchParams();
  const query = req.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (value != null) {
      params.append(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export default function handler(req, res) {
  const target = `${API_ORIGIN}/api/auth/discord/callback${queryString(req)}`;
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
