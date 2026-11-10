[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$AndroidProjectRoot,
  [Parameter(Mandatory=$true)][string]$ApkSigner,
  [Parameter(Mandatory=$true)][string]$SignerVerifier
)

# The caller must run on an approved protected ref/environment and must never
# enable shell tracing. This helper does not authenticate or authorize a run.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$secretNames = @('ANDROID_RELEASE_KEYSTORE_BASE64','ANDROID_RELEASE_STORE_PASSWORD','ANDROID_RELEASE_KEY_ALIAS','ANDROID_RELEASE_KEY_PASSWORD')
$gradleNames = @('ECFC_ANDROID_KEYSTORE_FILE','ECFC_ANDROID_KEYSTORE_PASSWORD','ECFC_ANDROID_KEY_ALIAS','ECFC_ANDROID_KEY_PASSWORD')
$workDir = $null
$keyFile = $null
$ownsWorkDir = $false
$ownsKeyFile = $false
$keyBytes = $null
$gradleExit = $null
$lockFile = $null
$lockStream = $null
try {
  foreach ($name in $secretNames) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) { throw 'SIGNING_SECRET_MISSING' }
  }
  # Built-in shared service identities are not an isolation boundary for signing.
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $identity -or @('S-1-5-18', 'S-1-5-19', 'S-1-5-20').Contains($identity.Value)) { throw 'SHARED_SERVICE_IDENTITY_FORBIDDEN' }
  $tempValue = [Environment]::GetEnvironmentVariable('RUNNER_TEMP', 'Process')
  if ([string]::IsNullOrWhiteSpace($tempValue)) { throw 'RUNNER_TEMP_MISSING' }
  $temp = Get-Item -LiteralPath $tempValue -Force
  if (-not $temp.PSIsContainer -or ($temp.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'RUNNER_TEMP_UNSAFE' }
  $root = [IO.Path]::GetFullPath($temp.FullName).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $lockFile = Join-Path $root 'ecfc-signing.lock'
  try { $lockStream = [IO.File]::Open($lockFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
  catch { throw 'SIGNING_LOCK_UNAVAILABLE' }
  $orphan = Get-ChildItem -LiteralPath $root -Filter 'ecfc-sign-*' -Force -ErrorAction Stop | Select-Object -First 1
  if ($null -ne $orphan) { throw 'SIGNING_ORPHAN_REQUIRES_MANUAL_REVIEW' }
  $workDir = Join-Path $root ('ecfc-sign-' + [guid]::NewGuid().ToString('N'))
  if ([IO.Directory]::Exists($workDir) -or [IO.File]::Exists($workDir)) { throw 'SIGNING_TEMP_COLLISION' }
  $directory = New-Item -ItemType Directory -Path $workDir -ErrorAction Stop
  $ownsWorkDir = $true
  if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $directory.Parent.FullName -ne $root) { throw 'SIGNING_TEMP_UNSAFE' }

  # The directory is empty while ACLs are changed; key bytes are written only
  # after inherited access is removed and the service identity is granted access.
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($identity)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $workDir -AclObject $acl

  try { $keyBytes = [Convert]::FromBase64String($env:ANDROID_RELEASE_KEYSTORE_BASE64) }
  catch { throw 'SIGNING_KEYSTORE_INVALID' }
  if ($keyBytes.Length -lt 128 -or $keyBytes.Length -gt 1048576) { throw 'SIGNING_KEYSTORE_INVALID' }
  $keyFile = Join-Path $workDir 'release.jks'
  $stream = [IO.File]::Open($keyFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $ownsKeyFile = $true
  try { $stream.Write($keyBytes, 0, $keyBytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose(); [Array]::Clear($keyBytes, 0, $keyBytes.Length); $keyBytes = $null }

  $gradle = Join-Path $AndroidProjectRoot 'gradlew.bat'
  $apk = Join-Path $AndroidProjectRoot 'app\build\outputs\apk\release\app-release.apk'
  foreach ($file in @($gradle, $ApkSigner, $SignerVerifier)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'SIGNING_BUILD_TOOL_MISSING' }
  }
  if (Test-Path -LiteralPath $apk) { throw 'RELEASE_OUTPUT_ALREADY_EXISTS' }
  $env:ECFC_ANDROID_KEYSTORE_FILE = $keyFile
  $env:ECFC_ANDROID_KEYSTORE_PASSWORD = $env:ANDROID_RELEASE_STORE_PASSWORD
  $env:ECFC_ANDROID_KEY_ALIAS = $env:ANDROID_RELEASE_KEY_ALIAS
  $env:ECFC_ANDROID_KEY_PASSWORD = $env:ANDROID_RELEASE_KEY_PASSWORD
  foreach ($name in $secretNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }

  # Suppress all untrusted native output: it may contain credentials.
  $preference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $gradle -p $AndroidProjectRoot --no-daemon --console=plain ':app:assembleRelease' *> $null
    $gradleExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $preference }
  foreach ($name in $gradleNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  if ($gradleExit -ne 0) { throw 'RELEASE_BUILD_FAILED' }
  if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'RELEASE_APK_MISSING' }
  & node $SignerVerifier $ApkSigner $apk '12954323F60A594D2AB69DCB93112E8EB0A63344B11C03DAB5FCCA51A3FCD52B' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'RELEASE_SIGNER_MISMATCH' }
  Write-Output 'RELEASE_BUILD_AND_SIGNER=VERIFIED'
} finally {
  if ($null -ne $keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
  foreach ($name in ($gradleNames + $secretNames)) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  if ($ownsKeyFile -and $keyFile -and [IO.File]::Exists($keyFile)) { Remove-Item -LiteralPath $keyFile -Force -ErrorAction Stop }
  if ($ownsWorkDir -and $workDir -and [IO.Directory]::Exists($workDir)) { Remove-Item -LiteralPath $workDir -Force -ErrorAction Stop }
  if ($lockStream) {
    $lockStream.Dispose()
    if ($lockFile -and [IO.File]::Exists($lockFile)) { Remove-Item -LiteralPath $lockFile -Force -ErrorAction Stop }
  }
}
