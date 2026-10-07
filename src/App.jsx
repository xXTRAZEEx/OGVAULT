import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, onWs, setToken } from './api';
import { Shell } from './shell';
import { VpnNotice, WebsiteDown } from './ui';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { Match } from './pages/Match';
import { Leaderboard, Potw } from './pages/Boards';
import { Shop, Wallet, Rewards } from './pages/Economy';
import { Blackjack } from './pages/Blackjack';
import { Friends, Profile, HowTo, Legal } from './pages/Social';

const Ctx = createContext(null);
export function useApp() {
  return useContext(Ctx);
}

function PageEnter({ children }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [auth, setAuth] = useState(null);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 1100);
  const [rev, setRev] = useState(0);
  const [news, setNews] = useState(() => localStorage.getItem('ogv_news') !== 'listings');
  const [website, setWebsite] = useState(null);

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 3400);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!localStorage.getItem('ogv_token')) {
      setMe(null);
      setActiveMatchId(null);
      setReady(true);
      return null;
    }
    try {
      const data = await api('/api/me');
      setMe(data.user);
      setActiveMatchId(data.activeMatchId || null);
      return data.user;
    } catch {
      setToken(null);
      setMe(null);
      setActiveMatchId(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('discord_token');
    const discordError = params.get('discord_error');
    const isNew = params.get('discord_new') === '1';
    if (token || discordError) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    if (token) setToken(token);
    if (discordError) {
      toast(discordError, 'bad');
      setAuth('in');
    }
    refreshMe().then((user) => {
      if (!token) return;
      if (!user) {
        toast('Discord login failed. Try again.', 'bad');
        setAuth('in');
        return;
      }
      toast(isNew ? 'Vault open.' : `Welcome back, ${user.discordName || user.username}`);
    });
  }, [refreshMe, toast]);

  useEffect(() => onWs((msg) => {
    if (msg.type === 'lobby') setRev((n) => n + 1);
    if (msg.type === 'lobby' || msg.type === 'match') refreshMe();
  }), [refreshMe]);

  useEffect(() => {
    let stop = false;
    const pull = () => {
      api('/api/health')
        .then((data) => { if (!stop) setWebsite(data.website || { offline: false }); })
        .catch(() => {});
    };
    pull();
    const id = setInterval(pull, 10000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* session already gone */
    }
    setToken(null);
    setMe(null);
    setActiveMatchId(null);
    toast('Signed out');
  };

  if (website?.offline) return <WebsiteDown reason={website.reason} until={website.until} />;

  return (
    <Ctx.Provider value={{ me, setMe, activeMatchId, ready, toast, auth, setAuth, chatOpen, setChatOpen, rev, refreshMe, news, setNews, signOut, toasts }}>
      <VpnNotice />
      <Shell>
        <PageEnter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/match/:id" element={<Match />} />
          <Route path="/tournaments" element={<Navigate to="/play" replace />} />
          <Route path="/tournaments/:id" element={<Navigate to="/play" replace />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/weekly" element={<Potw />} />
          <Route path="/potw" element={<Potw />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/blackjack" element={<Blackjack />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/how-to-play" element={<HowTo />} />
          <Route path="/u/:name" element={<Profile />} />
          <Route path="/legal/:slug" element={<Legal />} />
          <Route path="*" element={<Home missing />} />
        </Routes>
        </PageEnter>
      </Shell>
    </Ctx.Provider>
  );
}
