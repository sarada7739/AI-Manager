@echo off
rem One-click launcher for AI-Manager (Windows 11 only). See README "Start" section.
rem 1) cd to the repository root
rem 2) in a minimized helper window, wait (max 60 s) until http://127.0.0.1:4317/api/health answers,
rem    then open http://localhost:5173 in the default browser
rem 3) run "pnpm dev" (server + client) in this window. Press Ctrl+C to stop.
rem Keep this file ASCII-only: cmd.exe reads it in the console code page, not UTF-8.

cd /d "%~dp0.."

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "for ($i = 0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:4317/api/health; if ($r.StatusCode -eq 200) { Start-Process http://localhost:5173; break } } catch {}; Start-Sleep -Seconds 1 }"

echo Starting AI-Manager. The browser opens when the server is ready. Press Ctrl+C to stop.
pnpm dev
