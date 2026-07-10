import { describe, expect, it } from "vitest";

import { creatorDetailHref } from "@/lib/routing/creator";

describe("creatorDetailHref", () => {
  it.each([
    ["slash/id", "/creator?id=slash%2Fid"],
    ["question?id", "/creator?id=question%3Fid"],
    ["amp&id", "/creator?id=amp%26id"],
    ["hash#id", "/creator?id=hash%23id"],
    ["space id", "/creator?id=space%20id"],
    ["percent%2Fid", "/creator?id=percent%252Fid"],
  ])("encodes %s exactly once", (id, expected) => {
    expect(creatorDetailHref(id)).toBe(expected);
  });
});
