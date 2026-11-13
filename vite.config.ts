import { defineConfig } from 'vite';

// __LEADERBOARD_URL__ is replaced at build time; '' disables the leaderboard client path
export default defineConfig({
  define: {
    __LEADERBOARD_URL__: JSON.stringify(process.env['VITE_LEADERBOARD_URL'] ?? ''),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
