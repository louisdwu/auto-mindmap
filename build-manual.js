import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

const config = defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

build(config).catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
