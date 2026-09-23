# Windows production deployment

This procedure upgrades an existing `C:\Apps\ULA` installation from JSON storage to the shared PostgreSQL backend without discarding its `.data` files or uploads.

## Production contract

- The Windows service runs with `NODE_ENV=production`.
- The frontend is built with `VITE_SQL_BACKEND=true`.
- `DATABASE_URL` uses the restricted `ula_app` runtime role.
- The migration owner is used only for `npm run db:migrate` and is not left in the service environment.
- `.data\uploads` remains server-side document storage and must be included in backups.
- `npm run production:check` must pass before the service is restarted.

## 1. Back up the current installation

Run in an elevated PowerShell window:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Apps\ULA-backup-$stamp"
Copy-Item -LiteralPath "C:\Apps\ULA" -Destination $backup -Recurse
Write-Host "Backup: $backup"
```

Do not delete the backup until users have verified claims, documents, accounts, reports, and leave records in PostgreSQL.

## 2. Create PostgreSQL roles and database

Install PostgreSQL on the server, then run these statements as the PostgreSQL administrator. Replace both passwords with separate strong values.

```sql
create role ula_migrator login password '<migration-password>';
create role ula_app login password '<runtime-password>';
create database ula owner ula_migrator;
```

The application role must not be superuser, have `BYPASSRLS`, or own the `ula` schema or its protected tables.

## 3. Update code and install dependencies

```powershell
Set-Location C:\Apps\ULA
git fetch origin
git switch codex/director-ai-analysis-regression
git pull --ff-only origin codex/director-ai-analysis-regression
npm ci
```

If `C:\Apps\ULA` is not already a Git repository, clone the branch into a separate staging folder first. Preserve the existing `.env` and `.data` directory; do not clone over the non-empty production folder.

## 4. Apply database migrations

Set the migration URL only in the current PowerShell process. URL-encode special characters in the password.

```powershell
$env:DATABASE_MIGRATION_URL = "postgres://ula_migrator:<migration-password>@127.0.0.1:5432/ula"
$env:DATABASE_RUNTIME_ROLE = "ula_app"
$env:DATABASE_SSL = "false"
npm run db:migrate
Remove-Item Env:DATABASE_MIGRATION_URL
```

## 5. Configure `.env`

Keep the existing provider and email secrets, and set these production values:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
APP_BASE_URL=https://your-real-ula-address
DATABASE_URL=postgres://ula_app:<runtime-password>@127.0.0.1:5432/ula
DATABASE_SSL=false
DATABASE_RUNTIME_ROLE=ula_app
VITE_SQL_BACKEND=true
IMPORT_DEFAULT_OWNER=director@your-company.example
```

`IMPORT_DEFAULT_OWNER` receives ownership of old claims that predate claim ownership. Use an approved administrator's real application email.

## 6. Build and prepare the cutover

```powershell
npm run db:check
npm run build
npm run db:import-local
```

The last command is a dry run. Review all counts and warnings. It writes nothing.

## 7. Import the final JSON snapshot

Stop the service so no JSON data changes during import, take one final `.data` backup, and apply the reviewed import:

```powershell
Stop-Service -Name ULAClaimsHub

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dataBackup = "C:\Apps\ULA-data-$stamp"
Copy-Item -LiteralPath "C:\Apps\ULA\.data" -Destination $dataBackup -Recurse

npm run db:import-local
npm run db:import-local -- --apply
npm run production:check
```

The importer refuses a populated target database by default. Do not add `--allow-existing` during the first production cutover.

## 8. Start and verify

```powershell
Start-Service -Name ULAClaimsHub
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

The required response is:

```text
ok      : True
storage : postgresql
```

Then verify through the public URL:

1. Sign in and sign out.
2. Open an existing claim and download an existing document.
3. Add and remove a test document.
4. Generate a draft report.
5. Submit, approve, and reject test leave requests.
6. Add an employee, reset that account's password, and sign in as the employee.

If health does not report `postgresql`, stop the service and correct the configuration before allowing users back in.
