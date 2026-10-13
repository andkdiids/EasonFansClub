# Topic Activity V2 physical-prize lottery

Development branch: `feature/topic-activity-v2-lottery`. Descends from the V2
acceptance fix `7c3d201f51f4f21c89751fd4fe01ed0a1516268d`; the locked V6.1.2
checkout is unchanged. This is a development candidate, **not release approval**.

## Behavior and invariants

- Optional, default disabled; old activities create no lottery or eligibility.
- Existing platform fees, fixed rewards, medals, voting and quizzes are unchanged.
- Configure multiple physical prizes, exact quantity slots, display order,
  screenshot-entry sources, qualification cutoff, automatic/manual draw,
  address deadline, public-winner visibility and PII retention (1–365 days).
  Business date input/display uses Asia/Shanghai; comparisons use server time.
- One eligibility per activity/user. The source is an owned original screenshot
  attached to an active user's valid root-comment platform submission, submitted
  within the activity window and before the qualification deadline, and approved
  before freeze. Late approval of timely submissions is allowed. More platforms
  grant no additional chance. Rejection or deleted evidence cannot qualify.
- Valid pending submissions block freeze/draw. The administrator must resolve
  them through the existing review process; no automatic exclusion.
- First valid participation locks prize/rule changes, including changes to the
  selected platform-source rules. Configuration and qualification changes are
  audited. Generic activity editing also checks the same Activity row lock and
  cannot change qualification start/end times, activity type, form schema,
  participation mode or image gate after participation
  or freeze. Unchanged saves and explicit cancellation preserve existing records.
  There is no administrative winner replacement or re-draw endpoint.
- Activity locking, unique activity draw/user eligibility/prize slot constraints,
  and transactional conditional stock deductions serialize concurrent requests.
  Candidate and prize snapshots are frozen first; CSPRNG Fisher–Yates sampling
  uses the existing crypto.randomInt implementation. Allocation is persisted
  separately before finalization. Failure/retry reuses the committed allocation;
  it cannot silently draw a new list. Canonical hashes survive MySQL JSON key
  reordering. Capacity overflow fails closed instead of truncating the roster.
- Existing in-process scheduling and the existing authenticated daily-job route
  handle due automatic draws. Manual draws require an explicit confirmation and
  cannot run early. No new workflow, daemon or production restart was performed.
- Public result and owner result are redacted. Finalized awards survive activity
  closure. Overdue addresses are marked expired, never reassigned.

## Private fulfillment and notifications

Winner address access binds activity, actual winner and authenticated owner.
Admin PII/shipping access requires both `activity_manage` and the separate
`activity_lottery_shipping` permission. Mutations use normal Web auth, Origin
checks, bounded request bodies, rate limits and private no-store responses.

Addresses and logistics are AES-256-GCM encrypted with random IV and authenticated
activity/winner identity. Audit rows contain changed field names/hashes, not
address plaintext. Public APIs, notifications and PointLog never contain PII.
Winner edits require consent, a valid deadline and an unshipped record. Explicit
PII deletion and scheduled retention cleanup remove ciphertext only, preserving
winner/stock/audit history. No direct database access is required in the UI.

Optional environment variables: `TOPIC_LOTTERY_ADDRESS_KEYS` (versioned keyring)
and `TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID`. These are required to **enable**
physical lotteries, not to boot/build or use old activities. Missing/invalid keys
fail closed; no plaintext fallback. Keep previous keys available for rotation.
No production Secrets were read or changed in this task.

Notification delivery is a separate retryable transaction with a unique winner
delivery row and stable notification key. It uses the existing non-IGNORE
notification upsert helper: database write failures cannot be mistaken for a
successful delivery. A notification failure cannot roll back or lose a winner.

## Migration

`20261013120000_add_topic_activity_v2_lottery` adds seven TopicLottery tables,
an optional unique LotteryEntry slot relation, indexes and foreign keys. Reuses
existing Lottery, Prize, Entry, User, Submission and Notification models.
No DROP/RENAME, historical migration edit or baseline SQL rebuild. The branch
contains 173 migrations: locked 171 + V2 schema migration + lottery migration.

