#Requires -Version 5.1
<#
.SYNOPSIS
  Kept for existing instructions: runs the getting-started wizard (node setup.mjs) without questions.
.DESCRIPTION
  The wizard (setup.mjs at the repo root) installs the sdlc-atl CLI, the skills (~/.agents/skills: GitHub
  Copilot CLI, Copilot in VS Code and Codex read them), the MCP server for each AI tool found, and the Claude Code
  plugin. Run `node setup.mjs` yourself for the interactive version, which also sets up credentials.
.EXAMPLE
  ./scripts/install.ps1
  ./scripts/install.ps1 -Agents copilot,codex -SkillDirs ~/.agents/skills
  ./scripts/install.ps1 -Uninstall
#>
param(
    [string[]]$Agents,
    [string[]]$SkillDirs,
    [string]$BinDir,
    [switch]$NoPath,
    [switch]$NoCopilot,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$nodeArgs = @((Join-Path $repo 'setup.mjs'), '--yes', '--skip-credentials')
if ($Uninstall) { $nodeArgs += '--uninstall' }
if ($NoPath) { $nodeArgs += '--no-path' }
if ($BinDir) { $nodeArgs += @('--bin-dir', $BinDir) }
if ($SkillDirs) { $nodeArgs += @('--skill-dirs', ($SkillDirs -join ',')) }
if (-not $PSBoundParameters.ContainsKey('Agents')) {
    # Default: every supported tool that is installed. (-Agents @() means none.)
    $commands = @{ copilot = 'copilot'; vscode = 'code'; codex = 'codex'; claude = 'claude' }
    $Agents = @($commands.Keys | Where-Object { Get-Command $commands[$_] -ErrorAction SilentlyContinue })
}
if ($NoCopilot) { $Agents = @($Agents | Where-Object { $_ -notin @('copilot', 'vscode') }) }
# One token (--agents=...): Windows PowerShell drops empty-string arguments to native commands.
$nodeArgs += "--agents=$(@($Agents) -join ',')"
& node @nodeArgs
exit $LASTEXITCODE
