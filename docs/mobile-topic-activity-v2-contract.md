# Mobile Topic Activity V2 contract candidate

Baseline: remote main `1a0c8b9d85c7aa61f5a70e37bcdee563b5bff063`.
Candidate: `feature/mobile-topic-activity-v2`.

## Changes

Existing Cookie/Bearer guards, middleware, write services, rewards, badge ownership,
schema and migrations remain authoritative. No new route or parallel business
service is introduced.

- `GET /api/activities/{id}/v2` adds `availability`: server activity status,
  per-entry decisions, poll/test and fixed-claim decisions. These are read-only UI
  hints. Actual write services still validate active account, form/comment
  eligibility, proof ownership, windows, pending duplicates, limits and evidence
  inside existing transactions. Missing hints must not become client eligibility.
- `GET /api/activities/{id}/v2/tasks` keeps owner scope (or explicit authorized
  administrator scope) and existing private original links, adding signed
  `url`/`thumbnailUrl` from the established asset serializer. The raw image rows
  are not returned as a second field. Signed previews expire and renew on refresh.
- `GET /api/activities/me/topic-participations` includes actual poll, test,
  participation and reward rows in its owner-scoped paginated activity aggregation.
  New additive counts: pollVoteCount, testAttemptCount, rewardGrantCount,
  pendingRewardGrantCount, grantedRewardGrantCount. Reward status falls back to
  persisted grants if no participation row exists. Activity details are restricted
  to PUBLISHED/CANCELLED; pagination has a deterministic activity-ID tie-breaker.

A fixed reward may have its own claim window extending past the activity date.
The availability hint respects that configured window, matching the existing
claim service. This does not reopen participation or task submission.

## Verification

Directed unit and route suites use controlled transaction/Prisma/auth doubles:
92 pass, 0 fail, 0 skip. Static BirthdayMessage/schema/migration checks: 19 pass.
These tests cover request guards, privacy, submission eligibility/deadlines,
pending repeats, resubmission, independent platform/entry caps, points and badge
idempotency, poll/test contracts, lottery privacy, and existing integration
boundaries. They do not prove deployed MySQL row locking or financial acceptance.

Prisma generate/validate uses an unreachable local placeholder rather than
production credentials. No production database or isolated MySQL write test ran.
Full Server tests are deliberately not run without an explicitly approved
isolated test database.

## Migration fixture audit

Current schema, the BirthdayMessage creation migration, current MySQL baseline
and baseline draft retain the cake-emoji default. No current source fixture
mismatch was found. The earlier report of a question-mark default concerned a
separate local bootstrap run and is retained as historical evidence; it is not
a new production database observation. No historical migration was rewritten.

## Release boundary

This branch is a candidate for later integration. No deployment, main merge,
migration application, production reward issuance or production write occurred.
The Mobile inventory and V1-to-V2 gap matrix are in the companion Mobile
`docs/topic-activity-v2-integration.md` manifest.
