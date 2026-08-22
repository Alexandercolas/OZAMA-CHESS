@echo off
setlocal EnableExtensions

title OZAMA CHESS - Crear llave de subida Android

set "PROJECT_ROOT=%~dp0.."
set "KEY_DIR=%USERPROFILE%\OZAMA-PRIVATE"
set "KEYSTORE=%KEY_DIR%\ozama-upload.jks"
set "KEYTOOL="

if exist "%PROJECT_ROOT%\.tools\jdk21\bin\keytool.exe" (
  set "KEYTOOL=%PROJECT_ROOT%\.tools\jdk21\bin\keytool.exe"
)

for /d %%D in ("%PROJECT_ROOT%\.tools\jdk21\*") do (
  if not defined KEYTOOL if exist "%%~fD\bin\keytool.exe" set "KEYTOOL=%%~fD\bin\keytool.exe"
)

if not defined KEYTOOL if defined JAVA_HOME if exist "%JAVA_HOME%\bin\keytool.exe" (
  set "KEYTOOL=%JAVA_HOME%\bin\keytool.exe"
)

if not defined KEYTOOL (
  echo.
  echo No se encontro keytool. Ejecuta este asistente desde la computadora principal de OZAMA.
  echo.
  pause
  exit /b 1
)

if exist "%KEYSTORE%" (
  echo.
  echo La llave ya existe y no sera reemplazada:
  echo %KEYSTORE%
  echo.
  pause
  exit /b 2
)

if not exist "%KEY_DIR%" mkdir "%KEY_DIR%"

echo.
echo OZAMA CHESS - LLAVE PRIVADA DE SUBIDA
echo ======================================
echo.
echo Archivo: %KEYSTORE%
echo Alias:   ozama-upload
echo.
echo Escribe una contrasena fuerte dos veces. Los caracteres no apareceran.
echo Cuando pida la contrasena de la llave, presiona ENTER para reutilizar la misma.
echo No compartas la contrasena ni subas el archivo a GitHub.
echo.

"%KEYTOOL%" -genkeypair -v -keystore "%KEYSTORE%" -storetype JKS -alias ozama-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=OZAMA CHESS Upload, OU=Mobile, O=OZAMA CHESS, L=Santo Domingo, ST=Distrito Nacional, C=DO"

if errorlevel 1 (
  echo.
  echo No se pudo crear la llave. Ningun secreto fue guardado en el proyecto.
  echo.
  pause
  exit /b 1
)

echo.
echo Llave creada correctamente. Haz dos copias privadas antes de publicar.
echo.
pause
exit /b 0
