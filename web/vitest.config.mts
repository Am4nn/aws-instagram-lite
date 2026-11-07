import { defineConfig } from "vitest/config";

// Unit tests for the server-side helpers (pure functions: no Next.js runtime needed).
export default defineConfig({ test: { include: ["lib/**/*.test.ts", "proxy.test.ts"], environment: "node" } });
