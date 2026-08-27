# MySQL baseline candidate

This directory contains a disposable local-test baseline generated from the
current `prisma/schema.prisma` with Prisma `migrate diff`.

- Provider: MySQL 8
- Status: `CANDIDATE`
- Production verification: `false`
- This is not a Prisma migration and must not be placed under
  `prisma/migrations/`.
- It must not be applied to production or used to alter `_prisma_migrations`.

Generation command:

```text
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script --output prisma/mysql-baseline/current/baseline.sql
```

The candidate is validated only against the isolated Docker database
`easonfansclub_anywhere_door_test` on `127.0.0.1:3307`. The existing 107
historical migration files remain unchanged.
