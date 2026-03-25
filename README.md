# CRM – Inventory & Miscellaneous Receipt Portal

A full-stack CRM web application for managing Oracle Cloud inventory uploads and miscellaneous receipts.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js · Express.js |
| **Database** | PostgreSQL 15 · Prisma ORM |
| **Frontend** | React 18 · Vite · Tailwind CSS |
| **Auth** | JWT (Bearer tokens) · bcrypt · RBAC |
| **Charts** | Recharts |
| **Container** | Docker · Docker Compose |

---

## Project Structure

```
/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # Database models
│   │   └── seed.js             # Default admin user seed
│   ├── src/
│   │   ├── controllers/        # Business logic
│   │   ├── middleware/         # JWT, roles, logging, rate-limit
│   │   ├── routes/             # Express routers
│   │   ├── services/           # Prisma client singleton
│   │   ├── swagger.js          # OpenAPI spec config
│   │   └── index.js            # Express app entry point
│   ├── .env.example
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/         # Layout + common reusable components
│   │   ├── context/            # AuthContext (JWT state)
│   │   ├── hooks/              # Axios API client
│   │   ├── pages/              # Page-level components
│   │   └── main.jsx            # React entry point
│   ├── .env.example
│   ├── package.json
│   ├── tailwind.config.js
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Quick Start (Docker)

### 1. Clone and configure

```bash
git clone <repo-url>
cd crm-inventory-missreceipt

# Backend env vars
cp backend/.env.example backend/.env
# Edit backend/.env – fill in ORACLE_USERNAME, ORACLE_PASSWORD, JWT_SECRET

# Frontend env vars (optional – defaults to localhost:4000)
cp frontend/.env.example frontend/.env
```

### 2. Start all services

```bash
docker-compose up --build
```

Services started:
- **Frontend** → http://localhost:3000
- **Backend API** → http://localhost:4000
- **Swagger Docs** → http://localhost:4000/api/docs
- **PostgreSQL** → localhost:5432

### 3. Run database migrations & seed

```bash
# In another terminal (after docker-compose is up)
docker-compose exec backend npx prisma migrate dev --name init
docker-compose exec backend node prisma/seed.js
```

### 4. Log in

Open http://localhost:3000 and log in with:

| Email | Password | Role |
|---|---|---|
| admin@crm.com | Admin@123 | ADMIN |

---

## Local Development (without Docker)

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL and Oracle credentials
npx prisma migrate dev --name init
node prisma/seed.js
npm run dev            # starts on port 4000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev            # starts on port 3000
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://crm_user:crm_password@localhost:5432/crm_db` |
| `JWT_SECRET` | Secret key for JWT signing | *(required)* |
| `JWT_EXPIRES_IN` | JWT expiry duration | `24h` |
| `ORACLE_USERNAME` | Oracle Cloud username | *(required)* |
| `ORACLE_PASSWORD` | Oracle Cloud password | *(required)* |
| `ORACLE_INVENTORY_API_URL` | Oracle REST API endpoint for inventory | see `.env.example` |
| `ORACLE_SOAP_URL` | Oracle SOAP endpoint for misc receipts | see `.env.example` |
| `PORT` | Backend server port | `4000` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:3000` |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:4000/api` |

---

## API Documentation

Full Swagger UI available at: **http://localhost:4000/api/docs**

### Endpoints Summary

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | Login → JWT token | Public |
| POST | `/api/auth/logout` | Logout | JWT |
| GET | `/api/auth/me` | Get current user | JWT |
| POST | `/api/inventory/bulk-upload` | Upload CSV → Oracle REST | JWT |
| GET | `/api/inventory/uploads` | List uploads (paginated) | JWT |
| GET | `/api/inventory/uploads/:id/failures` | Get failure records | JWT |
| POST | `/api/inventory/uploads/:id/retry` | Retry failed records | JWT |
| GET | `/api/inventory/template` | Download CSV template | JWT |
| POST | `/api/misc-receipt/preview` | Preview SOAP XML | JWT |
| POST | `/api/misc-receipt/upload` | Upload CSV → Oracle SOAP | JWT |
| GET | `/api/misc-receipt/uploads` | List uploads | JWT |
| GET | `/api/misc-receipt/uploads/:id` | Get upload details | JWT |
| GET | `/api/misc-receipt/template` | Download CSV template | JWT |
| POST | `/api/admin/users` | Create user | ADMIN |
| GET | `/api/admin/users` | List users | ADMIN |
| PUT | `/api/admin/users/:id` | Update user | ADMIN |
| DELETE | `/api/admin/users/:id` | Disable user | ADMIN |
| POST | `/api/admin/users/:id/reset-password` | Reset password | ADMIN |
| GET | `/api/reports/dashboard` | Dashboard metrics | JWT |
| GET | `/api/reports/failures` | Failure records | JWT |
| GET | `/api/reports/activity` | Activity logs | ADMIN/MANAGER |
| GET | `/api/reports/export` | Export CSV | ADMIN/MANAGER |

---

## Features

### 🔐 Authentication & Authorization
- JWT-based login/logout
- Role-based access control: **ADMIN**, **MANAGER**, **USER**
- Activity logging for every authenticated request
- Rate limiting: 100 requests / 15 minutes / IP

### 📦 Inventory Upload
- Drag-and-drop CSV upload
- Validates required fields (barcode, quantity, transaction type, etc.)
- Skips rows with empty barcode, zero quantity, or invalid data
- Extracts branch from `OrderRef` field if `SubinventoryCode` is empty
- Posts each valid row to Oracle REST API with Basic Auth
- Stores success/failure summary + individual failure records
- Retry failed records with one click
- Downloadable CSV template

### 🧾 Miscellaneous Receipt
- CSV → SOAP XML transformation
- Preview generated XML before sending
- Sends each row as a SOAP envelope to Oracle's `MiscellaneousReceiptService`
- Parses SOAP fault responses
- Downloadable CSV template

### 📊 Reports & Monitoring
- Dashboard with upload trends (line + bar charts)
- Filterable failure records table
- Activity log viewer
- CSV export for failures and activity logs

### 👥 User Management (Admin)
- Create users with bcrypt-hashed passwords
- Edit role and active status
- Soft-delete (disable) users
- One-click password reset

---

## Security Notes

- Oracle API credentials are stored in environment variables – **never hardcoded**
- Passwords are hashed with `bcrypt` (salt rounds: 10)
- JWT tokens are verified on every protected request
- Rate limiting prevents brute-force attacks
- Input validation on the backend

## crm-inventory-missreceipt (original)