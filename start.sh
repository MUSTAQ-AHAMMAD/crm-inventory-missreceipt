#!/usr/bin/env bash
# ============================================================
#  CRM – Inventory & Misc Receipt  ·  Start Application
#  Works on macOS and Linux.
#  Usage:  bash start.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/backend/.env" ]; then
  echo "[ERROR] backend/.env not found. Run setup.sh first."
  exit 1
fi

echo ""
echo " ============================================="
echo "  CRM Portal – Starting Application"
echo " ============================================="
echo ""

# Keep Prisma client + migrations in sync (covers schema changes after git pull)
echo "[1/3] Syncing Prisma client and migrations..."
cd "$SCRIPT_DIR/backend"
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy

# Start backend in background
echo "[2/3] Starting backend (port 4000)..."
cd "$SCRIPT_DIR/backend"
node src/index.js &
BACKEND_PID=$!
echo "[OK] Backend PID: $BACKEND_PID"

sleep 2

# Start frontend in background
echo "[3/3] Starting frontend (port 3000)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
echo "[OK] Frontend PID: $FRONTEND_PID"

sleep 3

echo ""
echo " ============================================="
echo "  Application is running!"
echo " ============================================="
echo ""
echo "  Frontend : http://localhost:3000"
echo "  Backend  : http://localhost:4000"
echo "  API Docs : http://localhost:4000/api/docs"
echo ""
echo "  Login:  admin@crm.com  /  Admin@123"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

# Open browser if possible
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:3000" &>/dev/null &
elif command -v open &>/dev/null; then
  open "http://localhost:3000" &>/dev/null &
fi

# Wait for Ctrl+C and clean up
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
