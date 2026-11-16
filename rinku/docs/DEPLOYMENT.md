# Deployment Guide — TitanGrid Retail ERP

## 1. Local & Container Preview (Express + Vite + SQLite WAL)
1. Copy `.env.example` to `.env` and configure `GEMINI_API_KEY`, `ERP_JWT_SECRET`, and `ERP_VAULT_KEY`.
2. Install dependencies: `npm install`
3. Build frontend bundle: `npm run build`
4. Start production server on port 3000: `npm run start` (or `npm run dev` in development).

## 2. Vercel Frontend + Google Cloud Run Backend + PostgreSQL
- **Frontend (Vercel)**: Deploy React Vite SPA (`npm run build`, output `dist/`). Set `VITE_API_BASE_URL` to your Cloud Run URL.
- **Database (PostgreSQL / Cloud SQL)**: Run `backend/postgres_schema.sql` to initialize multi-tenant tables and Row-Level Security (RLS) policies.
- **Python FastAPI Microservice (Cloud Run)**:
  ```bash
  cd backend
  gcloud builds submit --tag gcr.io/YOUR_PROJECT/titangrid-api
  gcloud run deploy titangrid-api --image gcr.io/YOUR_PROJECT/titangrid-api --platform managed --port 8080
  ```
- **Background 9 AM Scheduler (Cloud Scheduler)**: Trigger `POST /api/crm/run-reminders` daily at `09:00` local timezone using a service token.
