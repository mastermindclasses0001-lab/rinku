# API Documentation — TitanGrid Retail ERP

All protected routes require `Authorization: Bearer <JWT>`. Super Admin requests may pass `x-tenant-id` to inspect a specific tenant.

- `POST /api/auth/login` — Authenticate user and issue tenant-scoped 24h JWT.
- `POST /api/auth/setup-wizard` — Self-service onboarding for a new white-label retail business.
- `GET /api/super-admin/tenants` | `POST /api/super-admin/tenants` — Platform tenant provisioning & plan control.
- `GET /api/dashboard` — Branch/date/salesman-filtered KPIs, P&L, low stock, dues, and attendance.
- `GET /api/inventory/products` | `POST /api/inventory/products` — Multi-branch SKU catalog with unit conversion & batch tracking.
- `POST /api/inventory/adjust` — Stock adjustment, damage, and dead-stock recording.
- `POST /api/inventory/transfers` | `POST /api/inventory/transfers/:id/receive` — Atomic two-step branch transfer.
- `POST /api/pos/invoices` | `POST /api/pos/invoices/:id/cancel` — GST CGST/SGST/IGST billing, split payments, credit limits, negative stock guard, and sales return credit notes.
- `GET /api/accounts/overview` | `POST /api/accounts/expenses` | `POST /api/accounts/payments` | `POST /api/accounts/cash-closing` — Cash book, P&L, payment receipts, and cash mismatch detection.
- `POST /api/crm/run-reminders` — Runs automated 9 AM overdue reminder queue for opted-in customers.
- `POST /api/staff/attendance/enroll-face` | `POST /api/staff/attendance/check` — Biometric face embedding enrollment, motion/luminance liveness check, GPS geofencing, and PIN fallback.
- `POST /api/ai/customer-chat` | `POST /api/ai/owner-assistant` — Server-side Gemini AI grounded in live inventory and financial records.
- `GET /api/reports/export/excel?type=...` — Streams styled `.xlsx` workbooks from live database queries.
- `PUT /api/settings/integrations/:provider` | `POST /api/settings/integrations/:provider/test` — AES-256-GCM encrypted integration vault.
