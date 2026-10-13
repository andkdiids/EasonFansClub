# Topic V2 + Lottery integration recovery — 2026-10-14

Local release-candidate preparation only. No production connection, SQL, SSH,
Actions dispatch, migration, server change, commit, push or deployment.

## Integration provenance

- Worktree: `ecfc-topic-v2-lottery-main-preflight`, branch `audit/topic-v2-lottery-main-preflight`.
- Uncommitted integration HEAD: `f8b70b994684856d2044ceab962b485c068d7543`.
- Existing MERGE_HEAD / feature source: `cbc22ce4d0feac91aae124205780c6ae3ac2b871`.
- Current remote main verified: `8f3c92cb1229c492ee0ed188bbef7c3d38d640b2`.
- Its three diagnostic-only file updates are preserved verbatim in this candidate.
- All 16 non-deployment main diagnostic/policy files match current main.
- The three original conflicts retain both intended changes; no conflict markers.
- Locked V6.1.2 `47396d19842755491e9634605a7d535c163b4495` is an ancestor of the feature source. Its checkout is not modified.
- HEAD and MERGE_HEAD are deliberately retained: resolving/staging a merge is not creating a merge commit.

## Four-stage migration and safety

The original lottery migration is an unpublished candidate. Only that draft was
redesigned; all 163 migrations already present on main retain their contents.
The final Prisma model is unchanged by the split. Candidate repository has 176
migration directories; this is NOT a verified production applied count.

1. `20261013120000_add_topic_activity_v2_lottery`: seven new tables and 14 new-table foreign keys.
2. `20261013121000_add_topic_lottery_winner_slot_column`: nullable slot column, explicit INSTANT.
3. `20261013122000_add_topic_lottery_winner_slot_index`: unique slot index, explicit INPLACE / LOCK=NONE.
4. `20261013123000_add_topic_lottery_winner_slot_fk`: validating COPY / LOCK=SHARED, original RESTRICT/CASCADE actions.

Every phase keeps foreign-key checks ON and a five-second metadata-lock wait
budget. There is no disabled-check path or silent algorithm fallback. COPY may
still rebuild the existing table and block writes: isolated success is not
production lock/capacity evidence. Five seconds is NOT the COPY execution limit.

Before any migration execution, `check-topic-lottery-maintenance.mjs` requires an
explicit approval record for new phases: exact release/production SHAs, exact
four phase hashes, UTC window, total migration and recovery budgets, writer
fence/capacity/backup/cancellation/ledger evidence references and confirmation
that the original draft has never been applied to a shared database. Positional
shell SHA arguments are explicitly passed to the child guard. Approval flags
and reference strings do not themselves prove those external conditions.

Each successful DDL remains committed independently. On failure: stop before
release switch, retain old runtime, capture failed ledger and actual schema,
verify that any server-side DDL has terminated, then reconcile explicitly under
separate authorization. Do not blindly redeploy, automatically resolve a failed
ledger entry, edit a published checksum or claim a symlink rollback restores DB.
Any remote approval-file delivery and unified release-policy update require a
separately reviewed release operation; no workflow boundary was relaxed here.

## Isolated MySQL evidence

The original MySQL 8.4.11 installation, port 33307, loopback binding and data
directory were reused. No directory move, partition change or file deletion.
The interrupted database and initial failing QA fixture remain preserved; the
successful service QA uses a new database `ecfc_topic_v2_acceptance_20261014b`.

Bootstrap is generated from the tracked locked pre-V2 Prisma schema, followed
by the actual V2 migration and all four lottery phases. This is NOT a replay of
the 21 archived PostgreSQL-era migrations on MySQL. The repository's MySQL
audit explicitly skips those 21 and passes the 155 MySQL-native migrations.

- V2 actual service / legacy ledgers / concurrent approvals: 21 PASS, 0 FAIL.
- Lottery eligibility / concurrent draw / notifications / private fulfillment: 27 PASS, 0 FAIL.
- Staged DDL / orphan rejection / lock / failed-ledger recovery: 13 PASS, 0 FAIL.
- All four phases preserved 10,000 historical winner rows and their fingerprints.
- Unique slot, invalid source, parent delete restrictions were enforced.
- A concurrent writer held MDL; COPY failed with 1205 at 5253 ms and no data loss.
- Invalid existing reference produced a failed COPY; earlier stages persisted.
- Prisma recorded P3018; blind re-deploy returned P3009. Only explicit local
  parent repair and test-only ledger reconciliation permitted a new apply.
- Successful phase ledger checksums match all four actual SQL files.

The initial prepared-statement harness rejected session DDL (1295). QA now uses
the explicitly local, no-defaults MySQL client and UTF-8 stdin for migration
SQL, retaining the original statements and session guard semantics.

## Birthday Emoji

Schema and historical SQL contain the correct UTF-8 cake symbol. On MySQL 8.4.11,
`COLLATION(INFORMATION_SCHEMA.COLUMNS.COLUMN_DEFAULT)` is `utf8mb3_bin` and its
metadata projection returns `3F20E7949FE697A5E7BAAAE5BFB5`. A default INSERT into
the actual utf8mb4 table returns `F09F8E8220E7949FE697A5E7BAAAE5BFB5`: the stored
default is intact. Do not repair production based on that lossy metadata alone.
SQL transport is explicitly UTF-8 stdin rather than Unicode SQL command argv.
No historical Birthday migration or business default was changed.

## Regression and fixture repairs

Baseline: 3852 PASS / 16 FAIL / 10 SKIP. The 16 are recorded individually in the
external evidence JSON: 13 CRLF-sensitive source assertions and three assertions
depending on an unrecoverable ignored incremental SQL artifact. Source assertions
now normalize line endings without weakening business checks. The incremental
fixture uses ordered tracked Anywhere Door migration SQL; it is not represented
as a recovered production artifact.

Recovery candidate full: 3902 PASS / 0 FAIL / 10 SKIP. Directed: 98 PASS / 0 FAIL /
4 opt-in SKIP; separately opted-in MySQL suites above were actually executed.
Latest main strict-readonly fixture: 218 PASS / 0 FAIL, no production operations.
Maintenance/deployment/auth final targeted regression: 28 PASS / 0 FAIL.
TypeScript PASS; Prisma validate/generate PASS (6.19.3); Lint 0 errors / 136
warnings; production Build PASS (122/122 pages). Three actual Chromium component
browser suites PASS at desktop/mobile viewports, including the V6.1.2 media
regression. The initial Windows fixture resolver failures were fixed only in the
two test files; real components and original assertions remain intact. Physical
iPhone Safari and WeChat are PENDING, not claimed as PASS. Final source-state full
regression after the last test-only/shell-argument fixes again passed 3902 /
0 FAIL / 10 SKIP. Final TypeScript and Lint also passed. Diff/security checks and
local staging evidence are retained externally. No merge commit is created:
resolved/staged integration remains awaiting authorization.

## Remaining production release dependencies

Local candidate readiness does not authorize release. Still required: a committed
and approved immutable unified SHA; authorized main integration; updated locked
release policy matching that SHA and migration plan; fresh authorized production
ledger/schema/capacity/MDL evidence; bounded maintenance and writer fence; proved
server-side cancellation and explicit partial-DDL recovery; approval-file wiring;
backup/restore evidence; and physical Safari/WeChat QA (not simulated as PASS).
V2 RELEASE GATE remains NO-GO. No automatic commit, push or deployment.
