import config from "../../vitest.config";
import { describe, expect, it } from "vitest";

describe("Vitest worktree isolation", () => {
  it("excludes linked worktrees from test discovery", () => {
    expect(config.test?.exclude).toContain(".worktrees/**");
  });
});
