import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runAppInTossBuild,
} from "../../scripts/appintoss-build-runner.mjs";

describe("runAppInTossBuild", () => {
  it("restores app/api when staging generated output fails", async () => {
    const root = resolve("appintoss-build-runner-fixture");
    const apiDir = join(root, "app", "api");
    const disabledApiDir = join(root, ".appintoss-api-disabled");
    const paths = new Set([apiDir]);
    const stagingError = Object.assign(new Error("generated output remains busy"), {
      code: "EACCES",
    });
    const rename = vi.fn((from: string, to: string) => {
      paths.delete(from);
      paths.add(to);
    });
    const stageOutput = vi.fn().mockRejectedValue(stagingError);

    await expect(
      runAppInTossBuild({
        root,
        nextBin: "next-bin",
        env: { APP_IN_TOSS: "1" },
        exists: (path: string) => paths.has(path),
        rename,
        spawn: vi.fn().mockReturnValue({ status: 0 }),
        stageOutput,
      }),
    ).rejects.toBe(stagingError);

    expect(stageOutput).toHaveBeenCalledWith({ outDir: join(root, "out") });
    expect(rename).toHaveBeenNthCalledWith(1, apiDir, disabledApiDir);
    expect(rename).toHaveBeenNthCalledWith(2, disabledApiDir, apiDir);
    expect(paths).toEqual(new Set([apiDir]));
  });
});
