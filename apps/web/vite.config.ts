import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

type Env = Record<string, string | undefined>;

export function viteServerOptions(env: Env) {
  return {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Codespaces forwards via https://<name>-5173.app.github.dev; Vite rejects unknown hosts by default.
    allowedHosts: ['localhost', '.app.github.dev'],
    proxy: {
      '/api': {
        target: env.API_PROXY_TARGET ?? 'http://localhost:3000',
        // Keep the browser's Origin: Better Auth checks it on non-GET requests.
        changeOrigin: false,
        // Rate limiting in the API buckets by x-forwarded-for.
        xfwd: true,
      },
    },
  };
}

const serverOptions = viteServerOptions(process.env);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: serverOptions,
  preview: serverOptions,
  optimizeDeps: { include: ['@shiftswap/shared'] },
  build: {
    commonjsOptions: { include: [/packages\/shared/, /node_modules/] },
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
