@echo off
REM ============================================================
REM  CRM – Inventory & Misc Receipt  ·  First-Time Setup Script
REM  Run this ONCE before starting the application.
REM  Double-click this file or run it from Command Prompt.
REM ============================================================

echo.
echo  =============================================
echo   CRM Portal – Setup Script (Windows)
echo  =============================================
echo.

REM ── Check Node.js ────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo         Download it from https://nodejs.org  (LTS version recommended)
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% found.
echo.

REM ── Backend setup ────────────────────────────────────────────
echo [1/5] Installing backend dependencies...
cd /d "%~dp0backend"
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend npm install failed.
    pause
    exit /b 1
)
echo [OK] Backend dependencies installed.
echo.

REM ── Create .env from example if it doesn't exist ─────────────
if not exist ".env" (
    echo [2/5] Creating backend\.env from .env.example...
    copy ".env.example" ".env" >nul
    echo [OK] backend\.env created.
    echo.
    echo  IMPORTANT: Open backend\.env and fill in:
    echo    - JWT_SECRET  (any long random string, e.g. 32+ characters)
    echo    - ORACLE_USERNAME / ORACLE_PASSWORD
    echo    - ORACLE_INVENTORY_API_URL / ORACLE_SOAP_URL
    echo.
    echo  Press any key to continue after reviewing the .env file...
    pause >nul
) else (
    echo [2/5] backend\.env already exists – skipping.
    echo.
)

REM ── Generate Prisma client & run migrations ───────────────────
echo [3/6] Generating Prisma client...
call npx prisma generate
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Prisma generate failed.
    pause
    exit /b 1
)

echo [4/6] Running database migrations (creates crm.db)...
call npx prisma migrate deploy
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Prisma migrate failed.
    pause
    exit /b 1
)
echo [OK] Database ready.
echo.

REM ── Seed default admin user ───────────────────────────────────
echo [5/6] Seeding default admin user...
call node prisma/seed.js
echo.

REM ── Frontend setup ────────────────────────────────────────────
echo [6/6] Installing frontend dependencies...
cd /d "%~dp0frontend"
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend npm install failed.
    pause
    exit /b 1
)
echo [OK] Frontend dependencies installed.
echo.

REM ── Done ──────────────────────────────────────────────────────
echo  =============================================
echo   Setup Complete!
echo  =============================================
echo.
echo  Default login credentials:
echo    Email   : admin@crm.com
echo    Password: Admin@123
echo.
echo  Next step – run  start.bat  to launch the application.
echo.
pause
