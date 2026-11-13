# RC14 TDSQL-C trust chain

`tdsql-c-mysql-ca.pem` contains only the CDB intermediate CA and Tencent root CA extracted from the administrator-provided `TencentDB-SSL-CA.zip` on 2026-11-13. It contains no private key. Redis and SQL Server intermediates from the original bundle are excluded.

- CDB CA SHA256: `1FA929BBD66489637E008E61D070DCC47A4AF5DBFC8BBE086E6F32864C921956`
- Root CA SHA256: `70E2E9FCC3067F87CBB54BB1D9AAEC2547F15FF483BEA1EC8C5C67401F726F01`

The CDB signature and root self-signature were verified. These public pins alone do not prove the production endpoint is trusted. The workflow additionally requires OpenSSL chain validation, hostname/IP validation and a cryptographic peer path through this exact CDB CA to this exact root.

The default `verify` mode writes nothing and sends no database credentials. `install` first repeats peer proof, then installs the CA as mode `0444`, verifies an encrypted strict Prisma connection, and updates only the TLS URL parameters under the deployment lock and production SHA/environment CAS. Configuration backups use mode `0600`; they are not permission to restore plaintext connectivity.

Isolated validation used a separate disposable MySQL instance with secure transport required: a strict Prisma connection with the correct CA and an encrypted session succeeded; the wrong CA was rejected; an explicit wrong hostname was rejected with OpenSSL verification code 62. Production acceptance remains a separate required check.
