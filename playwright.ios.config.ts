import { defineConfig, devices } from "@playwright/test";

// WebKit device emulation complements, but does not replace, real iOS Safari checks.
export default defineConfig({
  testDir: "./tests/ios",
  outputDir: "test-results/ios",
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: "webkit",
    baseURL: "http://127.0.0.1:3102",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: ["iPhone SE", "iPhone 13", "iPad Mini"].map(name => ({ name, use: { ...devices[name] } })),
  webServer: {
    command: "pnpm dev --webpack --hostname 127.0.0.1 --port 3102",
    url: "http://127.0.0.1:3102",
    reuseExistingServer: false,
    env: {
      FIREBASE_BUILD: "1",
      NEXT_PUBLIC_DEV_AUTH_BYPASS: "1",
      NEXT_PUBLIC_FIREBASE_API_KEY: "",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "",
    },
  },
});
