import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages supplies the repository path; local development stays at /.
  base: process.env.PAGES_BASE_PATH || '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/examples/')) return 'three-extras';
          if (id.includes('/node_modules/three/')) return 'three';
        },
      },
    },
  },
});
