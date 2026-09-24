# ULA Claims Hub: Full Documentation

This is the operational and developer guide for ULA Claims Hub. It covers local development, PostgreSQL, Windows production hosting, deployments, backups, reporting, leave requests, employee access, troubleshooting, and release checks.

The approved report rules are maintained separately in [`REPORT_SPEC.md`](REPORT_SPEC.md). This guide explains how to operate the application. It does not replace or change the report specification.

## 1. System overview

ULA Claims Hub connects claim evidence, AI-assisted extraction, professional review, controlled report drafts, human approval, employee access, and leave administration.

```text
Browser
  -> IIS HTTPS binding and reverse proxy
  -> Node/Express application on 127.0.0.1:8787
  -> PostgreSQL plus server-side .data/uploads storage
  -> Configured AI provider for explicit analysis requests
  -> Configured email provider for leave notifications
```

### Main components

| Component | Location | Purpose |
| --- | --- | --- |
| Frontend | `src/` | React routes, forms, dashboards, and report review UI |
| API server | `server/index.mjs` | Authentication, entities, uploads, AI, leave, settings, and health endpoints |
| PostgreSQL adapter | `server/db/postgresRepository.mjs` | Shared data, ownership, role checks, and RLS-aware access |
| Frontend adapter | `src/api/appClient.js` | Frontend API interface and development compatibility layer |
| Report engine | `src/lib/reportingEngine.js` | Evidence-grounded normalized record and report construction |
| DOCX exporter | `src/lib/masterReportDocx.js` | Populates the approved master DOCX template |
| Evidence gate | `src/lib/reportEvidenceGate.js` | Blocks unsafe drafting and final issue |
| Database migrations | `server/db/migrations/` | Schema, policies, grants, indexes, and settings |
| Windows service | `ULAClaimsHub` | Runs `node server/index.mjs` through NSSM |
| Public web layer | IIS site `ULA-AI` | HTTPS binding and reverse proxy to Node |

### Production storage contract

Production must use PostgreSQL. JSON files or browser storage are not production sources of truth.

- PostgreSQL stores users, sessions, employees, claims, document metadata, reports, leave requests, audit history, and settings.
- `.data/uploads` stores uploaded document bytes unless an external object store is configured later.
- `.env` stores runtime configuration and secrets. It is ignored by Git and must never be committed.
- `ula_migrator` owns the schema and is used only for migrations.
- `ula_app` is the restricted runtime role. It must not be a superuser, have `BYPASSRLS`, or own protected tables.

## 2. Requirements

### Development computer

- Windows PowerShell or an equivalent shell
- Git
- Node.js and npm
- PostgreSQL when testing the SQL backend locally
- An AI provider key only when running real analysis
- Email provider credentials only when testing real email delivery

The application has been developed and deployed with Node 24 and PostgreSQL 18. Coordinate runtime upgrades with the deployment owner.

### Current Windows production layout

- Application folder: `C:\Apps\ULA`
- PostgreSQL service: `postgresql-x64-18`
- Application service: `ULAClaimsHub`
- Node listener: `127.0.0.1:8787`
- IIS site and app pool: `ULA-AI`
- IIS modules: URL Rewrite and Application Request Routing

Keep Node bound to loopback when IIS is the public entry point. Do not expose port 8787 directly to the company network.

## 3. Repository layout and commands

```text
src/                              React frontend
src/api/appClient.js              Frontend API adapter
src/lib/reportEvidenceGate.js     Report evidence safety gate
src/lib/reportTemplates.js        Template selection and readiness
server/index.mjs                  Express API entry point
server/db/migrations/             PostgreSQL migrations
server/tests/                     Regression test suite
scripts/migrate-postgres.mjs      Migration runner
scripts/check-postgres.mjs        Database role and connection check
scripts/check-production.mjs      Production readiness check
scripts/import-local-data-to-postgres.mjs  Legacy data importer
scripts/setup-local-postgres.ps1  Local PostgreSQL setup helper
docs/REPORT_SPEC.md               Approved report source of truth
```

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the exact lockfile dependencies |
| `npm run dev` | Run API and Vite together |
| `npm run dev:server` | Run only the API server |
| `npm run dev:client` | Run only the Vite frontend |
| `npm start` | Run the application server |
| `npm run build` | Build production frontend assets |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run project type checks |
| `npm test` | Run the full Node test suite |
| `npm run db:migrate` | Apply pending PostgreSQL migrations |
| `npm run db:check` | Verify PostgreSQL and runtime role |
| `npm run db:import-local` | Dry-run local data import |
| `npm run db:import-local -- --apply` | Apply a reviewed import |
| `npm run production:check` | Validate production configuration |
| `npm run test:email` | Send a configured test email |

