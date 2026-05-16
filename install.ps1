$ErrorActionPreference = "Stop"

Write-Host "♟️  Installing Hermes Chess..." -ForegroundColor Cyan

# Check for Node.js
try {
    $nodeVersion = node -v
} catch {
    Write-Host "❌ Error: Node.js is not installed. Please install Node.js v18+ first." -ForegroundColor Red
    exit 1
}

$hermesDir = Join-Path $HOME ".hermes"
if (!(Test-Path $hermesDir)) {
    Write-Host "❌ Error: Hermes Agent does not seem to be installed (missing ~/.hermes directory)." -ForegroundColor Red
    Write-Host "Please install Hermes Agent first: https://github.com/nousresearch/hermes-agent" -ForegroundColor Red
    exit 1
}

$destDir = Join-Path $HOME ".hermes-chess"

if (Test-Path $destDir) {
    Write-Host "⚠️  Removing existing installation..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $destDir
}

if ((Test-Path "package.json") -and (Test-Path "server")) {
    Write-Host "📦 Local source detected. Copying files..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item -Path .\* -Destination $destDir -Recurse -Force
} else {
    Write-Host "📦 Cloning repository..." -ForegroundColor Cyan
    git clone https://github.com/HashemHady/hermes-chess.git $destDir
}

Write-Host "📦 Installing dependencies..." -ForegroundColor Cyan
Set-Location $destDir
npm install

Write-Host "🧠 Installing Hermes skill..." -ForegroundColor Cyan
$skillsDir = Join-Path $hermesDir "skills"
if (!(Test-Path $skillsDir)) {
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
}
Copy-Item (Join-Path $destDir "skills\chess.md") (Join-Path $skillsDir "chess.md") -Force

Write-Host "⚙️  Configuring Hermes MCP Server..." -ForegroundColor Cyan
$configFile = Join-Path $hermesDir "config.yaml"
$serverPath = (Join-Path $destDir "server\index.js").Replace('\', '\\')

if (!(Test-Path $configFile)) {
    Set-Content -Path $configFile -Value "mcp_servers:`n"
}

$configContent = Get-Content $configFile -Raw
if ($configContent -match "chess:") {
    Write-Host "⚠️  'chess' MCP server already exists in config.yaml. Please ensure it points to $serverPath" -ForegroundColor Yellow
} else {
    $mcpEntry = @"

  chess:
    command: "node"
    args: ["$serverPath"]
    supports_parallel_tool_calls: false
"@
    Add-Content -Path $configFile -Value $mcpEntry
}

Write-Host "✅ Installation complete!" -ForegroundColor Green
Write-Host "🚀 Start your Hermes Agent and say: 'let's play chess'" -ForegroundColor Cyan
