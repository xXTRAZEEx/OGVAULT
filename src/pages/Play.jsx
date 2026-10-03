import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FIRST_TO, MODES, PLATFORMS, PROJECTS, REGIONS } from '../../shared/listings.js';
import { api } from '../api';
import { useApp } from '../App';
import { MatchTable } from './Home';
import { Amount, PageHead } from '../ui';

const PRESETS = [0.5, 1, 2, 5, 10, 25];

export function Play() {
  const { me, setAuth, setMe, toast, rev } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(0.5);
  const [opponent, setOpponent] = useState(params.get('vs') || '');
  const [project, setProject] = useState('Eon');
  const [mode, setMode] = useState(MODES[0]);
  const [region, setRegion] = useState('EU');
  const [platform, setPlatform] = useState('All');
  const [firstTo, setFirstTo] = useState(1);
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/matches').then((data) => setMatches(data.matches.filter((match) => match.status === 'open'))).catch((err) => setError(err.message));
  }, [rev]);

  async function create() {
    if (!me) { setAuth('in'); return; }
    setError('');
    try {
      const data = await api('/api/matches', {
        method: 'POST',
        body: { entry: Number(entry), opponent, project, mode, region, platform, firstTo },
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
        title="1v1 listings"
        text="Open a lobby for Eon or Retrac. The other player joins, you ready up, and the private room is yours while you play on that project."
      >
        <button className="btn" onClick={quick}>Quick join</button>
      </PageHead>

      <section className="panel create">
        <div>
          <h2>Create a listing</h2>
          <p>Your entry locks when the lobby opens. Winner takes the pot minus a 5% fee. The match itself is played on the project you pick.</p>
          <label>Project
            <select value={project} onChange={(event) => setProject(event.target.value)}>
              {PROJECTS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Mode
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              {MODES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="pair">
            <label>Region
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                {REGIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Platform
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                {PLATFORMS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label>First to
            <div className="seg">
              {FIRST_TO.map((value) => (
                <button type="button" key={value} className={firstTo === value ? 'on' : ''} onClick={() => setFirstTo(value)}>{value}</button>
              ))}
            </div>
          </label>
          <div className="presets">
            {PRESETS.map((value) => (
              <button key={value} className={Number(entry) === value ? 'on' : ''} onClick={() => setEntry(value)}>
                <Amount value={value} />
              </button>
            ))}
          </div>
          <label>Custom entry
            <input type="number" min="0.5" max="100" step="0.5" value={entry} onChange={(event) => setEntry(event.target.value)} />
          </label>
          <label>Challenge a username <span>(optional, private listing)</span>
            <input value={opponent} onChange={(event) => setOpponent(event.target.value)} placeholder="username" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn" onClick={create}>Create listing · <Amount value={entry || 0} /></button>
        </div>
        <ol className="steps">
          <li><b>List it.</b> Pick Eon or Retrac, the mode, region, and first to.</li>
          <li><b>Ready up.</b> Both players sit in the lobby and mark ready. The private room stays open.</li>
          <li><b>Play there.</b> Load into the project, play the 1v1, then both report the winner here.</li>
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
