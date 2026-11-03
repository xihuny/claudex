import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const API = "http://127.0.0.1:8090";
// Remote dev: expose the dev server publicly with live HMR. The HMR websocket
// must tunnel back through the public https port - Tailscale Funnel uses :10000,
// a Cloudflare named tunnel on a custom domain uses :443. Set DEV_HMR_PORT.
const remote = process.env.DEV_REMOTE === "1";
const hmrPort = Number(process.env.DEV_HMR_PORT || 10000);
// A per-build id, baked in at build time, so the running client can show which
// build it actually loaded (cuts through service-worker cache confusion).
const BUILD_ID = new Date().toISOString().slice(5, 16).replace("T", " ");

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Claudex",
        short_name: "Claudex",
        description: "Run Claude Code across projects from any device.",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0b",
        theme_color: "#0a0a0b",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Anything the browser might treat as a navigation (opening an upload in a tab)
        // must bypass the SPA shell fallback and reach the server.
        navigateFallbackDenylist: [/^\/api/, /^\/ws/, /^\/upload/],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // The CodeMirror editor and its ~105 per-language grammar chunks (≈1 MB together)
        // are reachable only by opening a text file in the Files panel, yet precaching
        // them made every install and every update pull that megabyte down before the app
        // was usable - over a tunnel, on a phone, for a feature most sessions never touch.
        // They're routed into assets/ondemand/ by chunkFileNames below and cached at
        // runtime on first use instead (CacheFirst, safe because the filenames are
        // content-hashed, so a stale entry can never be served for a newer build).
        globIgnores: ["**/assets/ondemand/**"],
        // purgeOnQuotaError lets the bucket be dropped under storage pressure instead of
        // failing writes forever.
        runtimeCaching: [
          {
            // The editor chunks excluded from the precache above. Content-hashed and
            // therefore immutable, so CacheFirst is exact: a hit is always the right file.
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/ondemand/"),
            handler: "CacheFirst",
            options: {
              cacheName: "editor-chunks",
              expiration: { maxEntries: 160, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
        importScripts: ["push-sw.js"],   // adds the push + notificationclick handlers
        skipWaiting: true,    // activate the new SW immediately instead of waiting for all tabs to close
        clientsClaim: true,   // take control of the open PWA at once, so a rebuild reaches the device
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // React moves far less often than app code. Splitting it out means a routine
        // deploy invalidates the app chunk only, and the runtime stays in the SW cache
        // across updates instead of being re-downloaded with every build.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
        },
        // Editor-only chunks get their own directory so the service worker can keep them
        // out of the precache (see globIgnores above). A chunk qualifies only if EVERY
        // module in it is CodeMirror/Lezer or the CodeEditor component itself - a chunk
        // that also contains shared app code must stay precached with the rest.
        chunkFileNames(chunk) {
          // Matches both the flat and pnpm layouts: pnpm still ends every package path
          // with an inner `node_modules/<pkg>/`, so keying off that segment covers both.
          const EDITOR_PKG = /node_modules\/(@codemirror\/|@lezer\/|@uiw\/(react-)?codemirror|@marijn\/|@babel\/runtime\/|codemirror\/|style-mod\/|w3c-keyname\/|crelt\/)/;
          const ids = chunk.moduleIds || [];
          const editorOnly = ids.length > 0 && ids.every(
            (id) => EDITOR_PKG.test(id) || id.includes("/src/components/CodeEditor"),
          );
          return editorOnly ? "assets/ondemand/[name]-[hash].js" : "assets/[name]-[hash].js";
        },
      },
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    host: remote ? true : undefined,                 // listen on all interfaces
    allowedHosts: remote ? true : undefined,         // accept the public Host header
    hmr: remote ? { protocol: "wss", clientPort: hmrPort } : undefined,
    proxy: {
      "/api": API,
      "/upload": API,
      "/uploads": API,
      "/ws": { target: API.replace("http", "ws"), ws: true },
      "/chat": { target: API.replace("http", "ws"), ws: true },
      "/asr": { target: API.replace("http", "ws"), ws: true },
    },
  },
});
