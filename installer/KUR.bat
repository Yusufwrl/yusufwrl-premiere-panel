@echo off
chcp 65001 >nul
title Yusufwrl Premiere - Kurulum
echo.
echo   Yusufwrl Premiere kuruluyor... (birkac dakika surebilir)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kur.ps1"
echo.
echo   Bittiyse Premiere Pro'yu kapatip yeniden ac.
echo   Panel: Window ^> Extensions ^> Yusufwrl Premiere
echo.
pause
