import { vi } from "vitest";

// Mock server-only package (Next.js server guard, not needed in tests)
vi.mock("server-only", () => ({}));

if (!process.env.INTERNAL_API_SECRET) {
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret";
}
