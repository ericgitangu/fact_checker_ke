import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // {ts,tsx}: the redirect stub's only test is a pure-function .test.ts
    // (no DOM/JSX), the marketing-component .test.tsx files were removed
    // with the app they covered.
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
});
