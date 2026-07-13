import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { AITBundle, AITReader, AITWriter } from "@apps-in-toss/ait-format";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_AIT_UNCOMPRESSED_BYTES,
  verifyAitArtifact,
} from "../../scripts/verify-ait-artifact.mjs";

const DEPLOYMENT_ID = "019bfa90-ad4c-799f-b227-b4159e6867f7";
const ENTRYPOINT = "web/index.html";
const VERIFIER_PATH = fileURLToPath(
  new URL("../../scripts/verify-ait-artifact.mjs", import.meta.url),
);
const PROJECT_ROOT = dirname(dirname(VERIFIER_PATH));
const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];

type FixtureFile = {
  name: string;
  content: string | Uint8Array;
};

type FixtureOptions = {
  appName?: string;
  formatVersion?: number;
  permissions?: Array<{ name: string; access: string }>;
  files?: FixtureFile[];
  metadata?: Parameters<AITWriter["setMetadata"]>[0];
};

async function buildFixture({
  appName = "creatorx",
  formatVersion = 1,
  permissions = [],
  files = [{ name: ENTRYPOINT, content: "<!doctype html>" }],
  metadata,
}: FixtureOptions = {}): Promise<Uint8Array> {
  const writer = new AITWriter({
    appName,
    deploymentId: DEPLOYMENT_ID,
    formatVersion,
    createdBy: "creatorx-tests/1.0.0",
  });

  if (metadata) writer.setMetadata(metadata);
  for (const permission of permissions) {
    writer.addPermission(permission.name, permission.access);
  }
  for (const file of files) {
    writer.addFile(
      file.name,
      typeof file.content === "string" ? encoder.encode(file.content) : file.content,
    );
  }

  return await writer.toBuffer();
}

function mutateBundle(
  input: Uint8Array,
  mutate: (bundle: ReturnType<typeof AITBundle.decode>) => void,
): Uint8Array {
  const headerBytes = 20;
  const inputView = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  );
  const bundleLength = Number(inputView.getBigUint64(12, false));
  const bundleEnd = headerBytes + bundleLength;
  const bundle = AITBundle.decode(input.subarray(headerBytes, bundleEnd));

  mutate(bundle);

  const encodedBundle = AITBundle.encode(bundle).finish();
  const tail = input.subarray(bundleEnd);
  const output = new Uint8Array(headerBytes + encodedBundle.length + tail.length);
  output.set(input.subarray(0, 12), 0);
  new DataView(output.buffer).setBigUint64(12, BigInt(encodedBundle.length), false);
  output.set(encodedBundle, headerBytes);
  output.set(tail, headerBytes + encodedBundle.length);
  return output;
}

function getZipBounds(input: Uint8Array): {
  zipStart: number;
  zipLength: number;
  zipEnd: number;
} {
  const headerBytes = 20;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const bundleLength = Number(view.getBigUint64(12, false));
  const zipLengthOffset = headerBytes + bundleLength;
  const zipLength = Number(view.getBigUint64(zipLengthOffset, false));
  const zipStart = zipLengthOffset + 8;
  return { zipStart, zipLength, zipEnd: zipStart + zipLength };
}

