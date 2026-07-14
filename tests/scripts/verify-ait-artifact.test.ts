import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { AITBundle, AITReader, AITWriter } from "@apps-in-toss/ait-format";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  containsSpecificSecretBytes,
  MAX_AIT_UNCOMPRESSED_BYTES,
  verifyAitArtifact,
} from "../../scripts/verify-ait-artifact.mjs";
import { scanClientSecrets } from "../../scripts/scan-client-secrets.mjs";

const DEPLOYMENT_ID = "019bfa90-ad4c-799f-b227-b4159e6867f7";
const ENTRYPOINT = "web/index.html";
const VERIFIER_PATH = fileURLToPath(
  new URL("../../scripts/verify-ait-artifact.mjs", import.meta.url),
);
const PROJECT_ROOT = dirname(dirname(VERIFIER_PATH));
const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];
// This allows scheduler contention in the full Vitest worker pool while still
// rejecting the legacy 5 MiB tokenizer path (about 1.6 s for punctuation and
// more than 2 s for malformed backslash payloads in direct measurement).
const OPAQUE_SCAN_REGRESSION_BUDGET_MS = 1_500;

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

async function createTemporaryClientOutput(
  content: string | Uint8Array,
  fileName = "public-config.js",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "creatorx-client-output-test-"));
  temporaryDirectories.push(directory);
  const outDir = join(directory, "out");
  await mkdir(outDir);
  await writeFile(join(outDir, fileName), content);
  return outDir;
}

function createTestJwt(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "none", typ: "JWT" },
): string {
  return [
    Buffer.from(JSON.stringify(header)).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "test_signature_not_real",
  ].join(".");
}

function encodeUtf16LittleEndianWithBom(text: string): Uint8Array {
  return new Uint8Array(
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  );
}

function encodeUtf16BigEndianWithBom(text: string): Uint8Array {
  const bytes = Buffer.from(text, "utf16le");
  for (let index = 0; index < bytes.length; index += 2) {
    const low = bytes[index];
    bytes[index] = bytes[index + 1];
    bytes[index + 1] = low;
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]));
}

function interleaveControlBytes(text: string, control: number): Uint8Array {
  const bytes = encoder.encode(text);
  const output = new Uint8Array(bytes.byteLength * 2);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    output[index * 2] = bytes[index];
    output[index * 2 + 1] = control;
  }
  return output;
}

async function expectOpaquePayloadToReject(
  opaquePayload: Uint8Array,
  expectedValue: string,
): Promise<void> {
  const artifact = await buildFixture({
    files: [
      { name: ENTRYPOINT, content: "<!doctype html>" },
      { name: "web/opaque.bin", content: opaquePayload },
    ],
  });
  const outDir = await createTemporaryClientOutput(opaquePayload, "opaque.bin");
  const [artifactFailure, clientFailure] = await Promise.all([
    verifyAitArtifact(artifact).catch((error) => error),
    scanClientSecrets({ outDir }).catch((error) => error),
  ]);

  expect([artifactFailure?.code, clientFailure?.code]).toEqual([
    "AIT_SECRET_DETECTED",
    "CLIENT_SECRET_DETECTED",
  ]);
  expect(String(artifactFailure.message)).toContain("web/opaque.bin");
  expect(String(artifactFailure.message)).not.toContain(expectedValue);
  expect(String(clientFailure.message)).toContain("opaque.bin");
  expect(String(clientFailure.message)).not.toContain(expectedValue);
}

