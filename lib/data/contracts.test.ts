import { describe, expect, it } from "vitest";

import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import {
  identifierSchema,
  paginatedCreatorsSchema,
  placeOrderInputSchema,
} from "@/lib/data/contracts";

describe("identifierSchema", () => {
  it.each(["", " ", " creator", "creator ", ".", ".."])(
    "rejects unsafe identifier %j",
    (id) => {
      expect(identifierSchema.safeParse(id).success).toBe(false);
    },
  );

  it.each(["creator", "creator/id", "amp&id", "hash#id", "space id", "%2F"])(
    "accepts safe opaque identifier %j",
    (id) => {
      expect(identifierSchema.parse(id)).toBe(id);
    },
  );

  it("rejects an unsafe creator id at list-response and order-input boundaries", () => {
    const creator = { ...appInTossDemoData.creators[0], id: " creator" };
    expect(
      paginatedCreatorsSchema.safeParse({
        creators: [creator],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(false);
    expect(
      placeOrderInputSchema.safeParse({
        creatorId: "..",
        side: "BUY",
        orderType: "MARKET",
        price: 100,
        quantity: 1,
      }).success,
    ).toBe(false);
  });
});