function replaceZipEntryName(
  input: Uint8Array,
  from: string,
  to: string,
  replacementLimit = Number.POSITIVE_INFINITY,
): { artifact: Uint8Array; replacements: number } {
  const fromBytes = encoder.encode(from);
  const toBytes = encoder.encode(to);
  if (fromBytes.byteLength !== toBytes.byteLength) {
    throw new Error("ZIP entry name replacements must preserve byte length");
  }

  const output = Uint8Array.from(input);
  const { zipStart, zipEnd } = getZipBounds(output);
  let replacements = 0;

  for (
    let offset = zipStart;
    offset <= zipEnd - fromBytes.byteLength && replacements < replacementLimit;
    offset += 1
  ) {
    let matches = true;
    for (let index = 0; index < fromBytes.byteLength; index += 1) {
      if (output[offset + index] !== fromBytes[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    output.set(toBytes, offset);
    replacements += 1;
    offset += fromBytes.byteLength - 1;
  }

  return { artifact: output, replacements };
}

function corruptCentralDirectoryOffset(input: Uint8Array): Uint8Array {
  const output = Uint8Array.from(input);
  const { zipStart, zipLength, zipEnd } = getZipBounds(output);
  const eocdOffset = zipEnd - 22;
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setUint32(eocdOffset + 16, zipLength + 1, true);
  if (view.getUint32(eocdOffset, true) !== 0x06054b50) {
    throw new Error(`Expected EOCD at ZIP-relative offset ${eocdOffset - zipStart}`);
  }
  return output;
}

async function createTemporaryArtifact(
  buffer: Uint8Array,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "creatorx-ait-test-"));
  temporaryDirectories.push(directory);
  const artifactPath = join(directory, "creatorx.ait");
  await writeFile(artifactPath, buffer);
  return artifactPath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("verifyAitArtifact", () => {
  it("returns deterministic metadata for a valid CreatorX artifact", async () => {
    const html = "<!doctype html>";
    const config = '{"NEXT_PUBLIC_API_URL":"https://api.example.com"}';
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: html },
        { name: "web/config.json", content: config },
      ],
    });

    await expect(verifyAitArtifact(artifact)).resolves.toEqual({
      artifactBytes: artifact.byteLength,
      fileBytes: artifact.byteLength,
      uncompressedBytes: encoder.encode(html).byteLength + encoder.encode(config).byteLength,
      maxBytes: 104_857_600,
      entryCount: 2,
      formatVersion: 1,
      appName: "creatorx",
      deploymentId: DEPLOYMENT_ID,
      permissions: [],
      hasWebIndex: true,
      entrypoint: ENTRYPOINT,
    });
  });

  it("emits the verification result as JSON from the CLI", async () => {
    const artifactPath = await createTemporaryArtifact(await buildFixture());

    const result = spawnSync(process.execPath, [VERIFIER_PATH, artifactPath], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      appName: "creatorx",
      formatVersion: 1,
      permissions: [],
      hasWebIndex: true,
      entrypoint: ENTRYPOINT,
    });
  });

  it("reports a stable missing-file error", async () => {
    const missingPath = join(tmpdir(), "creatorx-does-not-exist.ait");

    await expect(verifyAitArtifact(missingPath)).rejects.toMatchObject({
      code: "AIT_FILE_MISSING",
      message: `Artifact not found: ${missingPath}`,
    });
  });

  it("writes one concise stable error line and exits nonzero", () => {
    const missingPath = join(tmpdir(), "creatorx-cli-does-not-exist.ait");

    const result = spawnSync(process.execPath, [VERIFIER_PATH, missingPath], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `AIT_FILE_MISSING: Artifact not found: ${missingPath}\n`,
    );
  });

  it("rejects malformed input", async () => {
    await expect(
      verifyAitArtifact(encoder.encode("not-an-ait-artifact")),
    ).rejects.toMatchObject({ code: "AIT_MALFORMED" });
  });

  it("rejects a non-v1 artifact", async () => {
    await expect(
      verifyAitArtifact(await buildFixture({ formatVersion: 2 })),
    ).rejects.toMatchObject({ code: "AIT_FORMAT_VERSION" });
  });

  it("rejects the wrong app name", async () => {
    await expect(
      verifyAitArtifact(await buildFixture({ appName: "another-app" })),
    ).rejects.toMatchObject({ code: "AIT_APP_NAME" });
  });

  it("requires permissions to be exactly empty", async () => {
    await expect(
      verifyAitArtifact(
        await buildFixture({
          permissions: [{ name: "camera", access: "read" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "AIT_PERMISSIONS" });
  });

  it("requires web/index.html", async () => {
    await expect(
      verifyAitArtifact(
        await buildFixture({
          files: [{ name: "web/main.js", content: "export {};" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "AIT_WEB_INDEX" });
  });

  it("rejects an unsafe ZIP member omitted from the AIT index", async () => {
    const artifact = mutateBundle(
      await buildFixture({
        files: [
          { name: ENTRYPOINT, content: "<!doctype html>" },
          { name: "../unindexed-secret.txt", content: "unsafe" },
        ],
      }),
      (bundle) => {
        bundle.index = bundle.index.filter((entry) => entry.name === ENTRYPOINT);
      },
    );

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_ZIP_INDEX_MISMATCH",
    });
  });

  it("rejects a safe ZIP member omitted from the AIT index", async () => {
    const artifact = mutateBundle(
      await buildFixture({
        files: [
          { name: ENTRYPOINT, content: "<!doctype html>" },
          { name: "web/unindexed.js", content: "export {};" },
        ],
      }),
      (bundle) => {
        bundle.index = bundle.index.filter((entry) => entry.name === ENTRYPOINT);
      },
    );

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_ZIP_INDEX_MISMATCH",
    });
  });

  it("rejects an AIT index member missing from the ZIP", async () => {
    const artifact = mutateBundle(await buildFixture(), (bundle) => {
      bundle.index[0].name = "web/missing.htm";
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_ZIP_INDEX_MISMATCH",
    });
  });

  it("rejects duplicate raw names in the ZIP central directory", async () => {
    const patched = replaceZipEntryName(
      await buildFixture({
        files: [
          { name: ENTRYPOINT, content: "<!doctype html>" },
          { name: "web/extra.html", content: "extra" },
        ],
      }),
      "web/extra.html",
      ENTRYPOINT,
    );
    expect(patched.replacements).toBe(2);

    await expect(verifyAitArtifact(patched.artifact)).rejects.toMatchObject({
      code: "AIT_DUPLICATE_ZIP_ENTRY",
    });
  });

  it("rejects a local ZIP header name that disagrees with the central directory", async () => {
    const patched = replaceZipEntryName(
      await buildFixture({
        files: [
          { name: ENTRYPOINT, content: "<!doctype html>" },
          { name: "web/extra.html", content: "extra" },
        ],
      }),
      "web/extra.html",
      ENTRYPOINT,
      1,
    );
    expect(patched.replacements).toBe(1);

    await expect(verifyAitArtifact(patched.artifact)).rejects.toMatchObject({
      code: "AIT_ZIP_LOCAL_MISMATCH",
    });
  });

  it("rejects out-of-bounds ZIP central-directory metadata", async () => {
    const artifact = corruptCentralDirectoryOffset(await buildFixture());

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_ZIP_MALFORMED",
    });
  });

  it("rejects a payload that does not match its indexed SHA-256", async () => {
    const artifact = mutateBundle(await buildFixture(), (bundle) => {
      bundle.index[0].sha256Hex = "0".repeat(64);
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_ENTRY_HASH",
    });
  });

  it("extracts members without reinflating the complete ZIP for every entry", async () => {
    const readEntry = vi.spyOn(AITReader.prototype, "readEntry");
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/app.js", content: "export {};" },
        { name: "web/app.css", content: "body {}" },
      ],
    });

    try {
      await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
        entryCount: 3,
      });
      expect(readEntry).not.toHaveBeenCalled();
    } finally {
      readEntry.mockRestore();
    }
  });

  it("rejects an index whose total uncompressed size exceeds 100 MiB", async () => {
    const artifact = mutateBundle(await buildFixture(), (bundle) => {
      bundle.index[0].uncompressedSize =
        BigInt(MAX_AIT_UNCOMPRESSED_BYTES) + BigInt(1);
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SIZE_LIMIT",
    });
  });

  it("rejects an index exactly at the exclusive 100 MiB limit", async () => {
    const artifact = mutateBundle(await buildFixture(), (bundle) => {
      bundle.index[0].uncompressedSize = BigInt(MAX_AIT_UNCOMPRESSED_BYTES);
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SIZE_LIMIT",
    });
  });

  it("normalizes Windows separators for checks but reads the raw entry name", async () => {
    const artifact = await buildFixture({
      files: [{ name: "web\\index.html", content: "<!doctype html>" }],
    });

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      hasWebIndex: true,
      entrypoint: ENTRYPOINT,
      entryCount: 1,
    });
  });

  it("rejects duplicate normalized entry names", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web\\index.html", content: "duplicate" },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_DUPLICATE_ENTRY",
    });
  });

  it.each([
    "../secret.txt",
    "/absolute.txt",
    "C:\\absolute.txt",
    "C:escape.txt",
  ])(
    "rejects unsafe archive path %s",
    async (unsafePath) => {
      const artifact = await buildFixture({
        files: [
          { name: ENTRYPOINT, content: "<!doctype html>" },
          { name: unsafePath, content: "unsafe" },
        ],
      });

      await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
        code: "AIT_ENTRY_PATH",
      });
    },
  );

  it("escapes control characters in unsafe-path errors", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/\nsecret.txt", content: "unsafe" },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_ENTRY_PATH",
      message: "Unsafe artifact entry path: web/\\u000asecret.txt",
    });
  });

  it("detects a likely committed secret in a readable entry", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/config.js",
          content: 'export const CLIENT_SECRET = "committed-secret-value-123";',
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/config.js",
    });
  });

  it("detects a likely committed secret in manifest metadata", async () => {
    const artifact = await buildFixture({
      metadata: {
        extra: {
          DATABASE_URL: "postgresql://creator:committed-password@db.example.com/app",
        },
      },
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in manifest metadata",
    });
  });

  it("does not flag runtime password and token vocabulary as committed config", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content: [
            'this.url.password = "runtime-property";',
            "const BaseDerivedTokenGenerator = function () {};",
            'const eventContextToken = "runtime-event-context";',
            'module.exports.setThePassword = "runtime-helper";',
          ].join("\n"),
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      appName: "creatorx",
      hasWebIndex: true,
    });
  });

  it("does not flag normal NEXT_PUBLIC configuration", async () => {
    const publicGoogleKey = `AIza${"A".repeat(35)}`;
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/public-config.js",
          content: JSON.stringify({
            NEXT_PUBLIC_API_URL: "https://api.example.com",
            NEXT_PUBLIC_FIREBASE_API_KEY: publicGoogleKey,
          }),
        },
      ],
      metadata: {
        packageJson: {
          NEXT_PUBLIC_API_URL: "https://api.example.com",
          NEXT_PUBLIC_FIREBASE_API_KEY: publicGoogleKey,
        },
      },
    });

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      appName: "creatorx",
      hasWebIndex: true,
    });
  });
});
