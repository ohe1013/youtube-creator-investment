import { join } from "node:path";

import { stageAppInTossOutput } from "./appintoss-output-staging.mjs";

export async function runAppInTossBuild({
  root,
  nextBin,
  env,
  exists,
  rename,
  spawn,
  stageOutput = stageAppInTossOutput,
}) {
  const apiDir = join(root, "app", "api");
  const disabledApiDir = join(root, ".appintoss-api-disabled");
  const outDir = join(root, "out");
  let apiHidden = false;

  try {
    if (exists(disabledApiDir)) {
      throw new Error(`${disabledApiDir} already exists. Restore app/api before building.`);
    }

    if (exists(apiDir)) {
      rename(apiDir, disabledApiDir);
      apiHidden = true;
    }

    const result = spawn(process.execPath, [nextBin, "build"], {
      env,
      stdio: "inherit",
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) return result.status ?? 1;

    await stageOutput({ outDir });
    return 0;
  } finally {
    if (apiHidden && exists(disabledApiDir)) {
      rename(disabledApiDir, apiDir);
    }
  }
}
