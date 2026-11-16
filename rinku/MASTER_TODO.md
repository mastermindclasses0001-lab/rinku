# MASTER_TODO.md — TitanGrid Retail ERP Checklist

## Phase 1: Core Infrastructure & Multi-Tenancy
- [x] Project metadata, typography, dark/light Tailwind v4 theme setup
- [x] High-resolution studio product assets (Tiles, Paint, Sanitaryware, Hardware)
- [x] Persistent relational SQL schema (`src/db/database.ts`) with strict `tenant_id` isolation
- [x] Demo seed engine (2 isolated tenants, 3 branches, realistic inventory, invoices, ledgers, staff)
- [x] AES-256-GCM secret vault (`src/lib/crypto.ts`) + JWT + bcrypt + RBAC middleware
- [x] Audit log, login history, rate limiting, idempotency keys, soft-delete support

## Phase 2: Backend API & AI / Export Engines (`server.ts`)
- [x] Auth & Tenant Switcher / Super Admin Tenant Provisioning API
- [x] Dashboard KPI & Branch Analytics API (filtered by branch, date, salesman)
- [x] Inventory, Categories, Unit Conversions, Stock Transfers (Dispatch -> Receive) & POs API
- [x] POS Billing API (GST CGST/SGST/IGST, Inclusive/Exclusive, Split Payments, Credit Notes, Negative Stock Guard)
- [x] Accounts & Financial Ledger API (Cash Book, Branch Cash Closing, Expenses, Profit & Loss, Cash Mismatch Alerts)
- [x] Customer CRM, Credit Limits, 9 AM Overdue Reminder Scheduler, Complaints API
- [x] Staff, Face Enrollment & Liveness Attendance Verification, Geofencing, Salary & Advances API
- [x] Meta WhatsApp Cloud API Adapter + Demo Simulator + Webhook Status API
- [x] AI Brain Knowledge CRUD + Customer Enquiry AI + Owner Business Assistant (`@google/genai`)
- [x] Reports & ExcelJS `.xlsx` Multi-Sheet Export + Database Backup API

## Phase 3: Frontend Design System & Core Shell
- [x] Shared TypeScript ERP Types (`src/types/erp.ts`) & API Client (`src/lib/api.ts`)
- [x] Professional Login Screen + Demo Quick-Fill + Initial Setup Wizard
- [x] Responsive ERP Shell (`Layout.tsx`) — Desktop Sidebar + Mobile Bottom Thumb Bar + Theme Toggle + Branch/Tenant Selector
- [x] Super Admin Multi-Tenant White-Label Console (Create/Suspend Tenants, Plans, Isolation Verification)

## Phase 4 & 5: Core Operational & Financial Modules
- [x] Owner Admin Executive Dashboard
- [x] Branch & Inventory Management
- [x] POS Billing & Sales Terminal (A4/80mm PDF + WhatsApp Share)
- [x] Staff & Mobile Camera Face Attendance + Payroll PDF
- [x] Accounts & Financial Management
- [x] Customer CRM & Automated Collection
- [x] Meta WhatsApp Automation Panel
- [x] AI Brain & Owner Assistant
- [x] Staff Targets & Performance + Reports & Excel Download Center
- [x] Admin Settings & Configuration Center

## Phase 6: Blueprint, Docs & Verification
- [x] `/backend/` Python FastAPI service (`main.py`, `postgres_schema.sql`, `requirements.txt`, `Dockerfile`)
- [x] `docs/DEPLOYMENT.md`, `docs/API_DOCS.md`, `docs/ADMIN_MANUAL.md`, `docs/BACKUP_RESTORE.md`
- [x] Automated verification suite (`scripts/verify_erp.ts`)
- [x] Final TypeScript lint (`tsc --noEmit`), build (`vite build`), and live server check
