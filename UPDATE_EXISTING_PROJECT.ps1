$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$target = Join-Path $env:USERPROFILE "Music\ballers-alpha-0.2.2"
if (!(Test-Path (Join-Path $target ".git"))) {
  throw "Git folder not found: $target. Nothing was copied. Open the original project folder first."
}
if ($source -eq $target) { throw "Extract this update into a separate folder first." }
Write-Host "Copying source files to: $target"
& robocopy $source $target /E /XD node_modules .next .git .netlify /XF ".env*" "*.tsbuildinfo"
$copyResult = $LASTEXITCODE
if ($copyResult -ge 8) { throw "Copy failed (robocopy $copyResult). Do not commit yet." }
Write-Host "Source copied. Your .git and .env files were preserved. No commit or deploy was performed."
Write-Host "Next: open PowerShell in $target and run npm ci, npm run build, git status."
exit 0
