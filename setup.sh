#!/usr/bin/env bash
# ============================================================
#  CRM – Inventory & Misc Receipt  ·  First-Time Setup Script
#  Works on macOS and Linux.
#  Usage:  bash setup.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo " ============================================="
echo "  CRM Portal – Setup Script (macOS / Linux)"
echo " ============================================="
echo ""

# ── Check Node.js ─────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js is not installed."
  echo "        Install it from https://nodejs.org (LTS recommended)"
  echo "        or via nvm: https://github.com/nvm-sh/nvm"
  exit 1
fi
echo "[OK] Node.js $(node --version) found."

# ── Backend setup ─────────────────────────────────────────────
echo ""
echo "[1/5] Installing backend dependencies..."
cd "$SCRIPT_DIR/backend"
npm install

# ── Create .env ───────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo ""
  echo "[2/5] Creating backend/.env from .env.example..."
  cp .env.example .env
  echo "[OK] backend/.env created."
  echo ""
  echo " IMPORTANT: Open backend/.env and set:"
  echo "   JWT_SECRET            – any long random string"
  echo "   ORACLE_USERNAME       – your Oracle Cloud username"
  echo "   ORACLE_PASSWORD       – your Oracle Cloud password"
  echo "   ORACLE_INVENTORY_API_URL"
  echo "   ORACLE_SOAP_URL"
  echo ""
  read -rp " Press ENTER after reviewing backend/.env to continue..."
else
  echo "[2/5] backend/.env already exists – skipping."
fi

# ── Prisma generate + migrate ─────────────────────────────────
echo ""
echo [3/6] Generating Prisma client...
npx prisma generate

echo ""
echo "[4/6] Running database migrations (creates crm.db)..."
npx prisma migrate deploy
echo "[OK] SQLite database ready."

# ── Seed ──────────────────────────────────────────────────────
echo ""
echo "[5/6] Seeding default admin user..."
node prisma/seed.js

# ── Frontend setup ────────────────────────────────────────────
echo ""
echo "[6/6] Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
npm install
echo "[OK] Frontend dependencies installed."

echo ""
echo " ============================================="
echo "  Setup Complete!"
echo " ============================================="
echo ""
echo "  Default login:  admin@crm.com  /  Admin@123"
echo ""
echo "  Run  bash start.sh  to launch the application."
echo ""
