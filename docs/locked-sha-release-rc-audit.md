# Locked-SHA release candidate audit

Date: 2026-10-12. Local development and validation only.

## Isolation and version boundaries

- Candidate worktree: `C:\Users\Eason\Documents\私家E院\worktrees\ecfc-topic-activity-v612-locked-sha`.
- Candidate branch: `release/topic-activity-v612-locked-sha`.
- Starting HEAD: `088d4445f6357a8ee1f057a4ebce378caea6ba83` (existing V6.1.2 + deployment hardening RC).
- Expected production baseline: `635ae4a0e1d8eae9d93420517a17f4b29794896f`, supplied by the user. This task did not reverify live production SHA or database status.
- Production baseline ancestry is verified locally. Main-only Home/Growth Mobile Bearer commit `d9d63359883dfee83377810a0276f31ec2ada455` is not an ancestor of this RC.
- No changes to app, components, lib, Prisma schema, migrations, package versions or lockfile relative to the starting RC. V6.1.2 business code remains byte-for-byte unchanged in Git.
- Local migration directory count: 171; migration/schema diff: empty. This is not a fresh production migration diagnostic.

## Locked production SHA gate

`deploy-production-git.sh` now requires a sixth argument: `EXPECTED_PRODUCTION_SHA`.
After opening the existing deployment lock and obtaining exclusive `flock -n 9`, it resolves `current` and validates the release's `.deployed-sha` using `deploy_require_expected_production_sha`.
Mismatches or missing/malformed metadata stop the script before fetch, pruning/cleanup, release creation, build, migrations, symlink changes or PM2 reload.
Descriptor 9 remains open throughout deployment, health verification and EXIT/signal recovery.

Both local workflow call sites pass the sixth argument. The approved-SHA workflow passes the immutable expected baseline input, not a newly discovered replacement value. The legacy main deployment caller takes a preflight snapshot and the same in-lock gate rejects a subsequent change.

## Workflow validation and installation

Separate control-plane worktree: `C:\Users\Eason\Documents\私家E院\worktrees\ecfc-safe-sha-release-workflow`.
No control-plane draft files were merged into the application RC, and no main business commits were merged.

Real actionlint 1.7.12 downloaded from rhysd/actionlint's GitHub release; archive checksum matched the published checksum file:
`6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`.
It rejects `concurrency.queue`. Rather than suppress its syntax errors, drafts and candidate use standard `group` + `cancel-in-progress: false` concurrency, which passes actionlint. This does not assert that GitHub itself rejects `queue: max`; it means the chosen validator does not support it. Tradeoff: standard concurrency retains at most one pending run; an active deployment is not cancelled.

Actionlint passes for the candidate deploy workflow and all three control-plane draft workflows. Shellcheck/pyflakes integrations were disabled; embedded Bash blocks were separately parsed with Git Bash `bash -n` and JavaScript blocks were parsed and behavior-tested.

Main installation plan: `docs/safe-sha-release-main-installation.md` in the control-plane worktree.
Stage 1 contains only `.github/workflows/deploy.yml` (ignore `.github/**` pushes) and `.github/workflows/configure-production-entry.yml` (remove its push trigger). GitHub's documented CI-skip marker is an additional safeguard, not the only one.
Stage 2 installs only the manual workflow, guards/tests and exact release policy. No application files, RC merge, manual dispatch, production configuration or database operation is part of installation.
The installation event matrix is locally tested; actual installation has not occurred.

## Approval remains a release blocker

Current REST reads of `Production` environment protection returned HTTP 403 (API rate limit). Consequently required reviewers, independent eligible account, prevent self-review, administrator bypass prohibition and branch-only main restriction are all UNKNOWN in this session.
Historical snapshots are not used as current evidence.
The workflow fails closed unless those configuration checks pass, including explicit `can_admins_bypass === false`, an independent human User reviewer and a branch policy of type `branch` named `main` only.
Simulated checks do not prove that real environment protections are configured or that a human reviewer can approve.
No workflow installation or production release is authorized by this report.

## Tests completed

- Existing deployment/rollback/retention/Worker-exclusion simulations: 17 PASS.
- New locked-SHA tests: 7 PASS, including changing current between preflight and lock, malformed markers, competing processes and stale baseline after the winning deployment.
- Locked-SHA + fetch + migration gate directed tests: 17 PASS.
- Immutable approved release guard fixtures: 8 PASS.
- Workflow, approval rejection and installation-trigger tests: 15 PASS.
- Business directed tests: 311 PASS, 0 FAIL, 6 SKIP (317 total).
- Fresh full A/B, same Node v24.19.0, fixture-only database URL and test command/concurrency 4:
  - Base `088d4445...`: 3780 PASS, 16 FAIL, 6 SKIP (3802 total).
  - Candidate: 3787 PASS, 16 FAIL, 6 SKIP (3809 total).
  - Failure sets compared by test file + test name: NEW FAILURES = 0; fixed baseline failures = 0.
- The three missing `tmp/PRODUCTION_INCREMENTAL_CANDIDATE.sql` fixture failures are present on both sides; no temporary SQL artifact was committed or manufactured to hide them.
- TypeScript: PASS.
- Lint: 0 errors, 128 warnings.
- Prisma validate and isolated local generate: PASS; no database query/migration executed by these commands.
- Next.js production build: PASS (exit 0), including 122 static pages; circular-chunk and existing lint warnings remain. The build used a dummy localhost database URL, not production credentials.
- Diff check and sensitive credential-pattern scan: PASS (0 credential matches).

Windows concurrency tests use an actual cross-process exclusive-directory/file-lock simulation and the actual extracted production lock/gate section; Windows symlink/flock primitives are mocked. Linux host flock behavior and Android WeChat/iOS Safari physical QA are not claimed to have been performed.

The user has authorized one local-only commit of this RC, with no push, workflow installation or deployment. Until that commit is separately reviewed and published, the draft policy still points to the old remote RC and must not be used to deploy the new six-argument script. Policy SHA, branch and exact changed-file allowlist must be updated and reviewed against the newly approved commit before installation.

## Safety

Main push: NO. Any push: NO. Merge main: NO. Workflow installed/dispatched: NO.
Production write: 0. Production migration: NO. Deploy: NO. PM2/Worker reload: NO.
