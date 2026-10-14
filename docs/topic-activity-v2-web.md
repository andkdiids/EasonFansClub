# Topic Activity V2 Web candidate

## Status and isolation

Feature branch: `feature/topic-activity-v2-web`.
Functional base: locked V6.1.2 RC `47396d19842755491e9634605a7d535c163b4495`.
Reference main `a9a48fad74afb6aff4bdd742438533c430cc82a4` was audited but not merged: its infrastructure lineage diverges from the locked functional RC. This is a development candidate, not a current-production release candidate. Locked RC, main, Mobile, Cantonese and production remain untouched. V6.1.2 release remains NO-GO.

## Modules and legacy compatibility

Existing Activity fields/layout/post relationship and auth are reused. `topicProgram` is nullable; old activities stay on the existing legacy path, with no automatic enablement or guessed platform mappings.

The existing activity editor expands a versioned native form for materials, platform tasks, independent fixed points, medal triggers, poll, test and poster. New tasks create real root Replies and a separate submission ID. Comments/replies, form eligibility, SINGLE lifetime allowance, original-image upload and private stream access are reused. Every task submission crosses a confirmation dialog. Task review uses the existing controlled review dialog and preserves errors/drafts during failure.

Platform entries have stable IDs and immutable platform identities after use; omitted entries are archived, not physically deleted. The submission saves the entry's amount/rules/platform snapshot. Review uses that snapshot, not the subsequently edited entry.

## Financial and concurrency boundaries

Mutations use Serializable transactions with bounded conflict/unique-race retry and a parameterized Activity row lock. Platform grants are unique by activity/entry/user and deterministic grant key. The distinct-platform cap and optional entry cap use durable GRANTED ledgers, not current comment counts; deletion/reversal does not reopen paid capacity. Same-platform entries independently pay while occupying one platform slot. Resubmission is configurable, retains history and never repays an awarded entry.

Fixed claims use the existing legacy activity/user/points key, preserving historical award deduplication. Automatic conditions use real approved-comment/vote/test evidence. Manual claims are PENDING and use a saved amount/effective-time snapshot. The legacy scheduled dispatcher excludes non-LEGACY grants, so manual claims cannot be auto-awarded.

Points changes lock the User and verify PointLog businessKey before incrementing, then write balance before/after and ledger in the same transaction. Invalid/overflow amounts fail without partial writes.

Medals delegate to the existing transactional badge grant service and global ownership uniqueness. One granted activity medal protects against later binding changes. Event triggers are explicit; valid-window late review defaults to allowed and uses effective participation time. Badge presentation/series effects run only after the parent commits, never after a rollback; effect errors cannot rewind committed rewards.

## API contracts

All personalized responses are `private, no-store`, varying on Cookie/Authorization. API route handlers reuse request-user/request-admin guards; mutation origin and rate limits remain enforced. Business services receive authenticated IDs and do not depend on browser state. Future native clients can reuse the same handlers with normal Mobile Bearer authentication (no App implementation in this branch).

| Route | Purpose |
| --- | --- |
| Existing `/api/activities` and activity detail | Existing list/detail; V2 remains optional |
| `GET /api/activities/{id}/v2` | Public redacted config and authenticated own progress |
| `GET/POST .../v2/tasks` | Own submissions (admin explicit all scope) / task submission |
| `POST .../v2/fixed-reward` | Independent fixed claim |
| `GET/POST .../v2/poll` | Safe results/my ballot / server-validated choices |
| `GET/POST .../v2/test` | Redacted questions / server-calculated answers result |
| `GET .../v2/attempts` and `.../{attemptId}` | Owner-only historical snapshots |
| `GET .../v2/attempts/{attemptId}/poster` | Owner-only PNG from stored result, not caller content |
| `GET .../v2/submissions/{submissionId}/assets/{assetId}/original` | Authenticated owner/admin stream, triple relationship checks |
| `GET/PATCH /api/admin/activities/{id}/v2` | Existing activity_manage permission; config/statistics |
| `GET/PATCH .../v2/submissions/{submissionId}` | Review history / atomic review and reward |
| `GET/POST .../v2/fixed-reward` | Manual fixed claim queue / explicit decision |

Correct option IDs and personality weights are stripped from public config. Other users' private screenshots/reject reasons and answers are not exposed. Original images remain separate from previews and use existing private namespaces. PNG background paths allow only designated public image namespaces, never arbitrary HTTP URLs/private task images/path traversal. Posters are ephemeral responses; no generated image database/storage writes or runtime AI calls.

## Poll, test and poster

Polls store one effective ballot per activity/poll/user; invalid choices, duplicates, over-limit selection, forbidden changes and closed-window participation fail. Percentages use participating people, not summed selections. Ballot config cannot be silently rewritten once used.

