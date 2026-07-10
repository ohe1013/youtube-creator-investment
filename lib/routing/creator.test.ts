import { describe, expect, it } from "vitest";

import { creatorDetailHref, marketTickerHref } from "@/lib/routing/creator";

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

describe("marketTickerHref", () => {
  it.each([
    ["amp&id", "/?ticker=amp%26id"],
    ["hash#id", "/?ticker=hash%23id"],
    ["percent%2Fid", "/?ticker=percent%252Fid"],
    ["space # ? id", "/?ticker=space+%23+%3F+id"],
  ])("encodes and round-trips %s exactly once", (id, expected) => {
    const href = marketTickerHref(id);
    expect(href).toBe(expected);
    expect(new URL(href, "https://creatorx.example").searchParams.get("ticker")).toBe(
      id,
    );
  });
});
