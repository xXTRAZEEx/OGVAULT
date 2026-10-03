import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const discordClientId = env.VITE_DISCORD_CLIENT_ID || env.DISCORD_CLIENT_ID || '';
  return {
  plugins: [react()],
  define: {
    'import.meta.env.VITE_DISCORD_CLIENT_ID': JSON.stringify(discordClientId),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
  };
});
