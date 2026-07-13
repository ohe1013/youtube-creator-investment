const DATABASE_URL_VARIABLES = ["DATABASE_URL", "DIRECT_URL"];

function testDatabaseName(environment, variableName) {
  const value = environment[variableName];

  if (!value) {
    throw new Error(
      `${variableName} must be set in .env.test.local before database commands run.`,
    );
  }

  let databaseName;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      throw new Error("unsupported database protocol");
    }
    databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run database command: ${variableName} targets database "${databaseName}", which does not end in "_test".`,
    );
  }

  return databaseName;
}

export function assertTestDatabaseUrls(environment = process.env) {
  const [databaseName, directDatabaseName] = DATABASE_URL_VARIABLES.map(
    (variableName) => testDatabaseName(environment, variableName),
  );

  if (databaseName !== directDatabaseName) {
    throw new Error(
      "Refusing to run database command: DATABASE_URL and DIRECT_URL target different test databases.",
    );
  }

  return databaseName;
}
