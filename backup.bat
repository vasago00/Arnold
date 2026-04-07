@echo off
echo.
echo Backing up ARNOLD to GitHub...
cd /d %~dp0
git add .
git status
echo.
set /p MSG="Commit message (or press Enter for 'Auto backup'): "
if "%MSG%"=="" set MSG=Auto backup %date% %time%
git commit -m "%MSG%"
git push origin main
echo.
echo Done! ARNOLD backed up to GitHub.
pause
