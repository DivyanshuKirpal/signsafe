import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/" alias as tsconfig.json paths.
const alias = { "@": fileURLToPath(new URL(".", import.meta.url)) };

// Two test projects:
// - "unit": pure TypeScript (decoder, rules, scripts) in plain Node. Most tests live here.
// - "ui": React components in jsdom, using the template's realm fixes in vitest.setup.ts.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias,
          conditions: ["browser"],
        },
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
          server: {
            deps: {
              // Bundle the Solana packages through Vite so they resolve their
              // browser builds.
              inline: [/@solana\//],
            },
          },
        },
      },
    ],
  },
});
