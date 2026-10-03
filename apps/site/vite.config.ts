import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolveApiUrl } from './src/config.js'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  if (command === 'build' && mode === 'production') {
    // Fail the production build rather than ship a site whose waitlist posts
    // to a relative URL (see src/config.ts).
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const api = resolveApiUrl(env.VITE_API_URL ?? process.env.VITE_API_URL)
    if (!api.ok) throw new Error(`apps/site production build: ${api.reason}`)
  }
  return { plugins: [react()] }
})
