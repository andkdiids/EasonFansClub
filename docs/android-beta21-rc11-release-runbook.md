# Android Beta21 RC11 Release Runbook

This runbook covers RC11 (`fans.ecfc.app`, `1.0.0-beta.21`, code31). The local
APK is a fixed prebuilt artifact; this process never builds or signs it. The
Android COS staging workflow does not change the Version API. The separate
configure workflow performs that change only after its own production gates.

## Verified artifact baseline

- Local source: `E:\Eason\build-cache\ECFC-Release-Artifacts\Beta21-Auth-Blockers\ECFC-1.0.0-beta.21-release-RC11-20261102-152136.apk`
- Size: `183802143`
- SHA-256: `9E620936CCBA72ACF81D811AA907800AD142873885D9E63C335E3465D39ADD6C`
- Application ID: `fans.ecfc.app`
- Version: `1.0.0-beta.21` / code31
- Signer SHA-256: `12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B`
- minSdk 24; targetSdk 36

The APK and private signing key stay out of Git. The ingress job checks the
same fixed source path and hash on a self-hosted Windows runner, copies it to a
run-specific temporary folder, writes a provenance manifest, then uploads a
same-run GitHub Actions artifact with one-day retention. The COS job downloads
that exact artifact name from the same run and rechecks the manifest, run ID,
attempt, main ref, workflow ref/SHA, file size and hash before use.

### Self-hosted runner setup required

The runner must have the label `rc11-artifact-ingress`, be isolated from other
jobs, and be registered in a runner group limited to this repository and this
release workflow. Do not allow pull request or fork workflows to target it.
The repository is public, so a generally available self-hosted runner is not
an acceptable ingress boundary. The GitHub runner inventory could not be read
through the connected GitHub integration; runner availability and runner-group
restrictions remain unverified. No runner was installed or configured here.
The runner also needs a verified Android SDK build-tools directory exposed by
`ANDROID_SDK_ROOT` or `ANDROID_HOME`; ingress runs `apksigner verify` and
`aapt dump badging` against the existing APK and stops if either tool is absent.

## Production settings currently block release

The read-only GitHub branch response currently reports `main.protected=false`;
the repository rulesets endpoint returned an empty list. The branch-protection
detail endpoint returned 403 to the connected integration, so required checks
and review counts could not be inspected. All new staging and rollback jobs,
and the Android configure/rollback and existing production deployment jobs,
now fail closed unless the current `main` commit is protected.

Every release/rollback job references the `Production` environment. The
connected integration could not read that environment's reviewer or branch
policy settings. Existing `production-release-approved.yml` source expects the
environment to allow only `main` and documents a single-maintainer dispatch
gate without required reviewers; that source is not evidence of current live
settings. Confirm the actual environment policy before enabling production
workflows. Do not assume that merely naming an environment creates an approval
gate.

## OIDC to Tencent COS staging

`.github/workflows/publish-android-rc11.yml` is manual-dispatch only from
`main`, uses the shared `production-deploy` concurrency group with
`cancel-in-progress: false`, and separates ingress from the COS job. Only the
COS job has `id-token: write`. No long-lived Tencent secret or static
AccessKey is used.

Before a COS run, configure these protected `Production` environment variables
from verified Tencent/GitHub settings:

- `TENCENT_CAM_OIDC_AUDIENCE`
- `TENCENT_EXPECTED_OIDC_SUBJECT`
- `TENCENT_CAM_PROVIDER_ID`
- `TENCENT_CAM_ROLE_ARN`
- `TENCENT_STS_REGION`
- `TENCENT_COS_BUCKET`
- `TENCENT_COS_REGION`

