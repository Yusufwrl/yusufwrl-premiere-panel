@echo off
chcp 65001 >nul
echo ============================================
echo   Yusufwrl Altyazi Paneli - Kurulum
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-dev.ps1"
echo.
echo Bittiyse Premiere Pro'yu kapatip yeniden ac.
echo Panel: Window ^> Extensions ^> Yusufwrl Panel
echo.
pause