## 4. Environment configuration

Copy `.env.example` to `.env` and enter values locally. Never place real secrets in documentation, source code, screenshots, tickets, or chat.

### Required production settings

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
APP_BASE_URL=https://your-trusted-hostname
VITE_SQL_BACKEND=true

DATABASE_URL=postgres://ula_app:<runtime-password>@127.0.0.1:5432/ula
DATABASE_SSL=false
DATABASE_RUNTIME_ROLE=ula_app
```

For managed PostgreSQL, use its approved hostname and certificate settings. `DATABASE_SSL=true` is normally required for a managed remote database.

### Migration credential

`DATABASE_MIGRATION_URL` is used only while applying migrations. Do not leave the migration-owner credential in the Windows service environment.

```powershell
$env:DATABASE_MIGRATION_URL = "postgres://ula_migrator:<migration-password>@127.0.0.1:5432/ula"
$env:DATABASE_RUNTIME_ROLE = "ula_app"
$env:DATABASE_SSL = "false"
npm run db:migrate
Remove-Item Env:DATABASE_MIGRATION_URL
Remove-Item Env:DATABASE_RUNTIME_ROLE
Remove-Item Env:DATABASE_SSL
```

### AI configuration

AI credentials are server-side only. Typical settings are:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<server-only-secret>
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_ANALYSIS_ENABLED=true
ANTHROPIC_MAX_OUTPUT_TOKENS=64000
AI_MAX_FILES=20
AI_MAX_FILE_BYTES=31457280
AI_MAX_TOTAL_BYTES=52428800
```

Fallback providers may be enabled only under the approved application policy. A fallback must not silently cause an unintended second paid analysis.

### Leave email configuration

The leave workflow supports the configured server email provider. Example placeholders:

```dotenv
LEAVE_EMAIL_PROVIDER=emailjs
LEAVE_ADMIN_EMAIL=admin@example.com
LEAVE_ADMIN_CC_EMAIL=hr@example.com
EMAILJS_SERVICE_ID=<provider-setting>
EMAILJS_TEMPLATE_ID=<provider-setting>
EMAILJS_PUBLIC_KEY=<provider-setting>
EMAILJS_PRIVATE_KEY=<server-only-secret>
```

The Test Email action verifies provider connectivity. It does not replace testing a complete leave submission and decision workflow.

## 5. Local development

### Initial setup

```powershell
git clone <repository-url>
Set-Location .\ULA
npm ci
Copy-Item .env.example .env
```

Edit `.env` with local values. Keep `NODE_ENV` unset or set to `development` for normal local development.

### Start development

```powershell
npm run dev
```

Default endpoints:

- Frontend: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:8787/api/health`

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health"
```

Stop the development process before starting another process or service on port 8787.

### Local PostgreSQL setup

Confirm PostgreSQL is installed and running:

```powershell
Get-Service postgresql-x64-18
```

Run the setup helper from an elevated PowerShell window:

```powershell
Set-Location C:\path\to\ULA
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-local-postgres.ps1
```

The helper performs these steps:

1. Confirms PostgreSQL 18 is running.
2. Prompts locally for the PostgreSQL administrator password.
3. Generates separate passwords for `ula_migrator` and `ula_app`.
4. Creates or updates the local roles and `ula` database.
5. Creates a database dump before setup changes.
6. Applies migrations.
7. Imports the existing `.data` snapshot.
8. Runs `npm run db:check`.
9. Updates the ignored local `.env` after making a timestamped backup.

The generated passwords are not printed. Do not send the administrator password or generated URLs through chat.

After setup:

```powershell
npm run db:check
npm run build
npm start
```

## 6. Migrations and legacy data import

Migrations are applied alphabetically and tracked in `public.ula_schema_migrations`. Re-running the migration command skips files already recorded as applied.

Before importing `.data`, run a dry run:

```powershell
npm run db:import-local
```

Review user, employee, claim, document, report, leave, and audit counts. Also review every ownership warning and error. Only then apply:

```powershell
npm run db:import-local -- --apply
```

Legacy claims without an owner use `IMPORT_DEFAULT_OWNER`. Set it to an approved administrator email or account ID when required:

```powershell
$env:IMPORT_DEFAULT_OWNER = "approved-admin@example.com"
npm run db:import-local -- --apply
Remove-Item Env:IMPORT_DEFAULT_OWNER
```