Actual Prisma migration execution was rehearsed against a standalone MySQL
8.4.11 engine bound only to `127.0.0.1:33307`, in disposable test databases.
Its bootstrap represents the locked schema; it is **not** a claim that the
entire historical production migration chain was replayed. No production
database, SSH, migration or deployment was used.

Additional drift audit: both independently bootstrapped local test databases
contain the existing BirthdayMessage.title default as `? 生日纪念`, whereas
the unchanged locked/current Prisma schema declares its cake emoji. Metadata
HEX confirms this is actual local DDL state, not just console display. The
lottery DDL does not touch this table; its seven new tables and slot relation
have no detected drift. Whole-schema diff is therefore **not clean** for the
test bootstrap. The bootstrap/encoding discrepancy needs separate investigation
before claiming complete schema parity or production migration release readiness;
no legacy migration or production table was modified to hide it.

## Verification and remaining release gates

Real local MySQL: V2 migration/legacy/concurrent-ledger regression **21 PASS**;
lottery migration/qualification/draw/fulfillment suite **27 PASS**. Tests include
12 concurrent draw requests, multiple platform awards, cutoff/late approvals,
pending freeze blocking, exact stock slots, no re-randomization after injected
finalization failure, ownership/IDOR, ciphertext/audit privacy, concurrent notice
delivery, injected notice failure/retry, deadline, retention and PointLog sums.

The test URL guard accepts only the explicit loopback port and named test DB;
gated MySQL tests are skipped by ordinary unit runs and were executed separately.
Synthetic test users, addresses and keys are never production credentials/data.

Browser checks use actual React components with isolated fixture HTTP endpoints
and local Edge. Desktop and 360/390/430 widths are browser QA, **not physical
iPhone Safari or WeChat verification**. Full production-auth staging acceptance
and physical browsers remain PENDING.

Latest combined browser regression: **18 PASS / 0 FAIL** (lottery plus existing
V2/V5/V6/V6.1/V6.1.1/V6.1.2 scenarios). Topic-directed plus legacy lottery and
cancellation regression: **229 PASS / 0 FAIL / 9 explicitly gated SKIP**, with
real MySQL/browser tests separately executed.
Full A/B used the same explicit local test URL and concurrency 8: locked base
**3787 PASS / 16 FAIL / 6 SKIP**, candidate **3852 PASS / 16 FAIL / 10 SKIP**.
All 16 failing names match; **NEW FAILURES = 0**. The initial extra preflight
failure was traced to schema formatting and a missing test-process DATABASE_URL;
both were corrected for the final same-environment comparison, without changing
the preflight test or fabricating the missing legacy fixture.
TypeScript, Prisma validate/generate, diff and sensitive-pattern checks passed;
lint has 0 errors / 132 warnings. Production build passed (a nonblocking circular
chunk warning reflects deferred service hooks; import smoke and real MySQL paths
passed). No encryption keys or live database are required to build.

Fresh remote main is `f8b70b994684856d2044ceab962b485c068d7543`, an infra-only
readonly-diagnostic successor to the earlier main snapshot. Read-only merge-tree
simulation still reports the same three conflicts: `.github/workflows/deploy.yml`,
`middleware.ts`, `tests/ecenter-features.test.ts`. Preserve its new guarded
readonly diagnostic tooling in the separately reviewed integration; no main
merge or existing workflow edit was performed here.

Release remains **NO-GO** pending reviewed current-production-base integration,
updated release/migration policy, fresh authorized production diagnostics,
resolution/disposition of the three missing legacy migration-fixture checks,
secure environment provisioning and staging/physical acceptance. The local
bootstrap default discrepancy also needs resolution. The earlier V2
acceptance report documents main/locked merge conflicts and baseline failures.
No App change, production write, merge-main, locked-RC modification or deploy.
