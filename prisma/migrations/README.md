# Prisma migrations

- Production database: MySQL 8.
- New migrations must contain MySQL SQL and must pass `pnpm migration:check:mysql`.
- Production must never use `prisma db push`.
- The release gate is `pnpm migration:check:mysql`, `pnpm migration:preflight`, staging `migrate deploy`, then production `migrate deploy`.
- An applied migration is immutable. Historical checksum drift is recorded, not repaired by rewriting the applied file.
- If production already has the target structure but `_prisma_migrations` has no row, stop before deploy, run the read-only DDL equivalence audit, and let a human decide whether `resolve --applied` is appropriate.
- Scripts never auto-resolve, never reset, never delete `_prisma_migrations`, and never run production DDL/DML as part of preflight.

## RateLimitLog historical closure

`20260821120000_add_rate_limit_log` is recorded as `FAILED_THEN_APPLIED`:

- the first record rolled back with MySQL 1050 because `RateLimitLog` already existed;
- a later record has `finished_at` set and `rolled_back_at` unset;
- the successful record checksum matches the repository migration checksum;
- the production table is structurally equivalent.

Therefore do not run `resolve --applied` again, do not create a reconciliation migration, and do not modify the applied migration. The original table creation origin remains `UNKNOWN` and is historical provenance only; it does not block application release.

The legacy cutoff and known historical facts are maintained in `../migration-history.json` and `../../docs/database-migrations.md`.
