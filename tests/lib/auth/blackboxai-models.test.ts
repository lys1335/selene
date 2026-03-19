import { describe, expect, it } from "vitest";
import {
  BLACKBOX_MODEL_IDS,
  getBlackBoxModels,
} from "@/lib/auth/blackboxai-models";

describe("getBlackBoxModels", () => {
  it("returns unique model IDs for the settings picker", () => {
    const models = getBlackBoxModels();
    const ids = models.map((model) => model.id);

    expect(ids).toEqual([...new Set(ids)]);
  });

  it("preserves the curated model order while deduplicating", () => {
    const ids = getBlackBoxModels().map((model) => model.id);

    expect(ids).toEqual([...new Set(BLACKBOX_MODEL_IDS)]);
  });
});
