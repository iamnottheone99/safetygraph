# Start local Kev-0.8B inference server for SafetyGraph
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Starting Local Kev-0.8B System One Guardrail Engine" -ForegroundColor Cyan
Write-Host "  Endpoint: http://localhost:8009/v1/systemone" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$KevDir = "C:\Users\ashmi\Documents\Projects\kev"

if (-not (Test-Path $KevDir)) {
    Write-Host "Kev directory not found at $KevDir. Cloning repository..." -ForegroundColor Yellow
    git clone https://github.com/jaredpalmer/kev.git $KevDir
}

Set-Location $KevDir
Write-Host "Syncing uv environment..." -ForegroundColor Green
uv sync --extra serve

Write-Host "Starting Kev-0.8B server on port 8009..." -ForegroundColor Green
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-0.8b --port 8009 --host 0.0.0.0
