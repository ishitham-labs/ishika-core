import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  publicDir: 'apps/viewer/public',
  plugins: [react()],
  resolve: {
    alias: {
      '@ishika/controls': path.resolve(__dirname, 'packages/controls/src'),
      '@ishika/streaming': path.resolve(__dirname, 'packages/streaming/src'),
      '@ishika/vision': path.resolve(__dirname, 'packages/vision/src'),
      '@ishika/simulator': path.resolve(__dirname, 'packages/simulator/src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
