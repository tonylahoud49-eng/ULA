[CmdletBinding()]
param(
    [string]$ApplicationDirectory = 'C:\Apps\ULA',
    [string]$RollbackDirectory = $PSScriptRoot,
    [string]$ServiceName = 'ULAClaimsHub'
)

$ErrorActionPreference = 'Stop'
$applicationPath = (Resolve-Path -LiteralPath $ApplicationDirectory).ProviderPath
$rollbackPath = (Resolve-Path -LiteralPath $RollbackDirectory).ProviderPath
$record = Get-Content -LiteralPath (Join-Path $rollbackPath 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($record.version -ne 1 -or $record.commit -notmatch '^[a-f0-9]{40,64}$' -or $record.application_directory -ne $applicationPath) {
    throw 'This rollback point does not match the installed application.'
}
foreach ($requiredPath in @((Join-Path $rollbackPath '.env'), (Join-Path $rollbackPath 'dist\index.html'))) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw 'The rollback point is incomplete.' }
}
$changes = @(git -C $applicationPath status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the installed Git repository.' }
if ($changes.Count) { throw 'Review tracked local changes before restoring. They will not be discarded.' }
$savedCommit = git -C $applicationPath rev-parse --verify ($record.commit + '^{commit}')
if ($LASTEXITCODE -ne 0 -or $savedCommit -ne $record.commit) { throw 'The saved commit is unavailable.' }
foreach ($manifest in @('package.json', 'package-lock.json')) {
    $currentBlob = git -C $applicationPath rev-parse ('HEAD:' + $manifest)
    if ($LASTEXITCODE -ne 0 -or $currentBlob -ne $record.dependency_files.$manifest) {
        throw 'Dependency manifests changed. This rollback requires a reviewed dependency restoration before it can proceed.'
    }
}
Get-Service -Name $ServiceName | Out-Null

# Preserve the current environment and build before restoring the saved release.
$backupPath = Join-Path $applicationPath ('.data\deployment-backups\before-rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $applicationPath '.env') -Destination (Join-Path $backupPath '.env')
if (Test-Path -LiteralPath (Join-Path $applicationPath 'dist')) {
    Copy-Item -LiteralPath (Join-Path $applicationPath 'dist') -Destination (Join-Path $backupPath 'dist') -Recurse
}
$currentCommit = git -C $applicationPath rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot record the current release.' }
[System.IO.File]::WriteAllText((Join-Path $backupPath 'commit.txt'), $currentCommit)

Stop-Service -Name $ServiceName
# Keep the release branch intact; no reset, clean or data restoration is performed.
git -C $applicationPath switch --detach $record.commit
if ($LASTEXITCODE -ne 0) { throw 'Source restoration failed. The service remains stopped.' }
Copy-Item -LiteralPath (Join-Path $rollbackPath '.env') -Destination (Join-Path $applicationPath '.env') -Force
Copy-Item -LiteralPath (Join-Path $rollbackPath 'dist') -Destination $applicationPath -Recurse -Force
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3
Get-Service -Name $ServiceName
Invoke-RestMethod http://127.0.0.1:8787/api/health
Write-Host ('Restored commit: ' + $record.commit)
Write-Host 'Claims, uploads, database contents and analysis checkpoints were retained. Refresh both PCs.'
Write-Host ('To return to the updated release branch: git switch ' + $record.branch)