Confirm resulting claim ownership in PostgreSQL before opening the application to users.

## 7. Windows production deployment

The current optional maintenance release is on branch `codex/maintenance-workflows-ux`. Deploy it only after a backup and review. It does not replace `master`.

### Preflight and backup

Open PowerShell as Administrator on the server:

```powershell
Set-Location C:\Apps\ULA
git status -sb
Get-Service ULAClaimsHub,postgresql-x64-18,W3SVC,WAS
```

Do not continue if `git status --porcelain` shows tracked changes. Preserve `.env`, `.data`, and all existing backups.

```powershell
$backupStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$applicationBackup = "C:\Apps\ULA-backup-$backupStamp"
$dataBackup = "C:\Apps\ULA-data-$backupStamp"
Copy-Item -LiteralPath "C:\Apps\ULA" -Destination $applicationBackup -Recurse
Copy-Item -LiteralPath "C:\Apps\ULA\.data" -Destination $dataBackup -Recurse
Write-Host "Application backup: $applicationBackup"
Write-Host "Data backup: $dataBackup"
```

Keep these backups until users verify claims, documents, reports, accounts, and leave records.

### Pull, build, and restart

```powershell
Set-Location C:\Apps\ULA
$releaseBranch = "codex/maintenance-workflows-ux"

if (git status --porcelain) {
    throw "Server has uncommitted tracked changes. Review them before updating."
}

Stop-Service ULAClaimsHub
Start-Sleep -Seconds 2

git fetch origin $releaseBranch
git show-ref --verify --quiet "refs/heads/$releaseBranch"
if ($LASTEXITCODE -eq 0) {
    git switch $releaseBranch
} else {
    git switch --track -c $releaseBranch "origin/$releaseBranch"
}
git pull --ff-only origin $releaseBranch

npm ci
npm run build
npm run production:check

Start-Service ULAClaimsHub
Start-Sleep -Seconds 5
Get-Service ULAClaimsHub
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health"
```

Required health response:

```text
ok      : True
storage : postgresql
```

If `production:check` fails, do not start the service for users. Correct the reported setting first.

### IIS verification

The loopback health check confirms Node and PostgreSQL. It does not verify IIS, TLS, DNS, or client access.

```powershell
Import-Module WebAdministration
Get-Website -Name "ULA-AI" | Select-Object Name,State,PhysicalPath
Get-WebBinding -Name "ULA-AI" | Select-Object protocol,bindingInformation
```

Test the public route from the server, replacing the placeholders:

```powershell
curl.exe --noproxy "*" --insecure `
  --resolve "your-hostname:443:server-ip" `
  "https://your-hostname/api/health"
```

Normal users should access a DNS name with a certificate trusted by their Windows devices. A browser privacy warning means the certificate identity or trust chain is not correct. Do not treat bypassing the warning as a finished production setup.

## 8. Windows service and IIS operations

### Inspect the NSSM service

```powershell
$applicationService = Get-CimInstance Win32_Service -Filter "Name='ULAClaimsHub'"
$nssmPath = $applicationService.PathName.Trim('"')
& $nssmPath get ULAClaimsHub Application
& $nssmPath get ULAClaimsHub AppParameters
& $nssmPath get ULAClaimsHub AppDirectory
Get-Service ULAClaimsHub
```

Expected values:

- Application: `C:\Program Files\nodejs\node.exe`
- Parameters: `server/index.mjs`
- Directory: `C:\Apps\ULA`
- Startup type: Automatic
- Node host: `127.0.0.1` from `.env`

For ordinary code updates, restart only the application service:

```powershell
Restart-Service ULAClaimsHub
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

Restart IIS only after changing bindings, certificates, rewrite rules, or `public\web.config`:

```powershell
Import-Module WebAdministration
Restart-WebAppPool -Name "ULA-AI"
Restart-Website -Name "ULA-AI"
```

### Inspect listeners

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8787,443 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Do not run a manual `npm start` while NSSM already owns port 8787. Stop the service first for manual diagnostics.

## 9. Application workflows

### Authentication and access

1. An administrator creates an employee account from Users.
2. The account must be approved before it can sign in.
3. The employee uses the ULA application password, not an Outlook password.
4. Production sessions are stored and checked server-side in PostgreSQL.
5. Revoked users are blocked from protected APIs.
6. Sign out invalidates the application session and returns to login.
7. Password-reset links must use a valid, unexpired token.

The employee Outlook email is the login identifier. Creating a ULA account does not create or change a Microsoft account.

### AI claim reporting

The controlled workflow is:

1. Select or create a claim.
2. Upload evidence.
3. Run an explicit AI analysis.
4. Wait for the analysis result to be saved.
5. Review suggestions, missing evidence, warnings, and provenance.
6. Save reviewed claim facts.
7. Generate a draft from the saved analysis and reviewed evidence.
8. Review the draft and exports.
9. Obtain authorized human approval before final issue.

The review-to-report action must not silently make another paid AI request. Re-analysis is explicit and is required when the evidence set changes enough to invalidate the saved evidence snapshot.

Draft generation is blocked when:

- there is no saved completed analysis;
- an uploaded document is absent from the saved snapshot;
- a PDF has failed extraction or page coverage;
- there is no usable reviewed evidence;
- evidence changes after analysis and has not been reviewed again.

Final issue remains subject to the report quality gates. Read [`REPORT_SPEC.md`](REPORT_SPEC.md) before changing analysis, report content, calculations, citations, photographs, templates, previews, or exports.

### Leave requests

1. An employee or administrator opens Request Leave.
2. The request is saved as Pending.
3. Balance is not deducted at submission.
4. An administrator approves or rejects after confirmation.
5. Balance changes only once on approval.
6. Email delivery is recorded separately from the leave state.

If email delivery fails, the request remains saved. Use the request's email status and Retry action. Do not submit the same request again unless the original request was not saved.

### Employee provisioning

Add Employee creates an application account and employee profile together. If provisioning is unavailable in production, check PostgreSQL health, migrations, role grants, and API logs. Do not fall back to browser-local storage.

## 10. Backups

### PostgreSQL custom-format dump

```powershell
$databaseBackupDirectory = "C:\Apps\ULA-backups"
New-Item -ItemType Directory -Path $databaseBackupDirectory -Force | Out-Null
$databaseBackupFile = Join-Path $databaseBackupDirectory "ula-$((Get-Date).ToString('yyyyMMdd-HHmmss')).dump"

& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -U postgres `
  -h 127.0.0.1 `
  -d ula `
  -Fc `
  -f $databaseBackupFile

if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL backup failed."
}

Get-Item $databaseBackupFile |
  Select-Object FullName,Length,LastWriteTime
