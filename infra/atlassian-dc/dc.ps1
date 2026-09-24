#Requires -Version 5.1
<#
.SYNOPSIS
  Manage the local Jira + Confluence Data Center stack.
.EXAMPLE
  ./dc.ps1 init     # create .env with random DB passwords
  ./dc.ps1 up       # start and wait until both apps answer /status
  ./dc.ps1 status
  ./dc.ps1 logs jira
  ./dc.ps1 down     # stop, keep data
  ./dc.ps1 reset    # stop and DELETE all data volumes
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('init', 'up', 'down', 'status', 'logs', 'reset')]
    [string]$Command = 'status',

    [Parameter(Position = 1)]
    [string]$Service,

    [int]$TimeoutMinutes = 15
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Get-EnvValue([string]$Name, [string]$Default) {
    if (Test-Path .env) {
        $line = Get-Content .env | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
        if ($line) { $v = ($line -split '=', 2)[1].Trim(); if ($v) { return $v } }
    }
    return $Default
}

function New-Secret {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    # Alphanumeric only, so it is safe inside SQL literals and JDBC URLs.
    return (([Convert]::ToBase64String($bytes)) -replace '[^A-Za-z0-9]', '')
}

function Get-AppState([string]$Url) {
    try {
        $r = Invoke-RestMethod -Uri "$Url/status" -TimeoutSec 5
        return $r.state
    } catch {
        return 'DOWN'
    }
}

$apps = [ordered]@{
    jira       = "http://localhost:$(Get-EnvValue 'JIRA_PORT' '8080')"
    confluence = "http://localhost:$(Get-EnvValue 'CONFLUENCE_PORT' '8090')"
}

switch ($Command) {
    'init' {
        if (Test-Path .env) { Write-Host '.env already exists; leaving it alone.'; return }
        (Get-Content .env.example) `
            -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(New-Secret)" `
            -replace '^ATL_DB_PASSWORD=.*', "ATL_DB_PASSWORD=$(New-Secret)" |
            Set-Content .env -Encoding ascii
        Write-Host 'Created .env with random database passwords. Set versions/license there if needed.'
    }
    'up' {
        if (-not (Test-Path .env)) { throw 'No .env yet. Run ./dc.ps1 init first.' }
        docker compose up -d
        if ($LASTEXITCODE) { throw 'docker compose up failed' }
        $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
        Write-Host 'Waiting for apps (first start takes several minutes)...'
        do {
            Start-Sleep -Seconds 10
            $states = $apps.Keys | ForEach-Object { "$_=$(Get-AppState $apps[$_])" }
            Write-Host ("  " + ($states -join '  '))
            $pending = $states | Where-Object { $_ -notmatch '=(RUNNING|FIRST_RUN)$' }
        } while ($pending -and (Get-Date) -lt $deadline)
        if ($pending) { throw "Timed out waiting for: $($pending -join ', '). Try ./dc.ps1 logs <service>." }
        Write-Host ''
        Write-Host "Jira:       http://jira.localhost:$(Get-EnvValue 'JIRA_PORT' '8080')"
        Write-Host "Confluence: http://confluence.localhost:$(Get-EnvValue 'CONFLUENCE_PORT' '8090')"
    }
    'status' {
        docker compose ps
        foreach ($k in $apps.Keys) { Write-Host ("{0,-11} {1}" -f $k, (Get-AppState $apps[$k])) }
    }
    'logs' {
        if ($Service) { docker compose logs -f --tail 200 $Service } else { docker compose logs -f --tail 100 }
    }
    'down' { docker compose down }
    'reset' {
        $answer = Read-Host 'This deletes ALL Jira/Confluence/Postgres data volumes. Type "reset" to confirm'
        if ($answer -ne 'reset') { Write-Host 'Aborted.'; return }
        docker compose down -v
    }
}
