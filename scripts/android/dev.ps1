[CmdletBinding()]
param(
    [string] $Serial
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$reverseScript = Join-Path $PSScriptRoot 'reverse.ps1'
$granitePath = Join-Path $projectRoot 'node_modules\.bin\granite.cmd'

if (-not (Test-Path -LiteralPath $granitePath -PathType Leaf)) {
    throw "GRANITE_MISSING Run npm ci; project-local Granite was not found at '$granitePath'."
}

$reverseParameters = @{}
if (-not [string]::IsNullOrWhiteSpace($Serial)) {
    $reverseParameters.Serial = $Serial
}
& $reverseScript @reverseParameters

Write-Output '[PASS] SANDBOX_DEEP_LINK intoss://creatorx'
Write-Output '[PASS] GRANITE_STARTING host=0.0.0.0 port=8081'
& $granitePath 'dev' '--host' '0.0.0.0' '--port' '8081'
exit $LASTEXITCODE
