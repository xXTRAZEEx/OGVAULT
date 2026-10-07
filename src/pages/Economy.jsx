import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { ago, format, formatDate, useNow } from '../format';
import { Amount, FrameFx, PageHead, Points, Select, Token } from '../ui';

const TX = {
  welcome: 'Welcome',
  deposit: 'Added',
  withdraw: 'Withdrawn',
  entry: 'Entry',
  win: 'Pot',
  refund: 'Refund',
  shop: 'Shop',
  daily: 'Daily',
  referral: 'Referral',
  tip: 'Tip',
  tournament: 'Cup',
  potw: 'Week prize',
  rename: 'Rename',
  blackjack: 'Blackjack',
};

const SHOP_COPY = {
  vip: '30 days. Gold frame, crown, and 10 snipes.',
};

const PORTRAITS = {
  'avatar-heat': 'Heat portrait',
  'avatar-frost': 'Frost portrait',
  'avatar-gold': 'Gold portrait',
};
const MARKS = {
  'avatar-retrac': 'Retrac',
  'avatar-eon': 'Eon',
};
const MARK_ART = {
  'avatar-retrac': '/styles/retrac.png',
  'avatar-eon': '/styles/eon.png',
};
const COLORS = { blue: 'Blue name', gold: 'Gold name' };

function shopBlurb(item) {
  if (SHOP_COPY[item.id]) return SHOP_COPY[item.id];
  return String(item.blurb || '').replace(/cook\s*up/gi, '').trim();
}

function inventoryRows(me, now) {
  if (!me) return [];
  const rows = [];
  if (me.vip && me.vipUntil > now) {
    const days = Math.max(1, Math.ceil((me.vipUntil - now) / 86400000));
    rows.push({ id: 'vip', name: 'OG VIP', detail: `${days} day${days === 1 ? '' : 's'} left` });
  }
  if (me.snipes > 0) rows.push({ id: 'snipes', name: 'Snipes', detail: `${me.snipes} remaining` });
  if (me.shields > 0) rows.push({ id: 'shield', name: 'Streak shield', detail: `${me.shields} ready` });
  for (const id of me.ownedAvatars || []) {
    if (!PORTRAITS[id]) continue;
    rows.push({
      id,
      name: PORTRAITS[id],
      detail: me.avatar === id ? 'Equipped' : 'Owned',
      slot: 'avatar',
      cosmetic: id,
      equipped: me.avatar === id,
    });
  }
  for (const id of me.ownedMarks || []) {
    if (!MARKS[id]) continue;
    rows.push({
      id,
      name: MARKS[id],
      detail: me.chatIcon === id ? 'Equipped' : 'Owned',
      slot: 'mark',
      cosmetic: id,
      equipped: me.chatIcon === id,
    });
  }
  for (const id of me.ownedColors || []) {
    if (!COLORS[id]) continue;
    rows.push({
      id: `color-${id}`,
      name: COLORS[id],
      detail: me.nameColor === id ? 'Equipped' : 'Owned',
      slot: 'color',
      cosmetic: id,
      equipped: me.nameColor === id,
    });
  }
  return rows;
}

function ownsItem(me, item) {
  if (!me) return false;
  if (item.id === 'vip') return !!(me.vip && me.vipUntil > Date.now());
  if (MARKS[item.id]) return (me.ownedMarks || []).includes(item.id);
  if (item.id.startsWith('avatar-')) return (me.ownedAvatars || []).includes(item.id);
  if (item.id === 'color-blue') return (me.ownedColors || []).includes('blue');
  if (item.id === 'color-gold') return (me.ownedColors || []).includes('gold');
  return false;
}

