# BUILD_PROGRESS.md — TitanGrid Multi-Branch Retail ERP

> Permanent build continuation log. On `NEXT`, read this file and `MASTER_TODO.md` to inspect completed modules or extend capabilities.

## Architecture Overview
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (Default Dark Mode `#090B10` + Light Mode toggle, Neon Blue/Green/Yellow/Red/Purple accents, Tabular JetBrains Mono figures, Desktop Admin + Mobile-First Salesman/Attendance UX).
- **Live Server & API (`server.ts`)**: Express + Vite middleware on Port 3000, JWT + bcrypt RBAC authentication, strict `tenant_id` isolation, ACID SQL transactions via `better-sqlite3` (`data/erp.db`), AES-256-GCM encrypted integration credential vault, server-side `@google/genai` AI Brain & Owner Assistant, ExcelJS `.xlsx` export, and jsPDF A4/Thermal invoice & salary slip generation.
- **Production Cloud-Run & PostgreSQL/FastAPI Blueprint (`/backend/`)**: `postgres_schema.sql` (with PostgreSQL Row-Level Security policies), FastAPI `main.py` (face liveness embedding verification & OpenPyXL export), `requirements.txt`, and `Dockerfile`.

## Completed Phases
- **Phase 0**: Metadata, typography, Tailwind v4 dark/light configuration, studio product assets (`tile_marble_slab`, `paint_bucket_studio`, `sanitary_faucet_brass`, `hardware_lockset_steel`).
- **Phase 1**: Relational SQL schema (`src/db/database.ts`), 2 isolated demo tenants, 3 branches for Vanguard Ceramics & Hardware, AES-256-GCM secret vault & JWT/bcrypt (`src/lib/crypto.ts`), audit/login history, rate limiting, idempotency protection.
- **Phase 2**: Complete Express API (`server.ts`), Gemini AI adapter (`src/lib/aiService.ts`), ExcelJS workbook exporter (`src/lib/excelExport.ts`), jsPDF A4/Thermal/Salary Slip generator (`src/lib/pdfExport.ts`).
- **Phase 3**: AuthContext, LoginScreen with Demo Quick-Access + Initial Business Setup Wizard, responsive Layout shell with desktop sidebar & mobile thumb-zone bar.
- **Phase 4 & 5 (All Core & Advanced ERP Modules)**:
  - `DashboardModule.tsx` — Executive KPIs, branch comparison, best-selling SKUs, low-stock alerts, dues, attendance, pending approvals.
  - `InventoryModule.tsx` — SKU/batch/shade/expiry/unit-conversion catalog, stock adjustments/damage/dead stock, inter-branch transfers (dispatch & receive), suppliers & POs, movement ledger, unlimited branches.
  - `PosModule.tsx` — Barcode/search billing, Tile Sq.Ft-to-Box calculator, CGST/SGST vs IGST interstate detection, inclusive/exclusive tax, split payments, quotation/invoice/challan, A4/80mm PDF, WhatsApp share, sales returns/credit notes.
  - `AttendanceStaffModule.tsx` — Live mobile/webcam biometric face capture, multi-frame motion/luminance anti-spoof liveness, GPS geofencing, PIN fallback, IN/OUT duplicate prevention, payroll auto-calculation, salary slip PDF.
  - `AccountsModule.tsx` — Branch-wise Gross & Net P&L, cash/UPI/bank ledgers, expense logging, daily branch cash closing with mismatch detection.
  - `CrmWhatsappModule.tsx` — Customer segmentation, credit limits, 9 AM overdue reminder scheduler, 1-click payment confirmation + thank-you receipt, opt-in/opt-out, complaints, Meta WhatsApp campaign templates & demo simulator.
  - `AiBrainModule.tsx` — Knowledge base CRUD, identity-verified Customer WhatsApp AI simulator, Owner CFO AI Assistant.
  - `TargetsReportsModule.tsx` — Salesman targets, commission leaderboard, live GSTR-1 register, 10+ `.xlsx` Excel downloads.
  - `SettingsSuperAdminModule.tsx` — Encrypted integration vault (Firebase, Meta WhatsApp, AI, DB, Deployment, Business/GST/Theme), JSON tenant backup, immutable audit trail, Super Admin tenant provisioning & isolation switcher.
- **Phase 6**: Python FastAPI + PostgreSQL RLS blueprint (`/backend/`), full documentation (`/docs/`), and verification suite (`scripts/verify_erp.ts`).

## Status
All planned MVP & Enterprise ERP modules are implemented, compiled, linted, and verified.
