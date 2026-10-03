import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../App';
import { ago, format, formatDate, useNow } from '../format';
import { Amount, PageHead, Token } from '../ui';

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
};

export function Shop() {
  const { me, setAuth, setMe, toast } = useApp();
  const [shop, setShop] = useState([]);
  useEffect(() => { api('/api/shop').then((data) => setShop(data.shop)); }, []);
  return (
    <div className="stack-lg">
      <PageHead kicker="Style and edge" title="Shop" text="Spend tokens on VIP, snipes, shields, and marks. Nothing here bills a card." />
      <div className="shop-grid">
        {shop.map((item) => (
          <article key={item.id} className="panel item">
            <span className="tag">{item.tag}</span>
            <h2>{item.name}</h2>
            <p>{item.blurb}</p>
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
          </article>
        ))}
      </div>
    </div>
  );
}

const PACKS = [
  { coins: 5, price: 5, tone: 'blue' },
  { coins: 10, price: 10, tone: 'gold' },
  { coins: 15, price: 15, tone: 'blue' },
  { coins: 20, price: 20, tone: 'green' },
  { coins: 25, price: 25, tone: 'gold' },
  { coins: 50, price: 50, tone: 'green' },
];

const NETWORKS = ['Solana', 'Ethereum', 'Bitcoin'];

function cents(n) {
  const value = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(value) ? value : 0;
}

function usd(n) {
  return `$${cents(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function Wallet() {
  const { me, setMe, setAuth, toast } = useApp();
  const now = useNow(30000);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'withdraw' || params.get('tab') === 'tips' ? params.get('tab') : 'deposit';
  const [txs, setTxs] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [custom, setCustom] = useState('');
  const [referral, setReferral] = useState('');
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
      toast('Payment received. Tokens are added when Stripe confirms the checkout.');
      load().catch((err) => toast(err.message, 'bad'));
    }
    setParams({}, { replace: true });
  }, [me?.id, params]);

  function openTab(next) {
    setParams(next === 'deposit' ? {} : { tab: next }, { replace: true });
  }

  async function buy(raw) {
    const value = cents(raw);
    if (value < 1) { toast('Enter a deposit amount', 'bad'); return; }
    if (buying) return;
    setBuying(true);
    try {
      const data = await api('/api/wallet/checkout', { method: 'POST', body: { amount: value, referral: referral.trim() } });
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
  const tipValue = cents(tipAmount);
  const tipFee = me?.vip ? 0 : cents(tipValue * 0.05);
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
      <PageHead kicker="Ledger" title="Wallet" text="Vault Tokens live on this server. Packs are one US dollar per coin and open checkout. Tokens are added after the payment is confirmed. Withdrawals stay pending for 24 hours." />
      <div className="wallet-tabs" role="tablist">
        {[['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['tips', 'Tips']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => openTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'deposit' && (
        <div className="stack">
          <div className="wallet-toolbar">
            <label>Custom amount
              <span className="money">
                <input type="number" min="1" step="0.01" value={custom} onChange={(event) => setCustom(event.target.value)} />
                <b>$</b>
              </span>
            </label>
            <button className="btn" type="button" disabled={buying} onClick={() => buy(custom)}>Deposit</button>
            <label>Referral code <span>(optional)</span>
              <input value={referral} onChange={(event) => setReferral(event.target.value)} autoComplete="off" />
            </label>
          </div>
          <div className="pack-grid">
            {PACKS.map((pack) => (
              <article key={pack.coins} className={`panel pack ${pack.tone}`}>
                <h3><Token size={22} /> {pack.coins} Coins</h3>
                <button className="btn" type="button" disabled={buying} onClick={() => buy(pack.coins)}>${pack.price} PURCHASE</button>
              </article>
            ))}
          </div>
          <p className="muted">One coin is one US dollar. Checkout charges that amount, and the tokens are added after the payment is confirmed.</p>
        </div>
      )}

      {tab === 'withdraw' && (
        <section className="panel wallet-panel">
          <div className="wallet-balance">
            <div>
              <span>Available balance</span>
              <strong className="huge"><Amount value={me.balance} /></strong>
            </div>
            <p>Minimum withdrawal is 15. Withdrawals take 24 hours.</p>
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
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="paypal">PayPal</option>
                  <option value="crypto">Crypto</option>
                  <option value="bank">Bank</option>
                </select>
              </label>
              {method === 'crypto' && (
                <label>Crypto option *
                  <select value={network} onChange={(event) => setNetwork(event.target.value)}>
                    {NETWORKS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
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
                  <b>USD</b>
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
            <p className="receive">You receive <strong>{usd(withdrawValue)}</strong></p>
            <button className="btn" type="submit">Withdraw</button>
          </form>
          {!!withdrawals.length && (
            <div className="pending-list">
              <h2>Pending</h2>
              {withdrawals.map((row) => (
                <div className="tr tx" key={row.id}>
                  <span>{row.method} · {destinationLine(row)}{row.notify ? ' · email' : ''}</span>
                  <span className="muted">{row.status === 'pending' ? dueLabel(row.readyAt, now) : 'Processed'}</span>
                  <span className="down"><Amount value={-row.amount} /></span>
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
          <p className="callout">VIP players send tips fee-free. A 5% fee applies for non-VIP users.</p>
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
          <p>{me?.vip ? '3 tokens because you are VIP.' : '1.5 tokens. VIP lifts it to 3.'}</p>
          <button className="btn" disabled={!me || !!left} onClick={async () => {
            if (!me) { setAuth('in'); return; }
            try {
              const data = await api('/api/rewards/daily', { method: 'POST', body: {} });
              setMe(data.user);
              toast(`+${data.amount} tokens`);
            } catch (err) { toast(err.message, 'bad'); }
          }}>{left ? `Ready in ${left}` : 'Claim daily'}</button>
        </article>
        <article className="panel">
          <h2>Your code</h2>
          {me ? (
            <>
              <p className="code">{me.referral}</p>
              <p className="muted">{me.vip ? 'You and a new player each get 8 tokens.' : 'You and a new player each get 3. VIP lifts that to 8.'}</p>
              <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(me.referral); toast('Code copied'); }}>Copy</button>
            </>
          ) : <button className="btn" onClick={() => setAuth('up')}>Register to get a code</button>}
        </article>
        <article className="panel">
          <h2>OG VIP</h2>
          <p>30 tokens, 30 days. Gold frame, crown, 10 snipes, richer daily, bigger referrals.</p>
          <p className="muted">{me?.vip ? `Active until ${formatDate(me.vipUntil)}.` : 'Buy it in the shop.'}</p>
        </article>
      </div>
    </div>
  );
}
