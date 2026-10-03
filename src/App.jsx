import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api, onWs, setToken } from './api';
import { Shell } from './shell';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { Match } from './pages/Match';
import { Tournaments, Tournament, Leaderboard, Potw } from './pages/Boards';
import { Shop, Wallet, Rewards } from './pages/Economy';
import { Friends, Profile, HowTo, Legal } from './pages/Social';

const Ctx = createContext(null);
export function useApp() {
  return useContext(Ctx);
}

export default function App() {
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [auth, setAuth] = useState(null);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 1100);
  const [rev, setRev] = useState(0);
  const [news, setNews] = useState(() => localStorage.getItem('ogv_news') !== 'listings');

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 3400);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!localStorage.getItem('ogv_token')) {
      setMe(null);
      setReady(true);
      return null;
    }
    try {
      const data = await api('/api/me');
      setMe(data.user);
      return data.user;
    } catch {
      setToken(null);
      setMe(null);
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
      toast(isNew ? 'Vault open. 25 tokens are on your balance.' : `Welcome back, ${user.discordName || user.username}`);
    });
  }, [refreshMe, toast]);

  useEffect(() => onWs((msg) => {
    if (msg.type === 'lobby') setRev((n) => n + 1);
  }), []);

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* session already gone */
    }
    setToken(null);
    setMe(null);
    toast('Signed out');
  };

  return (
    <Ctx.Provider value={{ me, setMe, ready, toast, auth, setAuth, chatOpen, setChatOpen, rev, refreshMe, news, setNews, signOut, toasts }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/match/:id" element={<Match />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/:id" element={<Tournament />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/potw" element={<Potw />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/how-to-play" element={<HowTo />} />
          <Route path="/u/:name" element={<Profile />} />
          <Route path="/legal/:slug" element={<Legal />} />
          <Route path="*" element={<Home missing />} />
        </Routes>
      </Shell>
    </Ctx.Provider>
  );
}
