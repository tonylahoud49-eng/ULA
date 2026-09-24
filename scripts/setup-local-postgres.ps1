$ErrorActionPreference = "Stop"

$applicationRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$environmentPath = Join-Path $applicationRoot ".env"
$postgresBin = "C:\Program Files\PostgreSQL\18\bin"
$psqlPath = Join-Path $postgresBin "psql.exe"
$createdbPath = Join-Path $postgresBin "createdb.exe"
$pgDumpPath = Join-Path $postgresBin "pg_dump.exe"
$databaseName = "ula"
$runtimeRole = "ula_app"
$migrationRole = "ula_migrator"
$backupDirectory = Join-Path $applicationRoot "backups\postgres"

if (-not (Test-Path -LiteralPath $psqlPath)) {
  throw "PostgreSQL 18 client tools were not found at $postgresBin."
}
if ((Get-Service -Name "postgresql-x64-18" -ErrorAction Stop).Status -ne "Running") {
  throw "The PostgreSQL 18 service is not running. Start postgresql-x64-18 and run this script again."
}

Write-Host "This prompt is local. The passwords are not printed, committed, or sent to the application chat."
$adminSecret = Read-Host "Enter the local postgres administrator password" -AsSecureString
$adminCredential = [PSCredential]::new("postgres", $adminSecret)
$adminPassword = $adminCredential.GetNetworkCredential().Password
$migrationPassword = -join (1..40 | ForEach-Object { "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[(Get-Random -Minimum 0 -Maximum 62)] })
$runtimePassword = -join (1..40 | ForEach-Object { "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[(Get-Random -Minimum 0 -Maximum 62)] })
$encodedMigrationPassword = [Uri]::EscapeDataString($migrationPassword)
$encodedRuntimePassword = [Uri]::EscapeDataString($runtimePassword)
$migrationUrl = "postgres://$migrationRole`:$encodedMigrationPassword@127.0.0.1:5432/$databaseName"
$runtimeUrl = "postgres://$runtimeRole`:$encodedRuntimePassword@127.0.0.1:5432/$databaseName"

$env:PGPASSWORD = $adminPassword
try {
  & $psqlPath -w -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The postgres password was rejected." }

  $roleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$migrationRole') THEN
    CREATE ROLE $migrationRole LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$runtimeRole') THEN
    CREATE ROLE $runtimeRole LOGIN;
  END IF;
END
`$`$;
ALTER ROLE $migrationRole PASSWORD '$migrationPassword';
ALTER ROLE $runtimeRole PASSWORD '$runtimePassword';
"@
  & $psqlPath -w -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c $roleSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create the local application roles." }

  $databaseExists = (& $psqlPath -w -h 127.0.0.1 -U postgres -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname = '$databaseName';").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the local application database." }
  if ($databaseExists -ne "1") {
    & $createdbPath -w -h 127.0.0.1 -U postgres -O $migrationRole $databaseName
    if ($LASTEXITCODE -ne 0) { throw "Could not create the local $databaseName database." }
  } else {
    & $psqlPath -w -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE $databaseName OWNER TO $migrationRole;" | Out-Null
  }

  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  $backupFile = Join-Path $backupDirectory "ula-before-local-setup-$((Get-Date).ToString('yyyyMMdd-HHmmss')).dump"
  & $pgDumpPath -w -h 127.0.0.1 -U postgres -d $databaseName -Fc -f $backupFile
  if ($LASTEXITCODE -ne 0) { throw "Could not create the database backup." }

  $env:DATABASE_MIGRATION_URL = $migrationUrl
  $env:DATABASE_URL = $runtimeUrl
  $env:DATABASE_RUNTIME_ROLE = $runtimeRole
  $env:DATABASE_SSL = "false"
  Push-Location $applicationRoot
  try {
    npm run db:migrate
    if ($LASTEXITCODE -ne 0) { throw "Database migrations failed." }
    npm run db:import-local -- --apply
    if ($LASTEXITCODE -ne 0) { throw "Local data import failed." }
    npm run db:check
    if ($LASTEXITCODE -ne 0) { throw "Database connectivity check failed." }
  } finally {
    Pop-Location
  }

  if (Test-Path -LiteralPath $environmentPath) {
    $environmentBackup = "$environmentPath.backup-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
    Copy-Item -LiteralPath $environmentPath -Destination $environmentBackup
  }
  $lines = if (Test-Path -LiteralPath $environmentPath) { [IO.File]::ReadAllLines($environmentPath) } else { @() }
  $updates = [ordered]@{
    DATABASE_URL = $runtimeUrl
    DATABASE_MIGRATION_URL = $migrationUrl
    DATABASE_RUNTIME_ROLE = $runtimeRole
    DATABASE_SSL = "false"
    VITE_SQL_BACKEND = "true"
  }
  foreach ($key in $updates.Keys) {
    $pattern = "^\s*$([regex]::Escape($key))\s*="
    $found = $false
    $lines = @($lines | ForEach-Object {
      if ($_ -match $pattern) { $found = $true; "$key=$($updates[$key])" } else { $_ }
    })
    if (-not $found) { $lines += "$key=$($updates[$key])" }
  }
  [IO.File]::WriteAllLines($environmentPath, [string[]]$lines, [Text.UTF8Encoding]::new($false))
  Write-Host "Local PostgreSQL is configured. Backup: $backupFile"
  Write-Host "The app can now use PostgreSQL after restarting its local server."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL,Env:DATABASE_MIGRATION_URL,Env:DATABASE_RUNTIME_ROLE,Env:DATABASE_SSL -ErrorAction SilentlyContinue
  Remove-Variable adminSecret,adminCredential,adminPassword,migrationPassword,runtimePassword,encodedMigrationPassword,encodedRuntimePassword,migrationUrl,runtimeUrl,roleSql,updates,lines -ErrorAction SilentlyContinue
}
