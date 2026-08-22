[CmdletBinding()]
param(
  [string]$KeystorePath = (Join-Path $env:USERPROFILE 'OZAMA-PRIVATE\ozama-upload.jks'),
  [string]$KeyAlias = 'ozama-upload'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$passwordPointer = [IntPtr]::Zero
$plainPassword = $null
$exitCode = 1

if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
  Write-Error "No se encontro la llave privada: $KeystorePath"
}

try {
  Write-Host ''
  Write-Host 'OZAMA CHESS - AAB FIRMADO' -ForegroundColor Yellow
  Write-Host 'La contrasena no se mostrara ni se guardara en archivos.'
  Write-Host ''

  $securePassword = Read-Host 'Contrasena de la llave de subida' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

  if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    throw 'La contrasena no puede estar vacia.'
  }

  $env:OZAMA_UPLOAD_STORE_FILE = (Resolve-Path -LiteralPath $KeystorePath).Path
  $env:OZAMA_UPLOAD_STORE_PASSWORD = $plainPassword
  $env:OZAMA_UPLOAD_KEY_ALIAS = $KeyAlias
  $env:OZAMA_UPLOAD_KEY_PASSWORD = $plainPassword

  Push-Location $projectRoot
  try {
    & npm.cmd run android:build:signed
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} catch {
  Write-Error $_
} finally {
  Remove-Item Env:OZAMA_UPLOAD_STORE_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:OZAMA_UPLOAD_STORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:OZAMA_UPLOAD_KEY_ALIAS -ErrorAction SilentlyContinue
  Remove-Item Env:OZAMA_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue

  $plainPassword = $null
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

if ($exitCode -ne 0) {
  Write-Error "La compilacion firmada termino con codigo $exitCode."
}

Write-Host ''
Write-Host 'AAB firmado y verificado correctamente.' -ForegroundColor Green
exit 0
