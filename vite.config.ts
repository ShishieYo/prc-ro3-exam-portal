/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// VITE_BASE lets GitHub Pages serve the app from /<repo>/ ; defaults to "/".
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000 },
})
