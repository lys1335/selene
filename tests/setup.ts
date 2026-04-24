import { vi } from "vitest";

// Mock server-only package (Next.js server guard, not needed in tests)
vi.mock("server-only", () => ({}));

if (!process.env.INTERNAL_API_SECRET) {
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
}

// TruncatedContentStore: default to in-memory for tests so we don't
// accidentally hit the real SQLite DB (which would require real session
// rows to exist for FK constraints). Tests that deliberately exercise
// the SQLite backend set CONTENT_STORE_BACKEND=sqlite on process.env
// themselves and/or inject a SqliteContentStore via setContentStoreForTesting.
if (!process.env.CONTENT_STORE_BACKEND) {
  process.env.CONTENT_STORE_BACKEND = "memory";
}

// Disable the 15-minute cleanup interval in the content store — it holds
// no references thanks to .unref(), but keeping it off makes test timing
// deterministic and avoids a stray console.log on slow runs.
if (!process.env.CONTENT_STORE_CLEANUP) {
  process.env.CONTENT_STORE_CLEANUP = "disabled";
}
