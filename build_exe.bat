@echo off
REM ============================================================
REM  Fidelia - Generar Fidelia.exe (sin dependencias externas)
REM  Funciona con tu Python actual, incluido 3.14.
REM ============================================================
setlocal
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist Fidelia.spec del /q Fidelia.spec

python --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encuentra "python" en el PATH.
  pause & exit /b 1
)
echo Instalando PyInstaller...
python -m pip install --upgrade pip
python -m pip install pyinstaller
if errorlevel 1 (
  echo [ERROR] No se pudo instalar PyInstaller.
  echo Alternativa: ejecuta directamente  python fidelia.py
  pause & exit /b 1
)
echo Compilando Fidelia.exe...
python -m PyInstaller --noconfirm --onefile --name Fidelia --add-data "static;static" fidelia.py
if errorlevel 1 (
  echo [ERROR] Fallo la compilacion. Puedes usar:  python fidelia.py
  pause & exit /b 1
)
echo.
echo LISTO. Ejecutable en: dist\Fidelia.exe
echo Los datos (fidelia.db) y las copias (backups\) se crean junto al .exe.
pause
