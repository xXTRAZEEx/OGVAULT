import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MODES, PLATFORMS, PROJECTS, REGIONS, listingFee, listingPrize, parseEntry } from '../../shared/listings.js';
import { api } from '../api';
import { useApp } from '../App';
import { MatchTable } from './Home';
import { Amount, PageHead, MatchmakingClosed } from '../ui';

export function Play() {
  const { me, setAuth, setMe, toast, rev } = useApp();
  const navigate = useNavigate();
  const [entry, setEntry] = useState('1');
  const [project, setProject] = useState('Eon');
  const [region, setRegion] = useState('EU');
  const [matches, setMatches] = useState([]);
  const [matchmaking, setMatchmaking] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/matches').then((data) => {
      setMatches(data.matches.filter((match) => match.status === 'open'));
      setMatchmaking(data.matchmaking || null);
    }).catch((err) => setError(err.message));
  }, [rev]);

  async function create() {
    if (!me) { setAuth('in'); return; }
    setError('');
    try {
      const amount = parseEntry(entry);
      if (amount == null) throw new Error('Entry must be at least 1 token');
      const data = await api('/api/matches', {
        method: 'POST',
        body: { entry: amount, project, mode: MODES[0], region, platform: PLATFORMS[0] },
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

  if (matchmaking && matchmaking.enabled === false) {
    return <MatchmakingClosed reason={matchmaking.reason} />;
  }

  return (
    <div className="stack-lg">
      <PageHead
        kicker="Listings"
        title="1v1 listings"
        text="Open a lobby for Eon or Retrac. The other player joins, you ready up, and the private room is yours while you play on that project."
      >
        <button className="btn" onClick={quick}>Quick join</button>
      </PageHead>

      <section className="panel create">
        <div>
          <h2>Create a listing</h2>
          <p>Your entry locks when the lobby opens. Winner takes the pot minus a 20% fee. The match itself is played on the project you pick.</p>
          <label>Project
            <select value={project} onChange={(event) => setProject(event.target.value)}>
              {PROJECTS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Mode
            <span className="fixed-field">{MODES[0]}</span>
          </label>
          <div className="pair">
            <label>Region
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                {REGIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Platform
              <span className="fixed-field">{PLATFORMS[0]}</span>
            </label>
          </div>
          <label>Entry
            <input
              type="number"
              min="1"
              step="0.01"
              inputMode="decimal"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
            />
          </label>
          <p className="callout">Fee <Amount value={listingFee(parseEntry(entry) || 0)} /> · Prize <Amount value={listingPrize(parseEntry(entry) || 0)} /></p>
          {error && <p className="error">{error}</p>}
          <button className="btn" onClick={create}>Create listing · <Amount value={parseEntry(entry) || 0} /></button>
        </div>
        <ol className="steps">
          <li><b>Create 1v1.</b> Pick Eon or Retrac, the region, and wager fee. 1 game thats it.</li>
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
