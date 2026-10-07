import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MODES, PLATFORMS, PROJECTS, REGIONS, listingFee, listingPrize, parseEntry } from '../../shared/listings.js';
import { api } from '../api';
import { useApp } from '../App';
import { MatchTable } from './Home';
import { Amount, PageHead, PointIcon, Points, Select, Stake, Token } from '../ui';

export function Play() {
  const { me, setAuth, setMe, toast, rev } = useApp();
  const navigate = useNavigate();
  const [entry, setEntry] = useState('1');
  const [project, setProject] = useState('Eon');
  const [region, setRegion] = useState('EU');
  const [currency, setCurrency] = useState('tokens');
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/matches').then((data) => setMatches(data.matches.filter((match) => match.status === 'open'))).catch((err) => setError(err.message));
  }, [rev]);

  const pointsMode = currency === 'points';
  const stake = pointsMode ? Math.max(0, Math.floor(Number(entry) || 0)) : parseEntry(entry) || 0;
  const have = pointsMode ? me?.points || 0 : me?.balance || 0;

  async function create() {
    if (!me) { setAuth('in'); return; }
    setError('');
    try {
      const amount = pointsMode ? Math.floor(Number(entry)) : parseEntry(entry);
      if (amount == null || !(amount >= 1)) throw new Error(pointsMode ? 'Entry must be at least 1 Vault Point' : 'Entry must be at least 1 token');
      const data = await api('/api/matches', {
        method: 'POST',
        body: { entry: amount, currency, project, mode: MODES[0], region, platform: PLATFORMS[0] },
      });
      if (data.user) setMe(data.user);
      navigate(`/match/${data.match.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function quick() {
    if (!me) { setAuth('in'); return; }
    try {
      const data = await api('/api/matches/quick', { method: 'POST', body: {} });
      if (data.user) setMe(data.user);
      navigate(`/match/${data.match.id}`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  return (
    <div className="stack-lg">
      <PageHead
        kicker="Listings"
        title="Kill Race listings"
        text="Open a lobby for Eon or Retrac. The other player joins, you ready up, and the private room is yours while you play on that project."
      >
        <button className="btn" onClick={quick}>Quick join</button>
      </PageHead>

      <section className="panel create">
        <div>
          <h2>Create a listing</h2>
          <p>Your entry locks when the lobby opens. Winner takes the pot minus a 20% fee. The match itself is played on the project you pick.</p>
          <label>Project
            <Select label="Project" value={project} onChange={setProject} options={PROJECTS} />
          </label>
          <label>Mode
            <span className="fixed-field">{MODES[0]}</span>
          </label>
          <div className="pair">
            <label>Region
              <Select label="Region" value={region} onChange={setRegion} options={REGIONS} />
            </label>
            <label>Platform
              <span className="fixed-field">{PLATFORMS[0]}</span>
            </label>
          </div>
          <div className="field-label">Play for</div>
          <div className="currency-pick" role="radiogroup" aria-label="Play for">
            <button
              type="button"
              role="radio"
              aria-checked={!pointsMode}
              className={!pointsMode ? 'on' : ''}
              onClick={() => setCurrency('tokens')}
            >
              <Token size={18} />
              <span><b>Vault Tokens</b><small>Real prize · 20% fee</small></span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={pointsMode}
              className={`points ${pointsMode ? 'on' : ''}`}
              onClick={() => { setCurrency('points'); setEntry((value) => String(Math.max(1, Math.floor(Number(value) || 1)))); }}
            >
              <PointIcon size={18} />
              <span><b>Vault Points</b><small>Free to play · no fee</small></span>
            </button>
          </div>
          <label>Entry {me && <small className="have">You have <Stake value={have} currency={currency} /></small>}
            <input
              type="number"
              min="1"
              step={pointsMode ? '1' : '0.01'}
              inputMode={pointsMode ? 'numeric' : 'decimal'}
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
            />
          </label>
          {pointsMode ? (
            <p className="callout points-callout">No fee · Prize <Points value={stake * 2} /></p>
          ) : (
            <p className="callout">Fee <Amount value={listingFee(stake)} /> · Prize <Amount value={listingPrize(stake)} /></p>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn" onClick={create}>Create listing · <Stake value={stake} currency={currency} /></button>
        </div>
        <ol className="steps">
          <li><b>Create a Kill Race.</b> Pick Eon or Retrac, the region, and wager amount. 1 game thats it.</li>
          <li><b>Drop In.</b> Both players ready up at the same time and play one match.</li>
          <li><b>Win.</b> Whoever gets the most kills in one match wins.</li>
        </ol>
      </section>

      <section className="panel">
        <div className="section-h">
          <h2>Open listings</h2>
          <Link to="/how-to-play">How a lobby works</Link>
        </div>
        <MatchTable matches={matches} setAuth={setAuth} />
      </section>
    </div>
  );
}
