# CreatorX Vercel and Supabase production runbook

## Scope and safety boundary

This runbook prepares a production deployment; it does not create a Vercel project, Supabase project, database, domain, Toss credential, or secret. Store production values only in the Vercel Production environment scope (or an equivalent managed secret store). Do not commit them to `.env*`, `vercel.json`, shell history, screenshots, release evidence, or tickets.

Vercel deploys the server/API with `npm run build`. Do not use `build:appintoss` as Vercel's build command: that command intentionally hides `app/api` to create a static App-in-Toss bundle.

## Production environment mapping

Set these in the **Production** environment only:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase pooled PostgreSQL URL for runtime requests. |
| `DIRECT_URL` | Supabase direct PostgreSQL URL for migrations. |
| `CREATORX_ACCESS_TOKEN_SECRET` | Server-only CreatorX access-token signing secret. |
| `CREATORX_IDENTITY_PEPPER` | Server-only identity hash pepper; at least 32 characters. |
| `CRON_SECRET` | Server-only cron authorization secret. |
| `NEXT_PUBLIC_APP_IN_TOSS` | `1`. |
| `NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL` | `production`. |
| `NEXT_PUBLIC_CREATORX_DATA_MODE` | `remote`. |
| `NEXT_PUBLIC_CREATORX_API_BASE_URL` | Root HTTPS origin of the deployed CreatorX API, without a path, query, fragment, or credentials. |
| `NEXT_PUBLIC_CREATORX_OPERATOR_NAME` | Verified production operator name. |
| `NEXT_PUBLIC_CREATORX_SUPPORT_URL` | Verified remote HTTPS support URL. |
| `NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT` | Verified privacy contact. |
| `NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE` | Effective date in `YYYY-MM-DD` form. |
| `NEXT_PUBLIC_CREATORX_ICON_URL` | CreatorX-owned remote HTTPS icon URL; never the Toss logo. |
| `TOSS_LOGIN_ENABLED` | `0` until Toss Business verification and server mTLS are ready; otherwise `1`. |
| `NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED` | Must exactly match `TOSS_LOGIN_ENABLED`. |
| `TOSS_MTLS_CERT_BASE64` | Required only when Toss Login is `1`; base64-encoded PEM certificate. |
| `TOSS_MTLS_KEY_BASE64` | Required only when Toss Login is `1`; base64-encoded PEM private key. |

Do not set `CREATORX_DEV_CORS_ORIGINS` in production. Vercel's `VERCEL=1` attests its trusted proxy; non-Vercel production environments must set `CREATORX_TRUST_PROXY=1` only when their proxy strips and replaces forwarded headers.

The API CORS allowlist is code-managed and contains only the private and published CreatorX Toss origins. Do not add wildcard or static CORS headers in `vercel.json`.

## Accepted Supabase PostgreSQL topology

`npm run production:preflight` intentionally accepts only these non-secret endpoint shapes for the same `<project-ref>` and database name:

| URL | Host and port | Required username shape |
| --- | --- | --- |
| `DIRECT_URL` | `db.<project-ref>.supabase.co:5432` | Any approved direct database role. |
| `DATABASE_URL` (shared Supavisor) | `aws-<region>.pooler.supabase.com:5432` or `:6543` | A role ending in `.<project-ref>`, such as `postgres.<project-ref>`. |
| `DATABASE_URL` (dedicated runtime) | `db.<project-ref>.supabase.co:6543` | An approved runtime database role. |

Set `pgbouncer=true` on `DATABASE_URL` for Prisma compatibility; it does not make a direct endpoint into a runtime pooler. `DIRECT_URL` must remain the direct `db.<project-ref>.supabase.co:5432` endpoint and must not set that option. The preflight derives the project ref from `DIRECT_URL`, then rejects a runtime URL for another project, a direct endpoint used as runtime, a pooler used as direct, or a generic remote PostgreSQL URL. Never paste credentials into this runbook or release evidence.

## Release sequence

1. Configure the values above in the Vercel Production environment scope and keep Preview/Development values separate.
2. Run migrations from a controlled release environment with production `DIRECT_URL` available:

   ```powershell
   npx prisma migrate deploy
   ```

   `npm run db:migrate` is intentionally test-database guarded and is not the production migration command.
3. Run the fail-closed checks with the intended Production environment loaded:

   ```powershell
   npm run production:preflight
   npm run build
   ```

4. Deploy the Vercel project. Verify the HTTPS endpoint returns only a status and safe revision:

   ```powershell
   curl.exe -fsS https://<production-api-origin>/api/health
   ```

5. Build the App-in-Toss production artifact with the same approved production environment:

   ```powershell
   npm run build:appintoss:production
   npm run build:ait
   npm run verify:artifact
   npm run scan:client-secrets
   ```

6. Record only deployment IDs, commit SHA, test output summaries, health status, and artifact checksum/size in release evidence. Never record secret values.

## Rollback

1. Stop promotion/upload if preflight, health, artifact verification, or secret scan fails.
2. Promote a known-good previous Vercel deployment after confirming its migration compatibility.
3. Do not run destructive down migrations during an incident. Use a reviewed forward migration/fix, or follow the separately approved Supabase backup-restore procedure when data restoration is required.
4. Re-run health, CORS, artifact verification, and secret scan evidence after rollback.

## External gates

Actual production release remains blocked until the project owner supplies approved Vercel/Supabase configuration, legal/operator data, real HTTPS API origin, and—if enabled—Toss Business mTLS credentials. This runbook deliberately does not replace those approvals with placeholders.
