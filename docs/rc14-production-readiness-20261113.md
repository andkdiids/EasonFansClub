# RC14 production readiness — 2026-11-13

Release remains blocked. No production migration or Android Version API update has been performed in this recovery stage.

## Merged repairs

- PR #105: `1e6d1a1846b7bd2be060087afc070b513603e24c`.
- PR #106: `61ba7a76d177cf46c309a166dd921b3e4a065f53` (current candidate).
- PR #105 Unified CI `43278899325`, Android CI `43278899508`, MySQL CI `43278899166`: passed. Actual helper OS-signal and two-process MySQL fencing tests passed.
- PR #106 Unified CI `43280672076`: passed. It changes diagnostic packaging only; Android infrastructure was not triggered for those paths.

## Production evidence

- Strict preflight `43280546337`, 2026-11-12 18:31 UTC: current release and health agree on `f09b2fbcd6cb356d0f44d1e50d18d854612f1566`. No deployment lock observed in endpoint samples. Full process coverage is UNKNOWN. Database inspection rejected configuration parent permissions with `ENV_PARENT_UNSAFE_MODE`. Workflow completion is not a release approval.
- Full migration diagnostic `43281220824`, 2026-11-12 18:34 UTC: 186 candidate migrations; 185 applied; only `20261111120000_add_instagram_lease_generation` pending; no unexpected ledger names; no active failed migration rows.
- 184 applied migrations match the candidate checksum. One applied migration differs: `20260820140000_add_want_listen_session_exclusion`. Its physical schema comparison is YES, but checksum integrity is unresolved.
- Historical failed/rolled-back row checksum: `fbe0a27361631c8d0cf419a379709477ae9e01bdd43f00ae71e94192b810d7fe`, matching Git commit `329771a2cd5ffe5af3c50fe000f34c6823b0cb5d`.
- Successful row checksum: `9499df145c0984d16416b4210eb2061c5bd46273b5bc129fe9da94bff761d5b3`. Removing only the first explanatory comment from the current migration reproduces these exact bytes. Current SQL statements remain identical. The existing production-release file and candidate file both hash to `6b4c152b30679ca0a8f8d1ebe1bf9a1a25f2f16eb2944cfff413819362e48caa`.
- The administrator explicitly approved restoring this one historical file to the exact successful-ledger bytes. The local file now matches `9499df…`; no ledger row or production Schema has been changed. The recovery remains subject to PR and CI checks.

## Artifact evidence

RC14 local APK and fresh full public CDN readback both have 183849255 bytes and SHA256 `450AA28BD98D614C61B18A3BF981F36EEE4C168459EAEF74D1665A54221692AB`. Package `fans.ecfc.app`, versionName `1.0.0-beta.21`, code34, minSdk24, targetSdk36 and arm64-v8a/armeabi-v7a/x86/x86_64 match. APK v2 verification passed with certificate SHA256 `12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B`.

CDN object: `https://media.ecfc.fans/media/android/releases/ECFC-1.0.0-beta.21-release-beta21-rc14-20261111-024245-run42947606564-attempt1.apk`.

Fresh code33 download: 183811739 bytes; SHA256 `5D39F4CD071D2D4B78EA82DFEFEE7D2069A8E9D6425D223D0D3F11A1F50F7BF7`; same official certificate and v2 verification passed. Live Version API still returns code33, minimumVersionCode19 and forceUpdate=false. No authorized ADB device is connected.

## Required sequence

1. Resolve the exact historical checksum exception and inspect unsafe directory metadata without reading secrets.
2. Apply only separately reviewed, precisely scoped configuration repairs through an authorized workflow with original-state checks.
3. Re-run final-main checksum, schema, process and maintenance diagnostics. UNKNOWN remains a blocker.
4. Dispatch protected full deployment only after checks pass. Preserve deployment lock, production SHA CAS, maintenance drain, migration and rollback guards.
5. Verify migration ledger, leaseGeneration, Web/Worker identity, heartbeats and normal hold release.
6. Re-read code33 baseline and perform the official code33-to34 CAS, then public download verification.
7. Complete real-device acceptance when an authorized device is available.

## Historical snapshot and current policy

The status above records an earlier recovery stage and must not be used as current production evidence or a new release gate. Future releases follow [the default development and release process](RELEASE_PROCESS.md); use fresh source and workflow results for the task at hand.
