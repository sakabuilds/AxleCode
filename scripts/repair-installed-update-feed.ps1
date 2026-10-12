[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,

  [ValidateSet('windows', 'macos-arm64', 'macos-x64')]
  [string]$Platform = 'windows'
)

$resolvedRoot = (Resolve-Path -LiteralPath $InstallRoot -ErrorAction Stop).Path
$resourcesPath = Join-Path $resolvedRoot 'resources'
if (-not (Test-Path -LiteralPath $resourcesPath -PathType Container)) {
  throw "Axle resources directory was not found under '$resolvedRoot'."
}

$feedPath = switch ($Platform) {
  'windows' { 'https://axle.llc/get/updates/windows' }
  'macos-arm64' { 'https://axle.llc/get/updates/macos/arm64' }
  'macos-x64' { 'https://axle.llc/get/updates/macos/x64' }
}

$targetPath = Join-Path $resourcesPath 'app-update.yml'
if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
  Copy-Item -LiteralPath $targetPath -Destination "$targetPath.bak" -Force
}

$content = @"
provider: generic
url: $feedPath
updaterCacheDirName: axle-desktop-updater
"@

Set-Content -LiteralPath $targetPath -Value $content -Encoding utf8 -NoNewline
Write-Output "Wrote Axle updater feed: $targetPath"
Write-Output "Restart Axle, then use Settings > Check for Updates."
