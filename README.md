# CRM – Oracle Cloud Inventory & Miscellaneous Receipt Portal

A full-stack CRM web application for managing **bulk inventory uploads** and **miscellaneous receipts** against Oracle Cloud APIs.

Built with **Node.js + Express** (backend), **SQLite + Prisma** (database), and **React + Vite + Tailwind CSS** (frontend).  
No Docker, no PostgreSQL server — just Node.js and a single file database.

---

## 🖥️ Screenshots

| Login | Dashboard |
|---|---|
| ![Login](https://github.com/user-attachments/assets/751fa2a8-3085-4537-a87b-659f950fa52a) | ![Dashboard](https://github.com/user-attachments/assets/7acf5429-b1b8-4faf-bea9-f4127bc46870) |

| Inventory Upload | Misc Receipt |
|---|---|
| ![Inventory](https://github.com/user-attachments/assets/78c13c24-6d64-42fb-9d89-1f710d987569) | ![Misc Receipt](https://github.com/user-attachments/assets/fdc46882-b36d-45f5-9464-773ada955242) |

| Reports & Monitoring | User Management |
|---|---|
| ![Reports](https://github.com/user-attachments/assets/20770382-34da-4367-b363-fa1c75073dda) | ![Users](https://github.com/user-attachments/assets/d71b8787-b48f-48b7-80ec-8c5cad28b68c) |

---

## 🚀 Quick Start — Windows (Recommended)

### Prerequisites

1. **Install Node.js** (LTS version, 18 or newer)
   - Download from: https://nodejs.org
   - During installation, check **"Add to PATH"**
   - After installing, open Command Prompt and verify:
     ```
     node --version
     npm --version
     ```

2. **Clone or download this repository**
   ```
   git clone https://github.com/MUSTAQ-AHAMMAD/crm-inventory-missreceipt.git
   cd crm-inventory-missreceipt
   ```
   Or download the ZIP from GitHub and extract it.

---

### Step 1 — Run Setup (First time only)

Double-click **`setup.bat`** in the root folder, or run it from Command Prompt:

```cmd
setup.bat
```

The script will:
- Install all backend and frontend Node.js packages
- Create `backend/.env` from the example file
- Create the SQLite database file (`backend/crm.db`)
- Run all database migrations
- Seed the default admin user

> **Tip:** After the `.env` file is created, the script pauses so you can edit `backend\.env` with your Oracle credentials before continuing.

---

### Step 2 — Configure Environment Variables

Open `backend\.env` in Notepad (or any text editor) and fill in:

```env
# SQLite database – leave as-is (file will be created automatically)
DATABASE_URL=file:./crm.db

# JWT – change to any long random string (e.g. 32+ characters)
JWT_SECRET=change-me-to-a-long-random-secret
JWT_EXPIRES_IN=24h

# Oracle Cloud credentials
ORACLE_USERNAME=your-oracle-username@example.com
ORACLE_PASSWORD=your-oracle-password

# Oracle REST API endpoint (inventory)
ORACLE_INVENTORY_API_URL=https://ehxk-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions

# Oracle REST API endpoint (standard receipts)
ORACLE_STANDARD_RECEIPT_API_URL=https://ehxk.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/standardReceipts

# Oracle SOAP endpoint (miscellaneous receipts)
ORACLE_SOAP_URL=https://ehxk-test.fa.em2.oraclecloud.com/fscmService/MiscellaneousReceiptService

# Server settings
PORT=4000
FRONTEND_URL=http://localhost:3000
```

The frontend `.env` is optional — it already defaults to `http://localhost:4000/api`.

---

### Step 3 — Start the Application

Double-click **`start.bat`** or run:

```cmd
start.bat
```

This opens **two terminal windows**:
- **CRM Backend** – Express API server on `http://localhost:4000`
- **CRM Frontend** – Vite dev server on `http://localhost:3000`

Your browser will open automatically at `http://localhost:3000`.

> To stop the application, close both terminal windows.

---

### Default Login

| Field | Value |
|---|---|
| URL | http://localhost:3000 |
| Email | `admin@crm.com` |
| Password | `Admin@123` |

---

## 🐧 macOS / Linux Setup

```bash
# 1. Clone the repo
git clone https://github.com/MUSTAQ-AHAMMAD/crm-inventory-missreceipt.git
cd crm-inventory-missreceipt

# 2. Run setup (first time only)
bash setup.sh

# 3. Start the application
bash start.sh
```

---

## 🔧 Manual Setup (Step by Step)

If the batch scripts don't work, you can set up manually:

```bash
# ── Backend ──────────────────────────────────────────────────
cd backend

# Install packages
npm install

# Create .env
copy .env.example .env          # Windows
# cp .env.example .env           # Mac/Linux

# Edit backend/.env with your values (see above)

# Generate Prisma client & create SQLite database
npx prisma generate
npx prisma migrate deploy

# Seed default admin
node prisma/seed.js

# Start backend (keep this terminal open)
node src/index.js

# ── Frontend (new terminal) ───────────────────────────────────
cd frontend
npm install
npm run dev
```

---

## 📁 Project Structure

```
crm-inventory-missreceipt/
├── setup.bat               ← Windows: first-time setup
├── start.bat               ← Windows: start the app
├── setup.sh                ← macOS/Linux: first-time setup
├── start.sh                ← macOS/Linux: start the app
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma   ← SQLite database schema
│   │   ├── seed.js         ← Creates default admin user
│   │   └── migrations/     ← Database migration files
│   ├── src/
│   │   ├── controllers/    ← Request handlers
│   │   ├── middleware/     ← Auth, rate limiting, logging
│   │   ├── routes/         ← API route definitions
│   │   ├── services/       ← Prisma client singleton
│   │   └── index.js        ← Express app entry point
│   ├── .env.example        ← Copy to .env and fill in values
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── pages/          ← One file per page
    │   ├── components/     ← Reusable UI components
    │   ├── context/        ← Auth context (JWT storage)
    │   └── hooks/          ← Axios instance + helpers
    ├── .env.example
    └── package.json
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Login → returns JWT |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/auth/logout` | Logout (activity log) |
| POST | `/api/inventory/bulk-upload` | Upload CSV → Oracle REST API |
| GET | `/api/inventory/uploads` | List inventory uploads |
| GET | `/api/inventory/uploads/:id/failures` | Failure records |
| POST | `/api/inventory/uploads/:id/retry` | Retry failed rows |
| GET | `/api/inventory/template` | Download CSV template |
| POST | `/api/misc-receipt/upload` | Upload CSV → Oracle SOAP |
| POST | `/api/misc-receipt/preview` | Preview generated XML |
| GET | `/api/misc-receipt/uploads` | List misc receipt uploads |
| GET | `/api/misc-receipt/template` | Download CSV template |
| GET | `/api/admin/users` | List users (Admin) |
| POST | `/api/admin/users` | Create user (Admin) |
| PUT | `/api/admin/users/:id` | Update user (Admin) |
| DELETE | `/api/admin/users/:id` | Disable user (Admin) |
| POST | `/api/admin/users/:id/reset-password` | Reset password (Admin) |
| GET | `/api/reports/dashboard` | Dashboard metrics |
| GET | `/api/reports/failures` | Failure report |
| GET | `/api/reports/activity` | Activity log |
| GET | `/api/reports/export` | Export CSV |
| GET | `/api/docs` | Swagger UI documentation |

---

## 🛠️ Troubleshooting

**`node` is not recognized**
- Re-install Node.js from https://nodejs.org and make sure "Add to PATH" is checked.
- Restart Command Prompt / PowerShell after installing.

**Port already in use (EADDRINUSE)**
- Something else is using port 4000 or 3000.
- Change `PORT=4001` in `backend/.env` and update `VITE_API_BASE_URL` in `frontend/.env`.

**Prisma migration error**
- Delete `backend/crm.db` (if it exists) and run `npx prisma migrate deploy` again from the `backend/` folder.

**Cannot connect to Oracle API**
- Verify `ORACLE_USERNAME`, `ORACLE_PASSWORD`, and the API URLs in `backend/.env`.
- Check your internet connection and VPN if required.

**Frontend shows "Network Error"**
- Make sure the backend is running (`node src/index.js` in `backend/`).
- Confirm `VITE_API_BASE_URL=http://localhost:4000/api` in `frontend/.env`.

---

## 🔐 Security Notes

- Oracle credentials are stored in `backend/.env` only — **never committed to git**
- Passwords are hashed with **bcrypt** (10 rounds)
- All API routes are protected with **JWT middleware**
- Admin-only routes have an additional **role-guard middleware**
- Rate limiting: **100 requests per 15 minutes per IP**
- SQLite database file (`crm.db`) is excluded from git via `.gitignore`

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+, Express.js |
| Database | SQLite (via Prisma ORM) |
| Frontend | React 18, Vite, Tailwind CSS |
| Auth | JWT (jsonwebtoken), bcryptjs |
| Charts | Recharts |
| Forms | React Hook Form |
| HTTP Client | Axios |
| CSV Parsing | csv-parse |
| API Docs | Swagger UI (at `/api/docs`) |