No value is guessed in this worktree. `TENCENT_EXPECTED_OIDC_SUBJECT` is
fail-closed to this exact workflow-pinned custom subject:
`repo:andkdiids/EasonFansClub:environment:Production:workflow_ref:andkdiids/EasonFansClub/.github/workflows/publish-android-rc11.yml@refs/heads/main`.
Before enabling the workflow, configure the repository OIDC subject template to
include `repo`, `context`, and `workflow_ref`, then configure Tencent CAM's
`oidc:sub` condition to match that exact subject. The default GitHub subject
`repo:andkdiids/EasonFansClub:environment:Production` is deliberately rejected
because it does not pin the workflow. This customization can affect other
repository OIDC consumers, so review their trust rules before applying it.
This expected string also assumes the repository is using its current
owner/repository-name subject format. If GitHub's immutable-ID subject format
or another custom template is enabled, inspect the resulting configured
subject and update the pinned value and tests before enabling staging; do not
broaden the accepted subject.
The publisher also checks issuer, audience, `Production`, repository, `main`,
`workflow_dispatch`, and exact `workflow_ref` in memory. It never prints the
OIDC JWT, STS credentials, or request authorization.
Tencent documents exchanging an OIDC token with `AssumeRoleWithWebIdentity`
for temporary credentials ([Tencent CAM OIDC guide](https://intl.cloud.tencent.com/ind/document/product/598/47191));
Tencent documents `oidc:sub` as a role use condition
([Tencent role conditions](https://cloud.tencent.com/document/product/598/19381));
GitHub documents the `id-token: write` job permission, token claims, and custom
subject templates ([GitHub Actions OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)).

The order is enforced in separate workflow steps:

1. Read the live Version API and require the exact code30 baseline.
2. Download code30 through its published `downloadUrl`; verify the fixed
   184246197-byte size and SHA-256.
3. Upload code30 to a unique `run_id`/`run_attempt` object key with
   `x-cos-forbid-overwrite: true`; read back and check COS metadata and then
   download the complete object through `https://media.ecfc.fans/media/` to
   verify the public CDN bytes.
4. Only if that step succeeds, verify the code30 backup again through the
   public CDN, validate the same-run RC11 artifact, upload RC11 to a separate
   unique key, check its metadata and verify the complete CDN download.
5. Save the code30 Version API response as a 90-day Actions artifact. The
   Version API remains unchanged.

Both COS objects use `Content-Type: application/vnd.android.package-archive`,
`Cache-Control: public, max-age=31536000, immutable`, and a custom SHA-256
metadata header. The SDK request includes `x-cos-forbid-overwrite: true`; run
and attempt IDs make keys unique even if COS bucket versioning changes the
header behavior. Existing objects are checked first and cause a hard failure.
No ACL, bucket-policy, delete, or database permissions are used.

The upload role needs only `cos:PutObject` and `cos:HeadObject` scoped to the
Android release prefix. The API download and public CDN readback do not need
CAM `GetObject`. Do not grant `DeleteObject`, ACL management, bucket-policy
management, or permissions outside the required release prefix. COS object
action-to-permission mapping is documented by Tencent
([COS CAM action mapping](https://intl.cloud.tencent.com/ind/document/product/436/30580)).
The role and trust policy have not been created or changed. Validate that the
Tencent policy can enforce the no-overwrite condition; unique keys and the
workflow's preflight remain mandatory regardless.

## Configure Android Version API after COS staging

After the COS workflow succeeds, copy its `RC11_OBJECT_KEY` and
`CODE30_BACKUP_OBJECT_KEY` outputs into
`.github/workflows/configure-android-version.yml` inputs. Use the fixed RC11
SHA-256 and size above. The workflow retains the RC3–RC10 timestamp-key format;
RC11 requires the additional run ID and attempt suffix.

The configure workflow re-downloads the code30 source and independent backup,
validates their hashes/signatures/metadata, validates RC11 signature and APK
metadata from the public CDN, checks the live Version API is still code30,
and compares the full before-state again immediately before changing only the
Android variables under the production deploy lock. It uses the existing
Production environment and saves pre/post API responses. It must not be
dispatched until the branch, environment, runner, and OIDC blockers above are
resolved and the COS staging output is reviewed.

## Android Version API rollback to code30

Dispatch `.github/workflows/rollback-android-version.yml` only if production
still advertises this RC11 and the release meets the rollback criteria. The
workflow validates the preserved code30 APK, checks the code31 API baseline,
compares the current Version API response before restoration, and restores
only Android environment values from the protected configure snapshot. It
shares the production lock, uses the pinned server SSH host key, and verifies
the restored code30 API and public download. Code30 and code31 COS objects are
retained.

## Manual Native Bearer server rollback

`.github/workflows/rollback-native-bearer-server.yml` is manual-dispatch only
from protected `main`, uses `Production`, and shares the `production-deploy`
concurrency group with cancellation disabled. Supply both the expected current
production SHA and the exact old SHA recorded in the current release's
`.rollback-target` file.

The server script acquires `/home/apps/easonfansclub/.deploy.lock`, verifies
the current release marker against the expected current SHA, verifies the
recorded rollback release and old SHA against the requested SHA, then switches
`current`, reloads only the web process, and verifies local health and PM2
release identity. The workflow verifies the public `/api/health/live` release
SHA afterward. Any mismatch stops before switching. The rollback changes
server code only; it does not touch database state or migrations.

## No production actions in this preparation

The workflows and scripts above were added or adjusted locally only. This
worktree has not uploaded to COS, requested a Tencent STS token, changed the
Version API, contacted production SSH, modified CAM/GitHub settings, rebuilt
or re-signed the APK, or committed/pushed code.
