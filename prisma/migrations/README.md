# Prisma migrations

- Production database: MySQL 8.
- New migrations must contain MySQL SQL and must pass `pnpm migration:check:mysql`.
- Production must never use `prisma db push`.
- The release gate is `pnpm migration:check:mysql`, `pnpm migration:preflight`, staging `migrate deploy`, then production `migrate deploy`.
- An applied migration is immutable. Historical checksum drift is recorded, not repaired by rewriting the applied file.
- If production already has the target structure but `_prisma_migrations` has no row, stop before deploy, run the read-only DDL equivalence audit, and let a human decide whether `resolve --applied` is appropriate.
- Scripts never auto-resolve, never reset, never delete `_prisma_migrations`, and never run production DDL/DML as part of preflight.

The legacy cutoff and known historical facts are maintained in `../migration-history.json` and `../../docs/database-migrations.md`.
