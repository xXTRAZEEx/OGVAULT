import crypto from 'crypto';
import Stripe from 'stripe';
import { creditPaidCheckout } from './logic.js';
import { fail, update } from './store.js';

const letters = 'abcdefghijklmnopqrstuvwxyz';
let suffix = '';
for (let i = 0; i < 8; i += 1) suffix += letters[crypto.randomInt(letters.length)];
const integrationIdentifier = `ogvault_wallet_${suffix}`;

let client = null;
let clientKey = '';

export function checkoutConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (client && clientKey === key) return client;
  clientKey = key;
  client = new Stripe(key);
  return client;
}

function requireCheckout() {
  if (!checkoutConfigured()) fail(503, 'Checkout is not configured');
  const stripe = stripeClient();
  if (!stripe) fail(503, 'Checkout is not configured');
  return stripe;
}

export function checkoutOrigin(req) {
  const allowed = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'http:' || url.protocol === 'https:') allowed.add(url.origin);
    } catch {
      fail(500, 'APP_ORIGIN is not a valid URL');
    }
  }
  const header = req.get('origin');
  if (header && allowed.has(header)) return header;
  if (configured) {
    const url = new URL(configured);
    if (allowed.has(url.origin)) return url.origin;
  }
  return 'http://127.0.0.1:5173';
}

export async function createCoinCheckout({ user, amount, referral, origin }) {
  const stripe = requireCheckout();
  const cents = Math.round(amount * 100);
  const coinsLabel = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: user.id,
      integration_identifier: integrationIdentifier,
      success_url: `${origin}/wallet?checkout=success`,
      cancel_url: `${origin}/wallet?checkout=cancel`,
      metadata: {
        userId: user.id,
        tokens: String(amount),
        referral: referral || '',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: cents,
            product_data: {
              name: `${coinsLabel} Coins`,
            },
          },
        },
      ],
    });
    if (!session.url) fail(502, 'Checkout could not be started');
    return { url: session.url };
  } catch (error) {
    if (error.status) throw error;
    console.error('checkout session failed');
    fail(502, 'Checkout could not be started');
  }
}

export function handleStripeWebhook(rawBody, signature) {
  const stripe = requireCheckout();
  if (!signature) fail(400, 'Missing Stripe signature');
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    fail(400, 'Invalid Stripe signature');
  }
  if (event.type !== 'checkout.session.completed') return { received: true };
  update((state) => {
    creditPaidCheckout(state, event.data.object);
  });
  return { received: true };
}