function slotOf(item) {
  if (MARKS[item.id]) return { slot: 'mark', id: item.id, equipped: (me) => me?.chatIcon === item.id };
  if (item.id.startsWith('avatar-')) return { slot: 'avatar', id: item.id, equipped: (me) => me?.avatar === item.id };
  if (item.id === 'color-blue') return { slot: 'color', id: 'blue', equipped: (me) => me?.nameColor === 'blue' };
  if (item.id === 'color-gold') return { slot: 'color', id: 'gold', equipped: (me) => me?.nameColor === 'gold' };
  return null;
}

function ShopPreview({ id }) {
  if (id === 'vip') {
    return (
      <div className="shop-preview" aria-hidden="true">
        <span className="shop-ava vip-sample">
          V
          <svg className="shop-crown" viewBox="0 0 12 12"><path d="M1 9h10L9.5 4 7 6.5 6 3 5 6.5 2.5 4z" fill="#f5c451" /></svg>
          <FrameFx vip />
        </span>
      </div>
    );
  }
  if (id === 'snipes') {
    return (
      <div className="shop-preview" aria-hidden="true">
        <svg className="shop-glyph" viewBox="0 0 32 32">
          <path d="M4 16s4.5-7 12-7 12 7 12 7-4.5 7-12 7S4 16 4 16z" fill="none" stroke="#8eb0ff" strokeWidth="2" />
          <circle cx="16" cy="16" r="3.2" fill="#2f6bff" />
        </svg>
      </div>
    );
  }
  if (id === 'shield') {
    return (
      <div className="shop-preview" aria-hidden="true">
        <svg className="shop-glyph" viewBox="0 0 32 32">
          <path d="M16 4l10 4v8c0 6.2-4.2 10.4-10 12-5.8-1.6-10-5.8-10-12V8z" fill="none" stroke="#8eb0ff" strokeWidth="2" />
          <path d="M11 16l3.2 3.2L21 12.4" fill="none" stroke="#f5c451" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  if (MARK_ART[id]) {
    return (
      <div className="shop-preview" aria-hidden="true">
        <span className="shop-name">
          Player
          <img className={`name-mark ${id === 'avatar-retrac' ? 'retrac' : 'eon'}`} src={MARK_ART[id]} alt="" />
        </span>
      </div>
    );
  }
  if (id.startsWith('avatar-')) {
    return (
      <div className="shop-preview" aria-hidden="true">
        <span className={`shop-ava ring-${id.slice(7)}`}>
          A
          <FrameFx heat={id === 'avatar-heat'} frost={id === 'avatar-frost'} />
        </span>
      </div>
    );
  }
  if (id === 'color-blue' || id === 'color-gold') {
    return (
      <div className="shop-preview" aria-hidden="true">
        <span className={`shop-name ${id === 'color-gold' ? 'c-gold' : 'c-blue'}`}>Player</span>
      </div>
    );
  }
  return null;
}

export function Shop() {
  const { me, setAuth, setMe, toast } = useApp();
  const now = useNow(60000);
  const [shop, setShop] = useState([]);
  const owned = inventoryRows(me, now);
  useEffect(() => { api('/api/shop').then((data) => setShop(data.shop)); }, []);
  useEffect(() => {
    if (window.location.hash === '#inventory') {
      document.getElementById('inventory')?.scrollIntoView();
    }
  }, []);

  async function wear(slot, id, equip) {
    try {
      const data = await api(equip ? '/api/shop/equip' : '/api/shop/unequip', {
        method: 'POST',
        body: equip ? { slot, id } : { slot },
      });
      setMe(data.user);
    } catch (err) { toast(err.message, 'bad'); }
  }

  return (
    <div className="stack-lg">
      <PageHead kicker="Style and edge" title="Shop" text="Spend tokens on VIP, snipes, shields, and marks. Nothing here bills a card." />
      <section className="panel" id="inventory">
        <h2>Inventory</h2>
        {!me && <p className="muted">Sign in to see what you have bought.</p>}
        {me && !owned.length && <p className="muted">You have not bought anything yet.</p>}
        {owned.map((row) => (
          <div className="inv-row" key={row.id}>
            <span>{row.name}</span>
            <span className="muted">{row.detail}</span>
            {row.slot && (
              row.equipped
                ? <button className="btn ghost" onClick={() => wear(row.slot, row.cosmetic, false)}>Unequip</button>
                : <button className="btn ghost" onClick={() => wear(row.slot, row.cosmetic, true)}>Equip</button>
            )}
          </div>
        ))}
      </section>
      <div className="shop-grid">
        {shop.map((item) => {
          const cosmetic = slotOf(item);
          const bought = ownsItem(me, item);
          const equipped = cosmetic ? cosmetic.equipped(me) : false;
          return (
            <article key={item.id} className="panel item">
              <ShopPreview id={item.id} />
              <span className="tag">{item.tag}</span>
              <h2>{item.name}</h2>
              <p>{shopBlurb(item)}</p>
              {bought && cosmetic && equipped && (
                <div className="item-actions">
                  <span className="tag gold">Equipped</span>
                  <button className="btn ghost" onClick={() => wear(cosmetic.slot, cosmetic.id, false)}>Unequip</button>
                </div>
              )}
              {bought && cosmetic && !equipped && (
                <div className="item-actions">
                  <span className="tag">Purchased</span>
                  <button className="btn" onClick={() => wear(cosmetic.slot, cosmetic.id, true)}>Equip</button>
                </div>
              )}
              {bought && !cosmetic && <span className="tag gold">Purchased</span>}
              {!bought && (
                <button className="btn" onClick={async () => {
                  if (!me) { setAuth('in'); return; }
                  try {
                    const data = await api('/api/shop/buy', { method: 'POST', body: { itemId: item.id } });
                    setMe(data.user);
                    toast(`${item.name} is yours`);
                  } catch (err) { toast(err.message, 'bad'); }
                }}>
                  <Token /> {format(item.price)}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

const PACKS = [
  { coins: 5, price: 5, tone: 'blue' },
  { coins: 10, price: 10, tone: 'green' },
  { coins: 15, price: 15, tone: 'purple' },
  { coins: 20, price: 20, tone: 'gold' },
  { coins: 25, price: 25, tone: 'red' },
  { coins: 50, price: 50, tone: 'orange' },
];

const NETWORKS = ['Solana', 'Ethereum', 'Bitcoin'];

function cents(n) {
  const value = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(value) ? value : 0;
}

function gbp(n) {
  return `£${cents(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ChargeLines({ price }) {
  const pack = cents(price);
  if (pack < 1) return null;
  return (
    <div className="pack-charge">
      <p className="pack-price">{gbp(pack)}</p>
    </div>
  );
}

function txLabel(tx) {
  const name = TX[tx.type] || tx.type;
  if (tx.type === 'tip' && tx.meta?.to) return `${name} to ${tx.meta.to}`;
  if (tx.type === 'tip' && tx.meta?.from) return `${name} from ${tx.meta.from}`;
  if (tx.type === 'withdraw' && tx.meta?.method) return `${name} · ${tx.meta.method}`;
  return name;
}

function destinationLine(row) {
  const dest = row.destination || {};
  if (row.method === 'paypal') return dest.email || '';
  if (row.method === 'crypto') return `${dest.network || ''} · ${dest.address || ''}`;
  const tail = String(dest.accountNumber || '').slice(-4);
  return `${dest.accountName || 'Bank'}${tail ? ` · ···${tail}` : ''}`;
}

function dueLabel(readyAt, now) {
  const ms = readyAt - now;
  if (ms <= 0) return 'Ready to process';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m left`;
}

function ReferralBox({ me, onApplied }) {
  const { toast } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const used = me.referredBy;

  async function submit(event) {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const data = await api('/api/rewards/referral', { method: 'POST', body: { code: code.trim() } });
      onApplied(data.user);
      setCode('');
      toast(`Code applied. You and ${data.referredBy} each got ${data.amount} tokens.`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel referral-panel">
      <div>
        <h2>Referral code</h2>
        <p>{used ? 'You have used your one referral code.' : 'Got a code from a friend? You can use one code, once.'}</p>
      </div>
      {used ? (
        <div className="referral-locked">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <span>Used</span>
          <strong>{used}</strong>
        </div>
      ) : (
        <form className="referral-form" onSubmit={submit}>
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter code" aria-label="Referral code" maxLength={12} />
          <button className="btn" type="submit" disabled={busy || !code.trim()}>Apply</button>
        </form>
      )}
    </section>
  );
}

export function Wallet() {
  const { me, setMe, setAuth, toast } = useApp();
  const now = useNow(30000);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'withdraw' || params.get('tab') === 'tips' ? params.get('tab') : 'deposit';
  const [txs, setTxs] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState('crypto');
  const [network, setNetwork] = useState('Solana');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [sortCode, setSortCode] = useState('');
  const [notify, setNotify] = useState(false);
  const [tipAmount, setTipAmount] = useState('');
  const [tipName, setTipName] = useState('');
  const [buying, setBuying] = useState(false);

  function apply(data) {
    setMe(data.user);
    setTxs(data.txs || []);
    setWithdrawals(data.withdrawals || []);
  }

  async function load() {
    apply(await api('/api/wallet'));
  }

  useEffect(() => { if (me) load().catch((err) => toast(err.message, 'bad')); }, [me?.id]);

  useEffect(() => {
    const checkout = params.get('checkout');
    if (!me || (checkout !== 'success' && checkout !== 'cancel')) return;
    if (checkout === 'cancel') toast('Checkout cancelled. No tokens were added.');
    else {
      toast('Payment received. Tokens are added when the payment is confirmed.');
      load().catch((err) => toast(err.message, 'bad'));
    }
    setParams({}, { replace: true });
  }, [me?.id, params]);

  function openTab(next) {
    setParams(next === 'deposit' ? {} : { tab: next }, { replace: true });
  }

  async function buy(raw, method) {
    const value = cents(raw);
    if (value < 1) { toast('Enter a deposit amount', 'bad'); return; }
    if (buying) return;
    setBuying(true);
    try {
      const data = await api('/api/wallet/checkout', { method: 'POST', body: { amount: value, method } });
      if (!data.url) {
        toast('Checkout is not configured', 'bad');
        setBuying(false);
        return;
      }
      window.location.assign(data.url);
    } catch (err) {
      toast(err.message, 'bad');
      setBuying(false);
    }
  }

  const withdrawValue = cents(amount);
  const withdrawFee = withdrawValue > 0 ? 2.5 : 0;
  const withdrawReceive = cents(Math.max(0, withdrawValue - withdrawFee));
  const tipValue = cents(tipAmount);
  const tipFee = me?.vip ? 0 : cents(tipValue * 0.2);
  const tipTotal = cents(tipValue + tipFee);

  if (!me) {
    return (
      <PageHead kicker="Ledger" title="Wallet" text="Sign in to see your tokens.">
        <button className="btn" onClick={() => setAuth('in')}>Sign in</button>
      </PageHead>
    );
  }

  return (
    <div className="stack-lg">
      <PageHead kicker="Ledger" title="Wallet" text="Vault Tokens live on this server. Packs are one pound per coin. Tokens are added after the payment is confirmed. Withdrawals stay pending for 24 hours." />
      <div className="wallet-tabs" role="tablist">
        {[['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['tips', 'Tips']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => openTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'deposit' && (
        <div className="stack">
          <ReferralBox me={me} onApplied={(user) => setMe(user)} />
          <div className="wallet-toolbar">
            <label>Custom amount
              <span className="money">
                <input type="number" min="1" step="0.01" value={custom} onChange={(event) => setCustom(event.target.value)} />
                <b>£</b>
              </span>
            </label>
            <button className="btn" type="button" disabled={buying} onClick={() => buy(custom)}>Deposit</button>
            <button className="btn ghost" type="button" disabled={buying} onClick={() => buy(custom, 'crypto')}>Pay with crypto</button>
          </div>
          <ChargeLines price={custom} />
          <div className="pack-grid">
            {PACKS.map((pack) => (
              <article key={pack.coins} className={`panel pack ${pack.tone}`}>
                <h3><Token size={22} /> {pack.coins} Coins</h3>
                <ChargeLines price={pack.price} />
                <div className="pack-actions">
                  <button className="btn" type="button" disabled={buying} onClick={() => buy(pack.coins)}>Purchase</button>
                  <button className="btn ghost" type="button" disabled={buying} onClick={() => buy(pack.coins, 'crypto')}>Pay with crypto</button>
                </div>
              </article>
            ))}
          </div>
          <p className="muted">One coin is one pound. Card checkout charges that pack in GBP with £2.30 tax included. Pay with crypto opens a NOWPayments page with a QR code and the address. Tokens are added after the payment is confirmed.</p>
        </div>
      )}

      {tab === 'withdraw' && (
        <section className="panel wallet-panel">
          <div className="wallet-balance">
            <div>
              <span>Available balance</span>
              <strong className="huge"><Amount value={me.balance} /></strong>
            </div>
            <p>Minimum withdrawal is 15. A 2.5 fee is taken from that amount. Withdrawals take 24 hours.</p>
          </div>
          <form className="stack" onSubmit={async (event) => {
            event.preventDefault();
            try {
              const data = await api('/api/wallet/withdraw', {
                method: 'POST',
                body: {
                  amount: withdrawValue,
                  method,
                  network,
                  address,
                  email,
                  accountName,
                  accountNumber,
                  sortCode,
                  notify,
                },
              });
              apply(data);
              toast('Withdrawal pending for 24 hours');
              setAmount('');
            } catch (err) { toast(err.message, 'bad'); }
          }}>
            <div className="wallet-fields">
              <label>Method *
                <Select
                  label="Method"
                  value={method}
                  onChange={setMethod}
                  options={[{ value: 'paypal', label: 'PayPal' }, { value: 'crypto', label: 'Crypto' }, { value: 'bank', label: 'Bank' }]}
                />
              </label>
              {method === 'crypto' && (
                <label>Crypto option *
                  <Select label="Crypto option" value={network} onChange={setNetwork} options={NETWORKS} />
                </label>
              )}
              {method === 'paypal' && (
                <label>PayPal email *
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
                </label>
              )}
              {method === 'bank' && (
                <>
                  <label>Account name *
                    <input value={accountName} onChange={(event) => setAccountName(event.target.value)} autoComplete="name" required />
                  </label>
                  <label>Account number *
                    <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} inputMode="numeric" autoComplete="off" required />
                  </label>
                  <label>Sort code or routing *
                    <input value={sortCode} onChange={(event) => setSortCode(event.target.value)} inputMode="numeric" autoComplete="off" required />
                  </label>
                </>
              )}
              <label>Amount *
                <span className="money">
                  <input type="number" min="15" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
                  <b>£</b>
                </span>
              </label>
              {method === 'crypto' && (
                <label>Address *
                  <input value={address} onChange={(event) => setAddress(event.target.value)} spellCheck="false" autoComplete="off" required />
                </label>
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
              I want to receive an email notification when the withdrawal is processed.
            </label>
            <p className="receive">Fee <strong>{gbp(withdrawFee)}</strong> · You receive <strong>{gbp(withdrawReceive)}</strong></p>
            <button className="btn" type="submit">Withdraw</button>
          </form>
          {!!withdrawals.length && (
            <div className="pending-list">
              <h2>Pending</h2>
              {withdrawals.map((row) => (
                <div className="tr tx" key={row.id}>
                  <span>{row.method} · {destinationLine(row)}{row.notify ? ' · email' : ''}</span>
                  <span className="muted">{row.status === 'pending' ? dueLabel(row.readyAt, now) : 'Processed'}</span>
                  <span className="down"><Amount value={-row.amount} />{row.payout != null ? <> · receive <Amount value={row.payout} /></> : null}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'tips' && (
        <section className="panel wallet-panel">
          <div className="wallet-balance">
            <div>
              <span>Balance</span>
              <strong className="huge"><Amount value={me.balance} /></strong>
            </div>
          </div>
          <p className="callout">VIP players send tips fee-free. A 20% fee applies for non-VIP users.</p>
          <form className="stack" onSubmit={async (event) => {
            event.preventDefault();
            try {
              const data = await api('/api/wallet/tip', { method: 'POST', body: { amount: tipValue, username: tipName.trim() } });
              apply(data);
              toast(`Sent ${format(data.tip.receive)} to ${data.tip.username}. Fee ${format(data.tip.fee)}.`);
              setTipAmount('');
              setTipName('');
            } catch (err) { toast(err.message, 'bad'); }
          }}>
            <div className="pair">
              <label>Amount
                <span className="money">
                  <input type="number" min="0.01" step="0.01" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} required />
                  <b>$</b>
                </span>
              </label>
              <label>Username
                <input value={tipName} onChange={(event) => setTipName(event.target.value)} autoComplete="off" required />
              </label>
            </div>
            <p className="receive">
              Fee <Amount value={tipFee} /> · You pay <Amount value={tipTotal} /> · They receive <Amount value={tipValue} />
            </p>
            <button className="btn" type="submit">Tip user</button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>History</h2>
        {txs.map((tx) => (
          <div className="tr tx" key={tx.id}>
            <span>{txLabel(tx)}</span>
            <span className="muted">{ago(tx.at)}</span>
            <span className={tx.amount < 0 ? 'down' : 'up'}><Amount value={tx.amount} plus /></span>
          </div>
        ))}
        {!txs.length && <p className="muted">No lines yet.</p>}
      </section>
    </div>
  );
}

export function Rewards() {
  const { me, setAuth, setMe, toast } = useApp();
  const now = useNow();
  const readyAt = me?.dailyClaimedAt ? me.dailyClaimedAt + 20 * 3600000 : 0;
  const wait = readyAt - now;
  const left = wait > 0 ? `${Math.floor(wait / 3600000)}h ${Math.floor((wait % 3600000) / 60000)}m` : '';

  return (
    <div className="stack-lg">
      <PageHead kicker="Free tokens" title="Rewards" text="A daily drop, a referral code, and VIP if you want the louder version." />
      <div className="wallet-grid">
        <article className="panel">
          <h2>Daily</h2>
          <p className="daily-line"><Amount value={0.01} /> <span>+</span> <Points value={1} /></p>
          <button className="btn" disabled={!me || !!left} onClick={async () => {
            if (!me) { setAuth('in'); return; }
            try {
              const data = await api('/api/rewards/daily', { method: 'POST', body: {} });
              setMe(data.user);
              toast(`+${data.amount} tokens and +${data.points || 0} Vault Points`);
            } catch (err) { toast(err.message, 'bad'); }
          }}>{left ? `Ready in ${left}` : 'Claim daily'}</button>
        </article>
        <article className="panel">
          <h2>Your code</h2>
          {me ? (
            <>
              <p className="code">{me.referral}</p>
              <p className="muted">You and a new player each get 0.05 tokens.</p>
              <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(me.referral); toast('Code copied'); }}>Copy</button>
            </>
          ) : <button className="btn" onClick={() => setAuth('up')}>Register to get a code</button>}
        </article>
        <article className="panel">
          <h2>OG VIP</h2>
          <p>30 days. Gold frame, crown, and 10 snipes.</p>
          <p className="muted">{me?.vip ? `Active until ${formatDate(me.vipUntil)}.` : 'Buy it in the shop.'}</p>
        </article>
      </div>
    </div>
  );
}
