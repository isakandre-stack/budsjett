import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Adressen på GitHub Pages blir https://<bruker>.github.io/budsjett/
const base = process.env.BASE_PATH ?? '/budsjett/'

// Vises i Innstillinger, så det er lett å se om telefonen har fått siste versjon
const version = (process.env.GITHUB_SHA ?? 'lokal').slice(0, 7)

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ny versjon aktiveres med en gang. Registreringen skjer i src/lib/update.ts,
      // som laster appen inn på nytt når den nye versjonen har tatt over.
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Budsjett',
        short_name: 'Budsjett',
        description: 'Privat oversikt over økonomien',
        lang: 'nb',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#eef2f0',
        theme_color: '#1f4a40',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Bare selve appen caches. Økonomidata fra Supabase lagres aldri i cachen.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        // Ny versjon tar over med en gang i stedet for å vente til appen er lukket helt
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 800 },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
