[CmdletBinding()]
param([string]$ApplicationDirectory = 'C:\Apps\ULA')

$ErrorActionPreference = 'Stop'
$applicationPath = (Resolve-Path -LiteralPath $ApplicationDirectory).ProviderPath
$environmentPath = Join-Path $applicationPath '.env'
if (!(Test-Path -LiteralPath (Join-Path $applicationPath 'server\ai\analysisJobs.mjs'))) {
    throw 'Select the installed ULA application directory.'
}
if (!(Test-Path -LiteralPath $environmentPath)) {
    throw 'The installed .env file is missing. Configure production before starting ULA.'
}

# Preserve the complete environment before changing only queue settings.
$backupDirectory = Join-Path $applicationPath '.data\deployment-backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$backupPath = Join-Path $backupDirectory ('environment-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.env')
Copy-Item -LiteralPath $environmentPath -Destination $backupPath
$lines = [System.IO.File]::ReadAllLines($environmentPath)
foreach ($setting in @('AI_JOB_CONCURRENCY=2', 'AI_JOB_BATCH_MAX_PAGES=60')) {
    $name = $setting.Split('=')[0]
    $lines = @($lines | Where-Object { $_ -notmatch ('^\s*(?:export\s+)?' + [regex]::Escape($name) + '\s*=') }) + $setting
}
[System.IO.File]::WriteAllLines($environmentPath, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Configured 2 concurrent claim jobs and reviews of up to 60 pages.'
Write-Host 'Existing request budgets still split dense evidence into smaller reviews.'
Write-Host 'Restart ULAClaimsHub after deploying and building the matching application.'
