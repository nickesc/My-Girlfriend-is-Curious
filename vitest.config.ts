import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { bindings: {
      PUBLIC_BASE_URL: "https://mgic.example",
      SPOTIFY_CLIENT_ID: "test-client",
      SPOTIFY_CLIENT_SECRET: "test-secret",
      SPOTIFY_USER_ID: "goofyshnoofy",
      IFTTT_KEY: "test-key",
      IFTTT_EVENT: "test-event"
    } }
  })],
  test: { include: ["test/**/*.test.ts"] }
});
