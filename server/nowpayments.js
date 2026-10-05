import crypto from 'crypto';
import { creditNowPayment, cryptoPriceGbp } from './logic.js';
import { fail, update } from './store.js';
import { notifyPayment } from './discordAdmin.js';

export function nowPaymentsConfigured() {
  return Boolean(String(process.env.NOWPAYMENTS_API_KEY || '').trim() && String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim());
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortValue(value[key]);
      return result;
    }, {});
}

export function nowPaymentsSignature(body, secret) {
  return crypto.createHmac('sha512', secret).update(JSON.stringify(sortValue(body))).digest('hex');
}

export async function createNowInvoice({ user, amount, origin }) {
  if (!nowPaymentsConfigured()) fail(503, 'Crypto deposits are not switched on yet');
  const price = cryptoPriceGbp(amount);
  const orderId = `np_${user.id}_${Date.now()}`;
  const coinsLabel = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const response = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.NOWPAYMENTS_API_KEY.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount: price,
      price_currency: 'gbp',
      order_id: orderId,
      order_description: `${coinsLabel} Coins. Fee included £3`,
      ipn_callback_url: 'https://api.ogvault.co.uk/api/nowpayments/ipn',
      success_url: `${origin}/wallet?checkout=success`,
      cancel_url: `${origin}/wallet?checkout=cancel`,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.invoice_url) {
    console.error('nowpayments invoice failed', response.status);
    fail(502, 'Crypto checkout could not be started');
  }
  update((state) => {
    if (!Array.isArray(state.nowInvoices)) state.nowInvoices = [];
    state.nowInvoices.unshift({
      orderId,
      invoiceId: String(payload.id || ''),
      userId: user.id,
      username: user.username,
      tokens: amount,
      price,
      createdAt: Date.now(),
    });
    if (state.nowInvoices.length > 400) state.nowInvoices.length = 400;
  });
  return { url: payload.invoice_url };
}

export async function handleNowIpn(body, signature) {
  const secret = String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim();
  if (!secret || !signature) fail(400, 'Missing NOWPayments signature');
  const expected = nowPaymentsSignature(body, secret);
  const left = Buffer.from(String(signature));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) fail(400, 'Invalid NOWPayments signature');
  const status = String(body.payment_status || '');
  const result = update((state) => creditNowPayment(state, body));
  if (result.credited > 0 || status === 'partially_paid') {
    notifyPayment({
      method: 'Crypto',
      username: result.username,
      tokens: result.credited || result.tokens,
      amount: `£${Number(result.price || 0).toFixed(2)}`,
      status,
      reference: String(body.payment_id || ''),
    }).catch(() => {});
  }
  return { received: true };
}
