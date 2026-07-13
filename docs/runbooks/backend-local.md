# Local backend database

This harness runs PostgreSQL 16 in Docker and exposes only the isolated
`creatorx_test` database on `localhost:54329`. It is intended for local
integration tests, not production or shared databases.

## First-time setup

From the repository root:

```powershell
Copy-Item .env.test.example .env.test.local
npm run db:up
docker compose ps postgres
npm run db:migrate
npm run test:integration -- tests/integration/database-health.test.ts
```

Wait until `docker compose ps postgres` reports `healthy` before migrating.
`test:integration` also deploys pending Prisma migrations in its guarded global
setup, so later runs need only the database and `.env.test.local`.

## Safety guarantees

- `.env.test.local` is ignored runtime state. Never stage or commit it.
- The integration global setup refuses to run unless both `DATABASE_URL` and
  `DIRECT_URL` target the same database and its name ends in `_test`.
- The setup runs `prisma migrate deploy`; it never runs `prisma migrate reset`,
  drops a database, or invokes the repository's live YouTube seed.
- The only seeded rows use fixed identifiers, values, and timestamps. They are
  upserted, so rerunning setup is deterministic and does not delete other rows.

## Stop and resume

```powershell
npm run db:down
npm run db:up
```

`db:down` stops only this Compose service. It preserves the named PostgreSQL
volume so local test state is available after restart. Do not use
`docker compose down -v`; that removes the database volume.

To run the entire integration suite:

```powershell
npm run test:integration
```
