// @vitest-environment jsdom

import { expect, it } from "vitest";

it("loads the Vitest setup with DOM matchers", () => {
  const element = document.createElement("div");
  document.body.append(element);

  expect(element).toBeInTheDocument();
});
