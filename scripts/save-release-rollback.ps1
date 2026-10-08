[CmdletBinding()]
param(
    [string]$ApplicationDirectory = 'C:\Apps\ULA',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    [string]$RollbackName = 'rollback-before-parallel'
)

$ErrorActionPreference = 'Stop'
$applicationPath = (Resolve-Path -LiteralPath $ApplicationDirectory).ProviderPath
$environmentPath = Join-Path $applicationPath '.env'
$distPath = Join-Path $applicationPath 'dist'
$restoreScript = Join-Path $PSScriptRoot 'restore-release-rollback.ps1'
$rollbackPath = Join-Path $applicationPath ('.data\' + $RollbackName)
if (Test-Path -LiteralPath $rollbackPath) { throw 'This rollback point already exists; it will not be overwritten. Select another RollbackName.' }
foreach ($requiredPath in @($environmentPath, (Join-Path $distPath 'index.html'), $restoreScript, (Join-Path $applicationPath 'server\index.mjs'))) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw 'The installed application, environment, built frontend or restore helper is missing.' }
}
$changes = @(git -C $applicationPath status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the installed Git repository.' }
if ($changes.Count) { throw 'Review tracked local changes before saving a release rollback point.' }
$commit = git -C $applicationPath rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40,64}$') { throw 'Cannot identify the installed commit.' }
$branch = git -C $applicationPath branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the installed branch.' }
$dependencies = @{}
foreach ($manifest in @('package.json', 'package-lock.json')) {
    $blob = git -C $applicationPath rev-parse ("${commit}:" + $manifest)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot record dependency manifests.' }
    $dependencies[$manifest] = $blob
}

New-Item -ItemType Directory -Path $rollbackPath | Out-Null
Copy-Item -LiteralPath $environmentPath -Destination (Join-Path $rollbackPath '.env')
Copy-Item -LiteralPath $distPath -Destination (Join-Path $rollbackPath 'dist') -Recurse
Copy-Item -LiteralPath $restoreScript -Destination (Join-Path $rollbackPath 'restore.ps1')
$record = @{
    version = 1; application_directory = $applicationPath; commit = $commit; branch = $branch
    created_at = (Get-Date).ToUniversalTime().ToString('o'); dependency_files = $dependencies
}
[System.IO.File]::WriteAllText((Join-Path $rollbackPath 'release.json'), ($record | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('Rollback point saved: ' + $rollbackPath)
Write-Host ('Installed commit: ' + $commit)
Write-Host 'Environment and built frontend saved. Claims, uploads and analysis checkpoints were not changed.'
