# SPDX-License-Identifier: MPL-2.0
$ErrorActionPreference = 'Stop'
$runtime = Get-ChildItem "${env:ProgramFiles(x86)}/Microsoft/EdgeWebView/Application/*/msedgewebview2.exe" |
  Sort-Object { [version]$_.VersionInfo.ProductVersion } -Descending | Select-Object -First 1
if (!$runtime) { throw 'WebView2 runtime missing; install Microsoft Evergreen WebView2 Runtime first.' }
$version = $runtime.VersionInfo.ProductVersion
$destination = Join-Path $env:RUNNER_TEMP 'lumi-edge-driver'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$zip = Join-Path $destination 'driver.zip'
Invoke-WebRequest "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $zip
Expand-Archive $zip -DestinationPath $destination -Force
$signature = Get-AuthenticodeSignature (Join-Path $destination 'msedgedriver.exe')
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
  throw 'Edge Driver must have a valid Microsoft Authenticode signature.'
}
"LUMI_EDGE_DRIVER=$(Join-Path $destination 'msedgedriver.exe')" >> $env:GITHUB_ENV
"WebView2=$version; Edge Driver=$(& (Join-Path $destination 'msedgedriver.exe') --version)"
