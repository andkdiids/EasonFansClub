# Android App Version and Download APIs

The mobile startup flow may call these public endpoints before login or Beta
Access validation:

```text
GET /api/app/version?platform=android
GET /api/app/download/android
```

The version endpoint does not read the database. The APK download endpoint
accepts no caller-selected key or query parameters. It checks that the
server-configured object exists in Tencent COS and responds with a fixed HTTPS
redirect to `https://media.ecfc.fans/media/android/releases/<filename>.apk`.
The media gateway serves the public-read COS object; the application server
does not buffer the APK body or expose a COS hostname/signature to Mobile.

## Version manifest configuration

| Variable | Format | Required |
| --- | --- | --- |
| `ANDROID_VERSION_NAME` | non-empty string, at most 80 characters | yes |
| `ANDROID_VERSION_CODE` | positive integer, at most `2100000000` | yes |
| `ANDROID_MINIMUM_VERSION_CODE` | positive integer, at most `2100000000`, no greater than the current code | yes |
| `ANDROID_FORCE_UPDATE` | exactly `true` or `false`; defaults to `false` when absent | no |
| `ANDROID_APK_COS_KEY` | server-side key under `android/releases/` ending in `.apk` | yes |
| `ANDROID_APK_SHA256` | 64 hexadecimal SHA-256 characters | yes |
| `ANDROID_RELEASE_NOTES` | JSON array of non-empty strings; max 50 notes and 500 characters per note | no |
| `ANDROID_PUBLISHED_AT` | parseable date, returned as ISO 8601 | no |

`ANDROID_RELEASE_NOTES` must be JSON, for example:

```json
["修复已知问题", "优化启动体验"]
```

The COS object key, bucket configuration, and credentials are never included in
the public manifest. The existing server-side COS settings must be available
through either the primary `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`,
`TENCENT_COS_BUCKET`, `TENCENT_COS_REGION` variables or their existing `COS_*`
compatibility aliases. Session-token aliases remain supported by the existing
COS client.

The object key must be a fixed, validated path such as
`android/releases/ECFC-1.0.0-beta.20.apk`. The configured COS bucket and the
release object must allow anonymous read access because the Mobile client only
accepts the exact `media.ecfc.fans` HTTPS host. The route checks the object with
COS HEAD before redirecting and never redirects to a COS hostname or arbitrary
host. A missing object, invalid configuration, or COS failure returns a generic
`503` and does not expose the key or COS error details. Requests with query
parameters are rejected. Responses use `no-store` and `no-referrer` headers.

Range requests are intentionally not accepted by the ECFC endpoint (`416`,
`Accept-Ranges: none`); an interrupted download restarts from the beginning.

The APK manifest digest must match the bytes uploaded at the configured COS
object key. The mobile client verifies that SHA-256 and the package name,
version code, and pinned release certificate before it opens Android's package
installer. The client does not resume partial downloads; interrupted `.part`
files are removed on startup and the download restarts from the beginning.

Setting these variables in a deployment environment, uploading an APK, or
deploying the route is a separate release operation. This change does not
write production configuration, upload objects, or deploy the server.
