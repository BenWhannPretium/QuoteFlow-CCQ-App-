import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    // Must come before react(): generates src/routeTree.gen.ts from src/routes/.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  // `vite preview` serves the production build against a dev-mode API (Playwright shell tests).
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Vendor chunks change less often than app code, so browsers keep them cached across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@azure/msal')) return 'msal';
          if (/[\\/](radix-ui|@radix-ui|@floating-ui)[\\/]/.test(id)) return 'radix';
          if (id.includes('@tanstack')) return 'tanstack';
          if (/[\\/]zod[\\/]/.test(id)) return 'zod';
          return 'vendor';
        },
      },
      onwarn(warning, warn) {
        // zod 4 ships /*#__PURE__*/ comments Rollup can't place; harmless noise.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/zod/')) return;
        warn(warning);
      },
    },
  },
});
