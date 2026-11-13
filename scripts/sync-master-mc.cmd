@echo off
rem Run by Windows Task Scheduler every day at 08:00 (task name: "KM Book - Sync Master MC").
rem Pulls Master MC from the Knit Plan file into the book's database. Output goes to sync-master-mc.log.
chcp 65001 >nul
cd /d "%~dp0.."
echo ==== %date% %time% ====>> sync-master-mc.log
node --env-file=.env scripts\sync-master-mc.js >> sync-master-mc.log 2>&1
exit /b %errorlevel%
