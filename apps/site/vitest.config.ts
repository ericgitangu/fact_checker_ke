import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // Available on `import.meta.env` in tests (mirrors .env.example; no
    // real .env file is loaded in CI/test runs).
    env: {
      VITE_API_URL: "http://localhost:8080",
      VITE_WEB_URL: "http://localhost:3000",
    },
  },
});
