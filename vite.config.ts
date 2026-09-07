import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // elkjs is CommonJS and is reached only through a dynamic `import()` in
  // `src/lib/elk.ts`, so the dev server would otherwise discover it the first
  // time somebody runs an auto-layout — and pay for that with a full page
  // reload in the middle of the session. Naming it here pre-bundles it at
  // startup instead. The production build needs nothing: Rollup splits the
  // dynamic import into its own chunk on its own.
  optimizeDeps: {
    include: ['elkjs/lib/elk.bundled.js'],
  },
  server: {
    port: 5199,
    allowedHosts: ['whimsical.vedalogy.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // The collaboration socket. `ws` makes the proxy forward the upgrade
      // rather than answering it; without `changeOrigin`, so the request
      // reaches the API with the origin the browser sent — which is what the
      // session cookie is scoped to. In production one process serves both and
      // there is nothing to proxy.
      '/collab': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
