# Deploy queue visibility, checkpoint loading and 60-page reviews

This release defaults to two concurrent background claim jobs and reviews of up to 60 pages. Each claim's reviews stay sequential. Extraction checkpoints remain at most 20 pages, and request token/image/byte limits can produce smaller review batches. It preserves existing JSON checkpoints and completed paid reviews. No database migration is required.

Run the following in **PowerShell as Administrator on the Windows server**, from the existing installation. This deploys the matching backend and frontend on the already-used `codex/resumable-analysis-20261005-114248` branch. Existing local `.env`, `.data`, uploads, certificates and IIS configuration remain in place. Take the normal production backup before updating.

Save the installed release **before the update** with this block. Fetch downloads the rollback helpers without updating the installed code. The helper saves the exact installed commit, environment and built frontend under `.data/rollback-before-parallel`; it refuses to overwrite an existing point or capture tracked local changes. It does not stop the service.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Apps\ULA
    git fetch origin codex/resumable-analysis-20261005-114248
    if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
    $toolsPath = Join-Path (Get-Location).Path '.data\deployment-tools'
    New-Item -ItemType Directory -Path $toolsPath -Force | Out-Null
    foreach ($name in @('save-release-rollback.ps1', 'restore-release-rollback.ps1')) {
        $source = git show ("FETCH_HEAD:scripts/" + $name)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot load rollback helper.' }
        [System.IO.File]::WriteAllLines((Join-Path $toolsPath $name), [string[]]$source, (New-Object System.Text.UTF8Encoding($false)))
    }
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.data\deployment-tools\save-release-rollback.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Rollback point was not saved. Do not update yet.' }
}
```

After **Rollback point saved** appears, deploy:

```powershell
& {
$ErrorActionPreference = 'Stop'
Set-Location C:\Apps\ULA

$releaseBranch = 'codex/resumable-analysis-20261005-114248'
$currentBranch = git branch --show-current
if ($currentBranch -ne $releaseBranch) {
    throw "Expected branch $releaseBranch; review the installed release before updating."
}
if (git status --porcelain --untracked-files=no) {
    throw 'Review tracked local changes before updating.'
}

Stop-Service -Name ULAClaimsHub
git pull --ff-only origin $releaseBranch
if ($LASTEXITCODE -ne 0) { throw 'Source update failed. ULA remains stopped.' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-analysis-queue.ps1 -ApplicationDirectory C:\Apps\ULA
if ($LASTEXITCODE -ne 0) { throw 'Queue configuration failed. ULA remains stopped.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. ULA remains stopped.' }
npm.cmd run production:check
if ($LASTEXITCODE -ne 0) { throw 'Production configuration check failed. ULA remains stopped.' }

Start-Service -Name ULAClaimsHub
Start-Sleep -Seconds 3
Get-Service -Name ULAClaimsHub
Invoke-RestMethod http://127.0.0.1:8787/api/health
}
```

Expected result: `Running`, `ok: True`, `storage: postgresql`. If the script stops, correct the displayed error before starting the service. No dependencies were added by this release.

The configuration helper backs up the existing environment under `.data/deployment-backups`, then sets only `AI_JOB_CONCURRENCY=2` and `AI_JOB_BATCH_MAX_PAGES=60`. It does not print the environment or provider secrets. Protect that backup as part of normal server evidence/configuration storage.

After deployment, use **Ctrl + Shift + R** on both PCs to refresh the frontend. Interrupted jobs remain stopped until a user chooses **Retry unfinished stage**. Resume only the claims you want to run. With two jobs running, a third should show **Waiting to start**, its queue position and waiting time. Saved extraction and review counts should be separate, and unknown inventories should show explanatory text rather than 0/0.

For a capacity issue, set `AI_JOB_CONCURRENCY=1` and/or a lower `AI_JOB_BATCH_MAX_PAGES` in `.env`, then restart `ULAClaimsHub`. Increasing the configured batch size above 60 or concurrency above four does not bypass the hard limits. The default five-minute provider attempt cap and bounded retries still apply; this release does not guarantee that a 60-page request will finish within one attempt.

To restore the saved release, run this in Administrator PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Apps\ULA\.data\rollback-before-parallel\restore.ps1
```

Restoration checks for tracked local changes and dependency-manifest compatibility before stopping the service. This release changes no dependencies or database schema. It preserves the currently installed environment/build in a second backup, stops the service, checks out the saved commit in detached-HEAD mode, restores the saved `.env` and matching built frontend, and starts/checks the service. It leaves the updated release branch intact. A later return to that branch requires stopping the service, `git switch codex/resumable-analysis-20261005-114248`, running the queue configuration helper and rebuilding before starting it again.

This rollback restores application code, frontend and configuration. It does not rewind PostgreSQL, uploaded files or saved analysis checkpoints, so work saved after the update is retained. Completed review checkpoints remain available; unfinished jobs still require explicit resume. The rollback folder contains environment credentials and must be protected like the application's `.env` file. It is not a replacement for the normal database/evidence backup.
