$ErrorActionPreference = "Stop"

Write-Host "🗑️  Uninstalling Hermes Chess..." -ForegroundColor Cyan

$destDir = Join-Path $HOME ".hermes-chess"
$skillFile = Join-Path $HOME ".hermes\skills\chess.md"

if (Test-Path $destDir) {
    Write-Host "Removing repository..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force $destDir
}

if (Test-Path $skillFile) {
    Write-Host "Removing skill file..." -ForegroundColor Cyan
    Remove-Item -Force $skillFile
}

Write-Host "⚠️  Please manually remove the 'chess' MCP server entry from your ~/.hermes/config.yaml" -ForegroundColor Yellow

Write-Host "✅ Uninstallation complete." -ForegroundColor Green
