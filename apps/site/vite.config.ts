import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// apps/site is a retired redirect-only stub (ADR-0010/0015 amendments). It
// no longer has a waitlist or any API call, so the former production-build
// fail-fast on VITE_API_URL (which guarded the old waitlist's target URL)
// is gone with the rest of the marketing app. Vite just builds index.html +
// the tiny redirect bundle; the real redirect is the 308 in vercel.json.
// https://vite.dev/config/
export default defineConfig({ plugins: [react()] })
