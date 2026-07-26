$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "markerly"
$archive = Join-Path $dist "markerly-$version.zip"

if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$files = @(
  "manifest.json", "background.js", "content.js", "sidepanel.html",
  "sidepanel.css", "sidepanel.js", "zip.js"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $stage $file)
}
Copy-Item -LiteralPath (Join-Path $root "icons") -Destination (Join-Path $stage "icons") -Recurse
Copy-Item -LiteralPath (Join-Path $root "_locales") -Destination (Join-Path $stage "_locales") -Recurse

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $archive -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output "Created $archive"