Tests calculate knowledge scores/personality weights on Server. Request keys deduplicate network retries, reject conflicting reuse, and retakes follow configuration. Historical result snapshots retain title/text/version/result/poster/nickname at completion. Same-version used configs cannot be silently edited; an explicit version increase/new ID is required.

The user stepper supports previous/next/progress, own history, authenticated PNG preview/download and native file share when supported. Unsupported Web Share falls back to saving the PNG; WeChat long-press preview is present. No AI image service or platform API is invoked.

## Migration and operational rollback plan

New migration: `20261013100000_add_topic_activity_v2_web` (base repository 171, candidate 172).
Adds three tables (RewardEntry, PollVote, TestAttempt), nullable configuration/snapshot/association fields, ledger origin default LEGACY, indexes and foreign keys. No DROP/RENAME/data rewriting or historical migration edits. Baseline SQL/metadata stay immutable per repository snapshot convention.

Before any future release, perform isolated MySQL migrate/rollback compatibility and real concurrent financial tests, obtain a separately approved current-production integration RC, and complete normal authenticated staging QA. This task does not authorize production deployment/migration.

Safe rollback is application/module disablement with the additive schema retained. Never drop V2 tables/columns or erase submission, review, PointLog or badge history. Returning to old application code must also keep new-origin pending grants out of the legacy reward dispatcher; arbitrary pre-V2 application rollback without that guard is unsafe. Audit pending claims/paid grants before any rollback approval.

## Verification limits

Unit/service tests use a rollback-capable serialized transaction double and badge adapter doubles; these demonstrate rule behavior, not real MySQL row locking. Local Docker daemon/MySQL are unavailable, so real migration application, FK enforcement and cross-process concurrency are PENDING.

Browser tests execute real components against localhost fixtures and the production stylesheet at desktop and 360/390/430px. V2 task confirmation, poll, test navigation, server-result display, PNG download/long-press fallback, review error/pending protection, history and config save are covered. V6 browser compatibility is separately executed. Android/WeChat user-agent emulation is not physical device QA; iOS WebKit and real WeChat remain PENDING.

Fresh base full suite: 3787 PASS / 16 FAIL / 6 SKIP. Candidate failure sets must be compared by test names, not by totals alone. Existing failures include unrelated UI source assertions and missing incremental SQL test fixture. No baseline failures are hidden or repaired as part of V2.

## Local verification result (2026-10-13)

- Topic + Mobile-auth directed regression: 160 PASS, 0 FAIL, 6 browser-gated SKIP. Browser-gated suites were executed separately.
- Full candidate: 3832 PASS, 16 FAIL, 7 SKIP; the 16 failure names exactly match the fresh base, NEW FAILURES = 0.
- Actual V2 and V6 browser suites: 2/2 PASS. Additional V5/V6.1/V6.1.1/V6.1.2 browser regression: 15/15 PASS.
- TypeScript, Prisma validate/generate/format check, production build, diff check and sensitive scan PASS. Lint: 0 errors, 130 warnings (including intended native-image previews and existing repo warnings).
- Pure Prisma schema diff matches the additive migration; existing 171 migration files and baseline snapshot are unchanged. No production migration was executed.
- All browser endpoints and financial records in automated tests were local fixtures, not production. PRODUCTION WRITE = 0, DEPLOY = NO, APK = NO.
- Physical WeChat/iOS QA and current-production integration remain blockers before release approval. This development verification does not change the NO-GO release decision.

## Acceptance follow-up (2026-10-13, before optional lottery increment)

Fresh verification at `5eb259da` reproduced directed 160 PASS, browser 17 PASS,
and full candidate 3832 PASS / 16 FAIL / 7 SKIP. Real MySQL then exposed a
Serializable lock cycle: review read Submission before acquiring Activity.
Review now resolves only its lock target outside the transaction, then locks
Activity and rereads the authoritative Submission. Raw MySQL 1213/1205 errors
wrapped as Prisma P2010 get bounded retries after rollback; unrelated raw
errors do not retry. No authorization or financial semantics were relaxed.

Final directed regression: 161 PASS / 0 FAIL / 7 opt-in SKIP. Fresh full base:
3787 PASS / 16 FAIL / 6 SKIP; final candidate: 3833 PASS / identical 16 FAIL /
8 SKIP. NEW FAILURES = 0. Real database/browser suites are separately enabled.

### Real isolated MySQL evidence

MySQL Community Server 8.4.11 runs only on loopback port 33307, from an
ephemeral ASCII-path directory, without installation as a service or loading
machine defaults. Only explicit disposable test databases are used; the test
rejects other hosts, ports, database names and URL overrides before importing
the application Prisma client. It never inherits a production DATABASE_URL.

