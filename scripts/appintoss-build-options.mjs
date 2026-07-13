export class AppInTossBuildOptionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppInTossBuildOptionError";
  }
}

/**
 * Resolve the public build configuration without letting a production command
 * accidentally inherit the sandbox defaults.
 *
 * @param {{ argv?: readonly string[]; env?: Record<string, string | undefined> }} options
 */
export function resolveAppInTossBuildEnvironment({
  argv = [],
  env = process.env,
} = {}) {
  const base = {
    ...env,
    APP_IN_TOSS: "1",
    NEXT_PUBLIC_APP_IN_TOSS: "1",
  };

  if (argv.length === 0) {
    return {
      ...base,
      NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
        env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL ?? "sandbox",
      NEXT_PUBLIC_CREATORX_DATA_MODE:
        env.NEXT_PUBLIC_CREATORX_DATA_MODE ?? "demo",
    };
  }

  if (
    argv.length !== 2 ||
    argv[0] !== "--release-channel" ||
    argv[1] !== "production"
  ) {
    throw new AppInTossBuildOptionError(
      "Unsupported App-in-Toss build argument",
    );
  }

  return {
    ...base,
    NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
    NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
  };
}
