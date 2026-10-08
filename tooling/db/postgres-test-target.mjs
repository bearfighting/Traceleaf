export function assertPostgresTestAdminTarget(adminUrl, databaseName) {
  let target;
  try {
    target = new URL(adminUrl);
  } catch {
    throw new Error("TEST_POSTGRES_ADMIN_URL must be a valid PostgreSQL URL.");
  }

  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("TEST_POSTGRES_ADMIN_URL must use PostgreSQL.");
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname)) {
    throw new Error("TEST_POSTGRES_ADMIN_URL must target a loopback PostgreSQL host.");
  }
  if (target.pathname !== "/postgres") {
    throw new Error("TEST_POSTGRES_ADMIN_URL must target the postgres maintenance database.");
  }
  if (databaseName !== undefined && !/^analytics_test_[a-z_]+_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("Refusing an invalid PostgreSQL test database name.");
  }
}