`tests/topic-activity-v2-mysql.test.ts`: **21 PASS, 0 FAIL**, including its
parent suite (20 behavioral cases). The locked pre-V2 schema was bootstrapped
in an empty isolated database. Legacy rows were inserted before the unchanged
V2 SQL was actually executed. Existing statuses, values, PointLogs and balance
were preserved; LEGACY origin and nullable new fields behaved correctly.

Coverage includes 20 simultaneous approvals, concurrent duplicate root-comment
submission, rejection/resubmission, same-platform multiple entries, platform
and entry caps, real unique/FK violations, reward snapshots, deliberate
PointLog constraint failure with full transactional rollback, independent fixed
points, real badge service across concurrent event types, manual claim replay,
Form/admin-reply eligibility, poll replay, persisted knowledge/personality
results across disconnect/another client, ownership denial and valid PNG bytes.

Separately, the Prisma migration engine successfully applied a **test-only
locked-schema bootstrap** followed by the byte-identical
`20261013100000_add_topic_activity_v2_web`, into a second fresh local database.
This verifies the new migration on the prior schema, not a replay of all 171
historical migrations. Historical migrations/baseline files were not altered.

Run the opt-in suite only after bootstrapping the pre-V2 schema into a new
`ecfc_topic_v2_acceptance_20261013` database on 127.0.0.1:33307:
`TOPIC_V2_MYSQL_QA=1`, explicit `TOPIC_V2_MYSQL_URL`, then
`pnpm exec tsx --test tests/topic-activity-v2-mysql.test.ts`.
It refuses an already migrated database rather than resetting data implicitly.

Final browser suites: **17 PASS, 0 FAIL**. Actual production components/CSS run
at desktop and 360/390/430 widths. Knowledge and personality flows, read-only
history restoration, valid downloaded PNG bytes, unsupported-share fallback,
file-share contract, review failure/double clicks and task confirmation pass.
Endpoints are local fixtures; OS share-sheet handling is a contract stub, not
physical device verification. Authenticated staging end-to-end, iPhone Safari
and real WeChat save/share remain **PENDING**.

### Existing 16 failures: impact audit

Thirteen are CRLF-sensitive source-contract assertions, not absent behavior.
A temporary read-only source-line normalization preload reproduced **87 PASS /
3 FAIL** for the 90 tests in the affected files on both base and candidate.
It changed no checkout bytes and was not used to claim the raw full suite green.

| Existing failing area | Count | V2 dependency / impact |
| --- | ---: | --- |
| badge glow, badge display cap | 2 | Shared badge presentation and comment display; implementation present; source newline assertion |
| notification names, avatar propagation, profile relationship states | 3 | Shared notification/profile UI; implementation present; source newline assertion |
| birthday partial form | 1 | Unrelated profile flow; source newline assertion |
| mobile forum action ordering | 1 | Other detail UI; source newline assertion |
| chat sticker focus | 2 | Unrelated chat; source newline assertion |
| friend list restoration | 3 | Unrelated friends; source newline assertion |
| want-listen transaction client | 1 | Unrelated game; source newline assertion |
| Anywhere Door incremental SQL fixture | 3 | Missing `tmp/PRODUCTION_INCREMENTAL_CANDIDATE.sql`; historical migration validation gap |

No failure directly targets new V2 code. Shared-path risks are not dismissed
solely because baseline also fails: real badge service, comments/review and
browser regressions run separately. The three missing-fixture release checks
remain unresolved; they require an independently reviewed reproducible fixture
or explicit release-gate disposition. No fabricated fixture or test skipping
was committed to turn the release gate green.

### Safe integration plan / NO-GO

Remote main is `a9a48fad74afb6aff4bdd742438533c430cc82a4` (163 migrations),
locked V6.1.2 is `47396d19` (171), V2 is its descendant (172). Remote main
is not proof of the actual deployed SHA. A fresh approved production read-only
diagnostic is required in a separate release task; none was invoked here.

Read-only merge-tree simulation found three conflicts: `deploy.yml`,
`middleware.ts`, `tests/ecenter-features.test.ts`. Retain RC deployment safety,
exact-SHA/health/rollback checks and add main's paths-ignore behavior; retain
Cantonese/V2 Bearer/public-route guards and add main's home/share routes; retain
request-user Ecenter tests. Do not cherry-pick only V2 onto main: that would
omit RC's Topic/Cantonese schema, APIs and eight prerequisite migrations.

The existing locked-RC production policy still allows only SHA `47396d19`, 171
migrations and its existing path list; it cannot authorize V2's new schema and
paths. Prepare an isolated integration RC, resolve/reverify these conflicts,
preserve all Cantonese progress, approve a new SHA/migration policy, resolve the
remaining validation gaps and complete physical QA before release approval.
No merge, policy weakening, locked-RC edit or production operation occurred.