```

The command prompts for the PostgreSQL administrator password. Do not place the password in the command line.

Also back up:

- `.data\uploads`
- `.env`, stored separately with restricted ACLs
- the deployed Git branch and commit
- IIS bindings and certificate details
- NSSM service configuration

### Restore principles

1. Stop `ULAClaimsHub`.
2. Back up the current failed state before changing it.
3. Restore into a separate database when possible.
4. Verify table and record counts before cutover.
5. Restore the matching uploads directory.
6. Run `db:check` and `production:check`.
7. Start the service only after the database and application versions match.
8. Verify login, claims, documents, reports, leave requests, and audit history.

Do not use `DROP DATABASE`, `dropdb`, `git reset --hard`, or recursive deletion during an incident unless the exact target and a verified backup have been reviewed.

## 11. Troubleshooting

### Health reports `storage: local`

The running process is not using the production SQL configuration. Check the non-secret setting names and restart:

```powershell
Get-Content C:\Apps\ULA\.env |
  Where-Object { $_ -match '^(NODE_ENV|DATABASE_URL|DATABASE_RUNTIME_ROLE|VITE_SQL_BACKEND|HOST)=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }

Restart-Service ULAClaimsHub
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

Do not print the complete `DATABASE_URL`. Production is not ready until health reports `postgresql`.

### Application service does not start

```powershell
Get-CimInstance Win32_Service -Filter "Name='ULAClaimsHub'" |
  Format-List Name,State,StartMode,StartName,PathName

Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

If another Node process owns port 8787, identify it before stopping it:

```powershell
$portListener = Get-NetTCPConnection -State Listen -LocalPort 8787
$ownerProcessId = $portListener.OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId" |
  Format-List ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine
```

### PostgreSQL connection fails

```powershell
Get-Service postgresql-x64-18
npm run db:check
```

Check:

- PostgreSQL is Running.
- `DATABASE_URL` uses the intended host, database, and runtime role.
- the role password matches the configured URL;
- `DATABASE_SSL` matches the database location;
- migrations granted permissions to `ula_app`;
- the NSSM service account can read `.env`.

Use `ula_migrator` for migrations and `ula_app` for runtime. Do not make `ula_app` a superuser to work around an error.

### Employee provisioning fails

1. Confirm health reports PostgreSQL.
2. Run `npm run production:check`.
3. Confirm all migrations were applied.
4. Confirm `ula_app` has runtime grants.
5. Inspect the Node service logs for the exact API error.
6. Retry only after correcting the backend condition.

### Leave request saved but email failed

The leave record and email delivery are separate. Confirm the saved request and status, then use Retry from the email audit control. Check Notification Settings and Test Email. Do not recreate the leave request just to resend email.

### Password reset fails

Confirm:

- the user exists and is approved;
- the reset email provider is configured;
- `APP_BASE_URL` is the address users can reach;
- the reset token is current and not already consumed;
- the Node service can read the email credentials.

### Browser certificate warning

The certificate does not match the hostname or is not trusted by the client. Install a certificate issued for the exact DNS name and deploy its CA chain to company devices. Do not instruct production users to bypass certificate warnings.

### Git pull refuses to continue

Do not force the pull or discard changes. Inspect them:

```powershell
git status --short
git diff
```

Preserve `.env` and `.data`. Resolve tracked-source differences with the deployment owner, then rerun every release check.

### Users cannot reach the application

Check each layer in order:

```powershell
Get-Service ULAClaimsHub,postgresql-x64-18,W3SVC,WAS
Invoke-RestMethod http://127.0.0.1:8787/api/health
Import-Module WebAdministration
Get-Website -Name "ULA-AI"
Get-WebBinding -Name "ULA-AI"
Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound |
  Where-Object DisplayName -Match "HTTPS|World Wide Web"
```

IIS access logs show which client IPs have actually reached the server. They do not prove the user successfully authenticated.

## 12. Security

- Never commit `.env`, database URLs, provider keys, email private keys, passwords, or session tokens.
- Keep private AI and email keys server-side.
- Keep `ula_app` separate from `ula_migrator`.
- Keep Node on loopback when IIS is the public entry point.
- Do not expose port 8787 publicly.
- Restrict PostgreSQL to approved hosts and firewall profiles.
- Restrict `.env`, `.data`, uploads, and backups to approved administrators and the service account.
- Rotate any secret pasted into chat, a ticket, a screenshot, or a repository.
- Revoke application access when an employee should no longer use the app.
- Review active sessions during access incidents.
- Verify backups by restoring them to a separate database.
- Keep HTTPS certificates valid for the exact hostname users enter.

## 13. Development and release process

### Report-related changes

Read [`REPORT_SPEC.md`](REPORT_SPEC.md) in full before changing claim analysis, report structure, report text, calculations, evidence citations, photographs, templates, previews, or DOCX/PDF export. Keep code, tests, templates, prompts, and the specification aligned.

### Branch workflow

```powershell
git switch -c codex/<short-description>
npm run lint
npm run typecheck
npm test
npm run build
git status -sb
git add <reviewed-files>
git commit -m "<focused change>"
git push -u origin codex/<short-description>
```

The current optional UI maintenance branch is `codex/maintenance-workflows-ux`. It includes the saved-analysis-to-report action, persistent form actions, improved mobile navigation, retry states, confirmation dialogs, and local PostgreSQL setup helper.

### Required checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run production:check
```

For UI changes, also test desktop and mobile widths. Verify loading, empty, error, disabled, confirmation, and success states. Long forms must expose their primary action without requiring users to guess that they need to scroll.

### Kev evaluation

Kev may be evaluated separately as a small local decision model for low-risk classification or routing. It is not a replacement for evidence extraction, report writing, calculations, professional review, or human approval. Any integration requires separate privacy, accuracy, latency, and failure-mode tests.

## 14. Production smoke test

After every production update, confirm:

1. `ULAClaimsHub` is Running and Automatic.
2. `postgresql-x64-18` is Running and Automatic.
3. The Node health endpoint reports `storage: postgresql`.
4. IIS site `ULA-AI` is Started.
5. The public HTTPS health endpoint works without a certificate warning.
6. An administrator can sign in and sign out.
7. An existing claim and document can be opened.
8. The reporting workspace restores a saved analysis.
9. A draft can be generated without an unintended second AI analysis.
10. Report sign-off requires explicit confirmation.
11. A leave request is saved Pending and exposes email status.
12. Test Email works with the configured provider.
13. An employee account can be provisioned and reset.
14. The audit log records the expected administrative actions.

Record the deployed branch, commit, PostgreSQL backup filename, application backup path, operator, and verification time in the deployment record.

## 15. Quick reference

### Health

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

### Restart app

```powershell
Restart-Service ULAClaimsHub
```

### Verify database

```powershell
npm run db:check
```

### Verify production configuration

```powershell
npm run production:check
```

### Verify code before release

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```