async function expectOpaquePayloadToPass(
  opaquePayload: Uint8Array,
): Promise<void> {
  const artifact = await buildFixture({
    files: [
      { name: ENTRYPOINT, content: "<!doctype html>" },
      { name: "web/opaque.bin", content: opaquePayload },
    ],
  });
  const outDir = await createTemporaryClientOutput(opaquePayload, "opaque.bin");

  await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
    appName: "creatorx",
    hasWebIndex: true,
  });
  await expect(scanClientSecrets({ outDir })).resolves.toEqual({
    filesScanned: 1,
  });
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

  it("allows a sensitive-named runtime property wired to a dynamic expression", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content: "const session = { refreshToken: tokenStore.read() };",
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      appName: "creatorx",
      hasWebIndex: true,
    });
  });

  it("allows a dynamic runtime chain with a numeric method argument", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content:
            "const session = { refreshToken: tokenStore.read().slice(0) };",
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      appName: "creatorx",
      hasWebIndex: true,
    });
  });

  it("rejects a quoted literal that only looks like a dynamic runtime chain", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content:
            'const session = { refreshToken: "tokenStore.read().slice(0)" };',
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/runtime.js",
    });
  });

  it("rejects a single-quoted literal that only looks like a dynamic runtime chain", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content:
            "const session = { refreshToken: 'tokenStore.read().slice(0)' };",
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/runtime.js",
    });
  });

  it("rejects an API key even when its key name is prefixed NEXT_PUBLIC", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content: `const config = { NEXT_PUBLIC_ANALYTICS_API_KEY: "AIza${"A".repeat(35)}" };`,
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/runtime.js",
    });
  });

  it("rejects a template literal that only looks like a dynamic runtime chain", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content:
            "const session = { refreshToken: `tokenStore.read().slice(0)` };",
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/runtime.js",
    });
  });

  it("rejects a dynamic-looking expression containing a committed string literal", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content:
            'const session = { refreshToken: tokenStore.read("committed-secret-value-123") };',
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/runtime.js",
    });
  });

  it("rejects a sensitive property wrapped around a committed literal", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/runtime.js",
          content:
            'const session = { refreshToken: String("committed-secret-value-123") };',
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/runtime.js",
    });
  });

  it("does not scrub a concrete database URL in non-sensitive NEXT_PUBLIC config", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/public-config.js",
          content:
            'const config = { NEXT_PUBLIC_API_URL: "postgresql://creator:committed-password@db.example.com/app" };',
        },
      ],
    });

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/public-config.js",
    });
  });

  it("rejects a NUL-delimited database URL in an opaque binary payload without echoing it", async () => {
    const secret =
      "postgresql://creator:committed-password@db.creatorx.example/creatorx";
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/opaque.bin",
          content: encoder.encode(`\0${secret}\0`),
        },
      ],
    });

    const failure = await verifyAitArtifact(artifact).catch((error) => error);

    expect(failure).toMatchObject({ code: "AIT_SECRET_DETECTED" });
    expect(String(failure.message)).toContain("web/opaque.bin");
    expect(String(failure.message)).not.toContain(secret);
  });

  it("rejects a NUL-delimited Supabase service-role JWT in opaque payloads without echoing it", async () => {
    const secret =
      "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIiwidGVzdCI6dHJ1ZX0.test_signature_not_real";
    const opaquePayload = encoder.encode(
      `\0NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "${secret}"\0`,
    );
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/opaque.bin", content: opaquePayload },
      ],
    });
    const outDir = await createTemporaryClientOutput(
      opaquePayload,
      "opaque.bin",
    );

    const [artifactFailure, clientFailure] = await Promise.all([
      verifyAitArtifact(artifact).catch((error) => error),
      scanClientSecrets({ outDir }).catch((error) => error),
    ]);

    expect([artifactFailure?.code, clientFailure?.code]).toEqual([
      "AIT_SECRET_DETECTED",
      "CLIENT_SECRET_DETECTED",
    ]);
    expect(String(artifactFailure.message)).toContain("web/opaque.bin");
    expect(String(artifactFailure.message)).not.toContain(secret);
    expect(String(clientFailure.message)).toContain("opaque.bin");
    expect(String(clientFailure.message)).not.toContain(secret);
  });

  it("rejects an unkeyed NUL-delimited Supabase service-role JWT in opaque payloads", async () => {
    const secret =
      "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIiwidGVzdCI6dHJ1ZX0.test_signature_not_real";
    const opaquePayload = encoder.encode(`\0${secret}\0`);
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/opaque.bin", content: opaquePayload },
      ],
    });
    const outDir = await createTemporaryClientOutput(
      opaquePayload,
      "opaque.bin",
    );

    await expect(verifyAitArtifact(artifact)).rejects.toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/opaque.bin",
    });
    await expect(scanClientSecrets({ outDir })).rejects.toMatchObject({
      code: "CLIENT_SECRET_DETECTED",
      message: "Suspected secret in client output: opaque.bin",
    });
  });

  it("rejects an arbitrary NUL-delimited public secret-key assignment in opaque payloads without echoing it", async () => {
    const secret = "fixture-value-not-an-actual-secret";
    const opaquePayload = encoder.encode(
      `\0NEXT_PUBLIC_EDGE_SECRET_KEY: "${secret}"\0`,
    );
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/opaque.bin", content: opaquePayload },
      ],
    });
    const outDir = await createTemporaryClientOutput(
      opaquePayload,
      "opaque.bin",
    );

    const [artifactFailure, clientFailure] = await Promise.all([
      verifyAitArtifact(artifact).catch((error) => error),
      scanClientSecrets({ outDir }).catch((error) => error),
    ]);

    expect([artifactFailure?.code, clientFailure?.code]).toEqual([
      "AIT_SECRET_DETECTED",
      "CLIENT_SECRET_DETECTED",
    ]);
    expect(String(artifactFailure.message)).not.toContain(secret);
    expect(String(clientFailure.message)).not.toContain(secret);
  });

  it("rejects a NUL-delimited service-role JWT with an oversized claims segment", async () => {
    const secret = createTestJwt({
      role: "service_role",
      padding: "x".repeat(5000),
    });

    await expectOpaquePayloadToReject(encoder.encode(`\0${secret}\0`), secret);
  });

  it("rejects a long NUL-delimited public secret-key assignment with a short literal", async () => {
    const key = `NEXT_PUBLIC_${"EDGE_".repeat(20)}SECRET_KEY`;
    const secret = "z9";

    await expectOpaquePayloadToReject(
      encoder.encode(`\0${key}: "${secret}"\0`),
      secret,
    );
  });

  it("rejects NUL-delimited property assignment syntax for public secret keys", async () => {
    const secret = "z9";
    const payloads = [
      `\0c.NEXT_PUBLIC_EDGE_SECRET_KEY = "${secret}"\0`,
      `\0c["NEXT_PUBLIC_EDGE_SECRET_KEY"] = "${secret}"\0`,
      `\0const config = { ["NEXT_PUBLIC_EDGE_SECRET_KEY"]: "${secret}" };\0`,
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToReject(encoder.encode(payload), secret);
    }
  });

  it("rejects raw and NUL-delimited quoted public keys with comments before assignment syntax", async () => {
    const secret = "z9";
    const sources = [
      `c["NEXT_PUBLIC_EDGE_SECRET_KEY"] /* note */ = "${secret}";`,
      `const config = { ["NEXT_PUBLIC_EDGE_SECRET_KEY"] /* note */ : "${secret}" };`,
      `const config = { "NEXT_PUBLIC_EDGE_SECRET_KEY" /* note */ : "${secret}" };`,
      `c["NEXT_PUBLIC_EDGE_SECRET_KEY" /* note */] = "${secret}";`,
      `c["NEXT_PUBLIC_EDGE_SECRET_KEY"] // note\n= "${secret}";`,
      `c["NEXT_PUBLIC_EDGE_SECRET_KEY" // note\n] = "${secret}";`,
    ];

    for (const source of sources) {
      for (const payload of [source, `\0${source}\0`]) {
        await expectOpaquePayloadToReject(encoder.encode(payload), secret);
      }
    }
  });

  it("rejects NUL-delimited public secret keys separated from assignment punctuation by comments", async () => {
    const secret = "z9";
    const payloads = [
      `\0const config = { NEXT_PUBLIC_EDGE_SECRET_KEY /* note */ : "${secret}" };\0`,
      `\0const config = { NEXT_PUBLIC_EDGE_SECRET_KEY: /* note */ "${secret}" };\0`,
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToReject(encoder.encode(payload), secret);
    }
  });

  it("rejects Unicode-escaped NUL-delimited public secret property keys", async () => {
    const secret = "z9";
    const payloads = [
      `\0const config = { NEXT_PUBLIC_EDGE_SECRET\\u005fKEY: "${secret}" };\0`,
      `\0const config = { "NEXT_PUBLIC_EDGE_SECRET\\x5fKEY": "${secret}" };\0`,
      `\0const config = { NEXT_PUBLIC_EDGE_SECRET\\u{5f}KEY: "${secret}" };\0`,
      `\0{"NEXT_PUBLIC_EDGE_SECRET\\u005fKEY":"${secret}"}\0`,
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToReject(encoder.encode(payload), secret);
    }
  });

  it("rejects a NUL-delimited Supabase secret key without echoing it", async () => {
    const secret = "sb_secret_testonly-abc_123";

    await expectOpaquePayloadToReject(encoder.encode(`\0${secret}\0`), secret);
  });

  it("rejects static computed and reflective public secret-key assignments in opaque payloads", async () => {
    const secret = "z9";
    const payloads = [
      `\0const config = { ["NEXT_PUBLIC_EDGE_" + "SECRET_KEY"]: "${secret}" };\0`,
      `\0Object.defineProperty(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Reflect.set(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", "${secret}");\0`,
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToReject(encoder.encode(payload), secret);
    }
  });

  it("rejects bracket, escaped, optional, and parenthesized static public secret-key calls", async () => {
    const secret = "z9";
    const payloads = [
      `\0Object["defineProperty"](globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Object["defineProperty"](globalThis, "N" + "EXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Object["define\\u0050roperty"](globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Reflect["set"](globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", "${secret}");\0`,
      `\0Reflect.defineProperty(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Object?.defineProperty(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Object?.["defineProperty"](globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Object?.["defineProperty"]?.(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Object.defineProperty?.(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0(Object.defineProperty)(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0Reflect?.set(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", "${secret}");\0`,
      `\0Reflect?.["set"](globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", "${secret}");\0`,
      `\0Reflect.set?.(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", "${secret}");\0`,
      `\0(Reflect.set)(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", "${secret}");\0`,
      `\0Reflect.defineProperty?.(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0(Reflect.defineProperty)(globalThis, "NEXT_PUBLIC_EDGE_SECRET_KEY", { value: "${secret}" });\0`,
      `\0c[("NEXT_PUBLIC_EDGE_" + "SECRET_KEY")] = "${secret}";\0`,
      `\0Object.defineProperty(globalThis, ("NEXT_PUBLIC_EDGE_" + "SECRET_KEY"), { value: "${secret}" });\0`,
      `\0Reflect.set(globalThis, ("NEXT_PUBLIC_EDGE_" + "SECRET_KEY"), "${secret}");\0`,
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToReject(encoder.encode(payload), secret);
    }
  });

  it("keeps punctuation-only opaque byte scans bounded under worker contention", () => {
    const payload = Buffer.alloc(5 * 1024 * 1024, ";");
    const startedAt = Date.now();

    expect(containsSpecificSecretBytes(payload)).toBe(false);

    expect(Date.now() - startedAt).toBeLessThan(
      OPAQUE_SCAN_REGRESSION_BUDGET_MS,
    );
  });

  it("keeps malformed escape opaque byte scans bounded under worker contention", () => {
    const payloads = [
      Buffer.alloc(5 * 1024 * 1024, "\\"),
      Buffer.alloc(5 * 1024 * 1024, "\\u"),
      Buffer.alloc(5 * 1024 * 1024, "\\\\"),
    ];

    for (const payload of payloads) {
      const startedAt = Date.now();

      expect(containsSpecificSecretBytes(payload)).toBe(false);

      expect(Date.now() - startedAt).toBeLessThan(
        OPAQUE_SCAN_REGRESSION_BUDGET_MS,
      );
    }
  });

  it("does not flag repeated benign public configuration markers after the parser budget", () => {
    const benignApiUrl =
      'const config = { NEXT_PUBLIC_API_URL: "https://api.example.test" };\n';
    const benignAnonKey =
      'const config = { NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-value" };\n';
    const payloads = [
      benignApiUrl.repeat(129),
      benignAnonKey.repeat(129),
    ];

    for (const payload of payloads) {
      const startedAt = Date.now();
      expect(containsSpecificSecretBytes(Buffer.from(payload))).toBe(false);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    }

    expect(
      containsSpecificSecretBytes(
        Buffer.from(
          `${benignApiUrl.repeat(129)}c.NEXT_PUBLIC_EDGE_SECRET_KEY = "z9";`,
        ),
      ),
    ).toBe(true);
  });

  it("bounds large repeated benign public configuration data and still finds a following secret", () => {
    const benignApiUrl =
      'const config = { NEXT_PUBLIC_API_URL: "https://api.example.test" };\n';
    const payload = Buffer.from(
      benignApiUrl.repeat(
        Math.ceil((5 * 1024 * 1024) / benignApiUrl.length),
      ),
    );
    const startedAt = Date.now();

    expect(containsSpecificSecretBytes(payload)).toBe(false);

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(
      containsSpecificSecretBytes(
        Buffer.concat([
          payload,
          Buffer.from('c.NEXT_PUBLIC_EDGE_SECRET_KEY = "z9";'),
        ]),
      ),
    ).toBe(true);
  });

  it("finds a direct sensitive public assignment after a semicolon-delimited benign prefix", () => {
    const benignApiUrl = 'NEXT_PUBLIC_API_URL="https://example.com";';
    const payload = Buffer.from(
      `${benignApiUrl.repeat(
        Math.ceil((5 * 1024 * 1024) / benignApiUrl.length),
      )}NEXT_PUBLIC_EDGE_SECRET_KEY="x";`,
    );
    const startedAt = Date.now();

    expect(containsSpecificSecretBytes(payload)).toBe(true);

    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it("does not treat semicolon-delimited text inside a string as a public assignment", () => {
    expect(
      containsSpecificSecretBytes(
        Buffer.from(
          'const note = "not a setting;NEXT_PUBLIC_EDGE_SECRET_KEY=x";',
        ),
      ),
    ).toBe(false);
  });

  it("allows repeated sensitive public-key mentions in comments and literals", () => {
    const payloads = [
      '/* NEXT_PUBLIC_EDGE_SECRET_KEY */\n'.repeat(129),
      '// NEXT_PUBLIC_EDGE_SECRET_KEY = "z9"\n'.repeat(129),
      'const label = "NEXT_PUBLIC_EDGE_SECRET_KEY = z9";\n'.repeat(129),
      'const label = "NEXT_PUBLIC_EDGE_SECRET_KEY = \\\\z9";\n'.repeat(129),
      'const label = "N\\u0045XT_PUBLIC_EDGE_SECRET_KEY = z9";\n'.repeat(129),
    ];

    for (const payload of payloads) {
      expect(containsSpecificSecretBytes(Buffer.from(payload))).toBe(false);
    }
  });

  it("finds a sparse escaped public marker without decoding the opaque prefix", () => {
    const prefix = Buffer.alloc(5 * 1024 * 1024, ";");
    const suffix = Buffer.from(
      'Object["define\\u0050roperty"](globalThis, "N\\u0045XT_PUBLIC_EDGE_SECRET_KEY", { value: "z9" });',
      "latin1",
    );
    const payload = Buffer.concat([prefix, suffix]);
    const startedAt = Date.now();

    expect(containsSpecificSecretBytes(payload)).toBe(true);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("rejects a static string-concatenated unkeyed Supabase service-role JWT", async () => {
    const secret = createTestJwt({ role: "service_role" });
    const midpoint = Math.floor(secret.length / 2);
    const payload = `\0const serviceRole = "${secret.slice(0, midpoint)}" + "${secret.slice(midpoint)}";\0`;

    await expectOpaquePayloadToReject(encoder.encode(payload), secret);
  });

  it("rejects escaped concrete secret values in opaque payloads", async () => {
    const serviceRoleJwt = createTestJwt({ role: "service_role" });
    const escapedServiceRoleJwt = serviceRoleJwt
      .replace(/^e/, "\\u0065")
      .replaceAll(".", "\\u002e");
    const escapedGithubToken = `ghp\\u005f${"a".repeat(36)}`;
    const payloads = [
      escapedServiceRoleJwt,
      "sk\\u005ftest_testonly0123456789abcdef",
      escapedGithubToken,
      "postgresql\\u003a//creator:fixture-password@db.creatorx.example/creatorx",
      "sb\\u005fsecret_testonly-abc_123",
    ];

    for (const secret of payloads) {
      await expectOpaquePayloadToReject(encoder.encode(`\0${secret}\0`), secret);
    }
  });

  it("rejects UTF-16 public secret-key assignments in opaque payloads", async () => {
    const secret = "z9";
    const source = `c.NEXT_PUBLIC_EDGE_SECRET_KEY = "${secret}"`;
    const payloads = [
      encodeUtf16LittleEndianWithBom(source),
      encodeUtf16BigEndianWithBom(source),
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToReject(payload, secret);
    }
  });

  it("rejects public secret-key assignments with ASCII characters interleaved by C0 controls", async () => {
    const secret = "z9";
    const source = `c.NEXT_PUBLIC_EDGE_SECRET_KEY = "${secret}"`;

    for (const control of [0, 1, 8, 14, 31, 127]) {
      await expectOpaquePayloadToReject(
        interleaveControlBytes(source, control),
        secret,
      );
    }
  });

  it("does not flag comments or literal backslash text that merely mention a public secret-key name", async () => {
    const payloads = [
      "\0/* NEXT_PUBLIC_EDGE_SECRET_KEY */\0",
      '\0const label = "NEXT_PUBLIC_EDGE_SECRET\\u005fKEY";\0',
      '\0const config = { "NEXT_PUBLIC_EDGE_SECRET\\\\u005fKEY": "public-value" };\0',
    ];

    for (const payload of payloads) {
      await expectOpaquePayloadToPass(encoder.encode(payload));
    }
  });

  it("does not crash on an incomplete opaque JWT fragment", async () => {
    await expectOpaquePayloadToPass(encoder.encode("\0eyJhbGciOiJub25lIn0.\0"));
  });

  it("does not flag a NUL-delimited Supabase anon JWT in opaque payloads", async () => {
    const anonKey =
      "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlIjoiYW5vbiIsInRlc3QiOnRydWV9.test_signature_not_real";
    const opaquePayload = encoder.encode(
      `\0NEXT_PUBLIC_SUPABASE_ANON_KEY: "${anonKey}"\0`,
    );
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/opaque.bin", content: opaquePayload },
      ],
    });
    const outDir = await createTemporaryClientOutput(
      opaquePayload,
      "opaque.bin",
    );

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      appName: "creatorx",
      hasWebIndex: true,
    });
    await expect(scanClientSecrets({ outDir })).resolves.toEqual({
      filesScanned: 1,
    });
  });

  it("rejects a Stripe secret assigned to a public configuration key without echoing it", async () => {
    const secret = ["sk_", "live_", "testonly0123456789abcdef"].join("");
    const publicConfig = `const config = { NEXT_PUBLIC_STRIPE_SECRET_KEY: "${secret}" };`;
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/public-config.js", content: publicConfig },
      ],
    });

    const artifactFailure = await verifyAitArtifact(artifact).catch(
      (error) => error,
    );
    expect(artifactFailure).toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/public-config.js",
    });
    expect(String(artifactFailure.message)).not.toContain(secret);

    const outDir = await createTemporaryClientOutput(publicConfig);
    const clientFailure = await scanClientSecrets({ outDir }).catch(
      (error) => error,
    );
    expect(clientFailure).toMatchObject({
      code: "CLIENT_SECRET_DETECTED",
      message: "Suspected secret in client output: public-config.js",
    });
    expect(String(clientFailure.message)).not.toContain(secret);
  });

  it("rejects a Supabase service-role key assigned to a public configuration key without echoing it", async () => {
    const secret =
      "eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIiwidGVzdCI6dHJ1ZX0.not-a-real-signature";
    const publicConfig = `const config = { NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "${secret}" };`;
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        { name: "web/public-config.js", content: publicConfig },
      ],
    });

    const artifactFailure = await verifyAitArtifact(artifact).catch(
      (error) => error,
    );
    expect(artifactFailure).toMatchObject({
      code: "AIT_SECRET_DETECTED",
      message: "Suspected secret in entry web/public-config.js",
    });
    expect(String(artifactFailure.message)).not.toContain(secret);

    const outDir = await createTemporaryClientOutput(publicConfig);
    const clientFailure = await scanClientSecrets({ outDir }).catch(
      (error) => error,
    );
    expect(clientFailure).toMatchObject({
      code: "CLIENT_SECRET_DETECTED",
      message: "Suspected secret in client output: public-config.js",
    });
    expect(String(clientFailure.message)).not.toContain(secret);
  });

  it("does not flag normal NEXT_PUBLIC configuration", async () => {
    const artifact = await buildFixture({
      files: [
        { name: ENTRYPOINT, content: "<!doctype html>" },
        {
          name: "web/public-config.js",
          content: JSON.stringify({
            NEXT_PUBLIC_API_URL: "https://api.example.com",
            NEXT_PUBLIC_RELEASE_CHANNEL: "production",
          }),
        },
      ],
      metadata: {
        packageJson: {
          NEXT_PUBLIC_API_URL: "https://api.example.com",
          NEXT_PUBLIC_RELEASE_CHANNEL: "production",
        },
      },
    });

    await expect(verifyAitArtifact(artifact)).resolves.toMatchObject({
      appName: "creatorx",
      hasWebIndex: true,
    });
  });
});
