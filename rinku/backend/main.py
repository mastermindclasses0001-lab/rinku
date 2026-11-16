"""
TitanGrid Retail ERP — Complete Production FastAPI Backend
Supports Render standalone deployment (uvicorn main:app --host 0.0.0.0 --port $PORT)
with full JWT Auth, RBAC, Tenant Isolation, SQLite WAL persistence, Vault encryption,
AI Assistant, and OpenPyXL Excel exports.
"""
import io
import json
import math
import os
import secrets
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import openpyxl
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from ai_service import run_customer_enquiry_ai, run_owner_assistant_ai
from db import get_db, init_database, row_to_dict, rows_to_dicts
from excel_export import build_excel_report
from security import (
    cosine_similarity,
    decrypt_json,
    encrypt_json,
    hash_password,
    mask_secrets,
    merge_masked_config,
    sign_session_token,
    uid,
    verify_password,
    verify_session_token,
)

init_database()

app = FastAPI(title="TitanGrid Retail ERP API", version="2.0.0")

# Sliding-window API rate limiter
_rate_buckets: Dict[str, List[float]] = defaultdict(list)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.method != "OPTIONS" and request.url.path.startswith("/api/"):
        key = request.client.host if request.client else "local"
        now = time.time()
        window = [t for t in _rate_buckets[key] if now - t < 60.0]
        if len(window) >= 240:
            return JSONResponse(
                status_code=429,
                content={"error": "Rate limit exceeded. Please retry in a few seconds."},
            )
        window.append(now)
        _rate_buckets[key] = window
    return await call_next(request)


# CORS configuration (outermost middleware): allows Vercel frontend & local dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    msg = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": msg, "detail": exc.detail})


class AuthContext:
    def __init__(self, session: Dict[str, Any], active_tenant_id: str, ip: str):
        self.session = session
        self.active_tenant_id = active_tenant_id
        self.ip = ip


def get_auth(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_tenant_id: Optional[str] = Header(default=None),
) -> AuthContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization[7:].strip()
    try:
        payload = verify_session_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session token")

    # Strict tenant isolation: only super_admin may switch active tenant via header
    if payload.get("role") == "super_admin" and x_tenant_id:
        active_tenant_id = x_tenant_id
    else:
        active_tenant_id = str(payload.get("tenantId"))

    ip = request.client.host if request.client else "127.0.0.1"
    return AuthContext(session=payload, active_tenant_id=active_tenant_id, ip=ip)


def require_roles(roles: List[str]):
    def _dep(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.session.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role permissions for this operation")
        return auth

    return _dep


def log_audit(
    conn,
    tenant_id: str,
    branch_id: Optional[str],
    session: Optional[Dict[str, Any]],
    action: str,
    entity_type: str,
    entity_id: Optional[str],
    details: Dict[str, Any],
    ip: str = "127.0.0.1",
):
    conn.execute(
        """
        INSERT INTO audit_logs (id, tenant_id, branch_id, user_id, user_name, action, entity_type, entity_id, details_json, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            uid("aud"),
            tenant_id,
            branch_id,
            session.get("userId") if session else None,
            session.get("fullName") if session else "System",
            action,
            entity_type,
            entity_id,
            json.dumps(details),
            ip,
        ),
    )


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ================= HEALTH & ROOT PROBES (FIXES RENDER HEAD/GET / 404) =================
@app.get("/")
@app.head("/")
def root_probe():
    return {
        "ok": True,
        "service": "TitanGrid Retail ERP FastAPI Backend",
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health")
@app.head("/health")
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "TitanGrid Retail ERP",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ================= AUTH & SETUP WIZARD =================
@app.post("/api/auth/login")
def login(request: Request, body: Dict[str, Any] = Body(...)):
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    ip = request.client.host if request.client else "127.0.0.1"
    ua = request.headers.get("user-agent", "")

    with get_db() as conn:
        user = row_to_dict(
            conn.execute(
                "SELECT * FROM users WHERE lower(email) = lower(?) AND status = 'active'",
                (email,),
            ).fetchone()
        )
        if not user or not verify_password(password, str(user["password_hash"])):
            conn.execute(
                "INSERT INTO login_history (id, tenant_id, user_id, email, role, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
                (
                    uid("log"),
                    user["tenant_id"] if user else None,
                    user["id"] if user else None,
                    email,
                    user["role"] if user else None,
                    ip,
                    ua,
                ),
            )
            conn.commit()
            raise HTTPException(status_code=401, detail="Invalid credentials or inactive account")

        tenant = row_to_dict(conn.execute("SELECT * FROM tenants WHERE id = ?", (user["tenant_id"],)).fetchone())
        if tenant and tenant["status"] != "active" and user["role"] != "super_admin":
            raise HTTPException(status_code=403, detail="Business subscription is suspended. Contact platform administrator.")

        session = {
            "userId": str(user["id"]),
            "tenantId": str(user["tenant_id"]),
            "branchId": str(user["branch_id"]) if user["branch_id"] else None,
            "role": str(user["role"]),
            "email": str(user["email"]),
            "fullName": str(user["full_name"]),
        }
        token = sign_session_token(session)
        conn.execute(
            "INSERT INTO login_history (id, tenant_id, user_id, email, role, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
            (uid("log"), session["tenantId"], session["userId"], session["email"], session["role"], ip, ua),
        )
        return {"token": token, "user": session}


@app.get("/api/auth/me")
def auth_me(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        tenant = row_to_dict(conn.execute("SELECT * FROM tenants WHERE id = ?", (auth.active_tenant_id,)).fetchone())
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        branches = rows_to_dicts(
            conn.execute(
                "SELECT * FROM branches WHERE tenant_id = ? ORDER BY is_headquarters DESC, name ASC",
                (auth.active_tenant_id,),
            ).fetchall()
        )
        user = row_to_dict(
            conn.execute(
                "SELECT id, tenant_id, branch_id, email, full_name, role, phone, face_enrolled, monthly_target, commission_rate FROM users WHERE id = ?",
                (auth.session["userId"],),
            ).fetchone()
        )
        return {
            "session": auth.session,
            "user": user,
            "tenant": {
                **tenant,
                "branding": json.loads(str(tenant.get("branding_json") or "{}")),
                "config": json.loads(str(tenant.get("config_json") or "{}")),
            },
            "branches": branches,
        }


@app.post("/api/auth/setup-wizard")
def setup_wizard(body: Dict[str, Any] = Body(...)):
    business_name = body.get("businessName")
    owner_email = body.get("ownerEmail")
    owner_password = body.get("ownerPassword")
    branch_name = body.get("branchName")
    if not business_name or not owner_email or not owner_password or not branch_name:
        raise HTTPException(status_code=400, detail="Missing required business or owner onboarding fields")

    with get_db() as conn:
        if conn.execute("SELECT id FROM users WHERE lower(email) = lower(?)", (owner_email,)).fetchone():
            raise HTTPException(status_code=409, detail="An account with this email already exists")

        tenant_id = uid("ten")
        branch_id = uid("br")
        user_id = uid("usr")
        slug_base = "".join(c if c.isalnum() else "-" for c in str(business_name).lower()).strip("-")[:32] or "tenant"
        slug = f"{slug_base}-{secrets.token_hex(2)}"
        legal_name = body.get("legalName") or business_name
        gstin = body.get("gstin") or ""
        address = body.get("address") or ""
        phone = body.get("phone") or ""
        email = body.get("email") or owner_email
        owner_name = body.get("ownerName") or "Business Owner"
        branch_city = body.get("branchCity") or "Mumbai"
        branch_state = body.get("branchState") or "Maharashtra"
        state_code = body.get("stateCode") or "27"

        conn.execute(
            """
            INSERT INTO tenants (id, slug, name, legal_name, gstin, address, phone, email, currency, currency_symbol, plan, status, is_demo, branding_json, config_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', '₹', 'pro', 'active', 0, ?, ?)
            """,
            (
                tenant_id,
                slug,
                business_name,
                legal_name,
                gstin,
                address,
                phone,
                email,
                json.dumps({"accent": "#38BDF8", "invoiceFooter": f"Thank you for your business with {business_name}.", "financialYear": "2026-27", "language": "en-IN"}),
                json.dumps({"reminderTime": "09:00", "allowNegativeStock": False, "maxCashierDiscountPct": 10, "stateCode": state_code}),
            ),
        )
        conn.execute(
            """
            INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, gstin, phone, is_headquarters)
            VALUES (?, ?, 'BR-HQ', ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (branch_id, tenant_id, branch_name, address or branch_city or "Main Road", branch_city, branch_state, state_code, gstin, phone),
        )
        conn.execute(
            """
            INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, phone, joining_date)
            VALUES (?, ?, ?, ?, ?, ?, 'owner', '1234', ?, date('now'))
            """,
            (user_id, tenant_id, branch_id, owner_email, hash_password(owner_password), owner_name, phone),
        )
        for slug_cat, name_cat in [("tiles", "Tiles"), ("paint", "Paint"), ("sanitaryware", "Sanitaryware"), ("hardware", "Hardware")]:
            conn.execute("INSERT INTO categories (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)", (uid("cat"), tenant_id, name_cat, slug_cat))
        for prov in ("firebase", "meta_whatsapp", "ai_provider", "database"):
            conn.execute(
                "INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status) VALUES (?, ?, ?, ?, ?)",
                (uid("int"), tenant_id, prov, encrypt_json({}), "configured" if prov == "database" else "not_configured"),
            )

        session = {
            "userId": user_id,
            "tenantId": tenant_id,
            "branchId": branch_id,
            "role": "owner",
            "email": owner_email,
            "fullName": owner_name,
        }
        return {"token": sign_session_token(session), "user": session, "tenantId": tenant_id}


@app.get("/api/auth/login-history")
def login_history(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT * FROM login_history WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50",
                (auth.active_tenant_id,),
            ).fetchall()
        )


# ================= SUPER ADMIN TENANT MANAGEMENT =================
@app.get("/api/super-admin/tenants")
def list_tenants(auth: AuthContext = Depends(require_roles(["super_admin"]))):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT t.*,
                  (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as branch_count,
                  (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as user_count,
                  (SELECT COALESCE(SUM(total_amount), 0) FROM invoices i WHERE i.tenant_id = t.id AND i.is_cancelled = 0) as total_gmv
                FROM tenants t
                ORDER BY t.created_at DESC
                """
            ).fetchall()
        )


@app.post("/api/super-admin/tenants")
def create_tenant(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin"]))):
    name = body.get("name")
    owner_email = body.get("ownerEmail")
    owner_password = body.get("ownerPassword")
    if not name or not owner_email or not owner_password:
        raise HTTPException(status_code=400, detail="Business name, owner email, and password are required")

    with get_db() as conn:
        if conn.execute("SELECT id FROM users WHERE lower(email) = lower(?)", (owner_email,)).fetchone():
            raise HTTPException(status_code=409, detail="Owner email already exists")

        tenant_id = uid("ten")
        branch_id = uid("br")
        user_id = uid("usr")
        slug_base = "".join(c if c.isalnum() else "-" for c in str(name).lower()).strip("-")[:30] or "tenant"
        slug = f"{slug_base}-{secrets.token_hex(2)}"
        state_code = body.get("stateCode") or "27"
        plan = body.get("plan") or "enterprise"

        conn.execute(
            """
            INSERT INTO tenants (id, slug, name, legal_name, gstin, address, phone, email, plan, status, is_demo, branding_json, config_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
            """,
            (
                tenant_id,
                slug,
                name,
                body.get("legalName") or name,
                body.get("gstin") or "",
                body.get("address") or "",
                body.get("phone") or "",
                body.get("email") or owner_email,
                plan,
                json.dumps({"accent": "#38BDF8", "invoiceFooter": f"Official Invoice — {name}", "financialYear": "2026-27", "language": "en-IN"}),
                json.dumps({"reminderTime": "09:00", "allowNegativeStock": False, "maxCashierDiscountPct": 10, "stateCode": state_code}),
            ),
        )
        conn.execute(
            "INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, is_headquarters) VALUES (?, ?, 'BR-HQ', ?, ?, ?, ?, ?, 1)",
            (
                branch_id,
                tenant_id,
                body.get("branchName") or f"{name} HQ",
                body.get("address") or "Main Branch",
                body.get("branchCity") or "Mumbai",
                body.get("branchState") or "Maharashtra",
                state_code,
            ),
        )
        conn.execute(
            "INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, joining_date) VALUES (?, ?, ?, ?, ?, ?, 'owner', '1234', date('now'))",
            (user_id, tenant_id, branch_id, owner_email, hash_password(owner_password), body.get("ownerName") or "Tenant Owner"),
        )
        for slug_cat, name_cat in [("tiles", "Tiles"), ("paint", "Paint"), ("sanitaryware", "Sanitaryware"), ("hardware", "Hardware")]:
            conn.execute("INSERT INTO categories (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)", (uid("cat"), tenant_id, name_cat, slug_cat))
        for prov in ("firebase", "meta_whatsapp", "ai_provider", "database"):
            conn.execute(
                "INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status) VALUES (?, ?, ?, ?, ?)",
                (uid("int"), tenant_id, prov, encrypt_json({}), "configured" if prov == "database" else "not_configured"),
            )
        log_audit(conn, tenant_id, branch_id, auth.session, "CREATE_TENANT", "tenant", tenant_id, {"name": name, "plan": plan}, auth.ip)
        return {"ok": True, "tenantId": tenant_id}


@app.patch("/api/super-admin/tenants/{tenant_id}/status")
def update_tenant_status(tenant_id: str, body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin"]))):
    status = body.get("status")
    plan = body.get("plan")
    with get_db() as conn:
        conn.execute(
            "UPDATE tenants SET status = COALESCE(?, status), plan = COALESCE(?, plan) WHERE id = ?",
            (status, plan, tenant_id),
        )
        log_audit(conn, tenant_id, None, auth.session, "UPDATE_TENANT_STATUS", "tenant", tenant_id, {"status": status, "plan": plan}, auth.ip)
        return {"ok": True}


# ================= OWNER DASHBOARD =================
@app.get("/api/dashboard")
def get_dashboard(
    branchId: Optional[str] = Query(default=None),
    salesmanId: Optional[str] = Query(default=None),
    dateFrom: Optional[str] = Query(default=None),
    dateTo: Optional[str] = Query(default=None),
    auth: AuthContext = Depends(get_auth),
):
    tenant_id = auth.active_tenant_id
    inv_clauses = ["i.tenant_id = ?", "i.is_cancelled = 0", "i.doc_type = 'invoice'"]
    inv_args: List[Any] = [tenant_id]
    if branchId and branchId != "all":
        inv_clauses.append("i.branch_id = ?")
        inv_args.append(branchId)
    if salesmanId and salesmanId != "all":
        inv_clauses.append("i.salesman_id = ?")
        inv_args.append(salesmanId)
    if dateFrom:
        inv_clauses.append("date(i.created_at) >= date(?)")
        inv_args.append(dateFrom)
    if dateTo:
        inv_clauses.append("date(i.created_at) <= date(?)")
        inv_args.append(dateTo)
    where_inv = " AND ".join(inv_clauses)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    with get_db() as conn:
        sales_agg = conn.execute(
            f"""
            SELECT COALESCE(SUM(i.total_amount), 0) as total_sales,
                   COALESCE(SUM(i.taxable_amount), 0) as total_taxable,
                   COALESCE(SUM(i.paid_amount), 0) as total_collected,
                   COALESCE(SUM(i.due_amount), 0) as total_due,
                   COUNT(i.id) as invoice_count
            FROM invoices i WHERE {where_inv}
            """,
            inv_args,
        ).fetchone()
        cogs_agg = conn.execute(
            f"""
            SELECT COALESCE(SUM(ii.qty * ii.purchase_cost), 0) as total_cogs
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
            WHERE {where_inv}
            """,
            inv_args,
        ).fetchone()
        today_sales = conn.execute(
            f"SELECT COALESCE(SUM(total_amount), 0) as amount, COUNT(*) as count FROM invoices i WHERE {where_inv} AND date(i.created_at) = date(?)",
            inv_args + [today],
        ).fetchone()

        exp_clauses = ["tenant_id = ?", "is_deleted = 0"]
        exp_args: List[Any] = [tenant_id]
        if branchId and branchId != "all":
            exp_clauses.append("branch_id = ?")
            exp_args.append(branchId)
        if dateFrom:
            exp_clauses.append("date(expense_date) >= date(?)")
            exp_args.append(dateFrom)
        if dateTo:
            exp_clauses.append("date(expense_date) <= date(?)")
            exp_args.append(dateTo)
        exp_agg = conn.execute(f"SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE {' AND '.join(exp_clauses)}", exp_args).fetchone()

        pur_clauses = ["tenant_id = ?", "status != 'cancelled'"]
        pur_args: List[Any] = [tenant_id]
        if branchId and branchId != "all":
            pur_clauses.append("branch_id = ?")
            pur_args.append(branchId)
        purchase_agg = conn.execute(f"SELECT COALESCE(SUM(total_amount), 0) as total_purchases FROM purchase_orders WHERE {' AND '.join(pur_clauses)}", pur_args).fetchone()

        cash_total = upi_total = card_total = bank_total = 0.0
        for r in conn.execute(f"SELECT payment_breakdown_json FROM invoices i WHERE {where_inv}", inv_args).fetchall():
            try:
                b = json.loads(r["payment_breakdown_json"] or "{}")
                cash_total += float(b.get("cash") or 0)
                upi_total += float(b.get("upi") or 0)
                card_total += float(b.get("card") or 0)
                bank_total += float(b.get("bank") or 0)
            except Exception:
                pass

        branch_breakdown = rows_to_dicts(
            conn.execute(
                """
                SELECT b.id, b.name, b.code, b.city,
                       COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.total_amount ELSE 0 END), 0) as sales,
                       COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.due_amount ELSE 0 END), 0) as dues,
                       COUNT(DISTINCT CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.id END) as orders
                FROM branches b
                LEFT JOIN invoices i ON i.branch_id = b.id
                WHERE b.tenant_id = ?
                GROUP BY b.id
                """,
                (tenant_id,),
            ).fetchall()
        )
        top_products = rows_to_dicts(
            conn.execute(
                f"""
                SELECT ii.product_id, ii.product_name, ii.sku, SUM(ii.qty) as qty_sold, SUM(ii.total) as revenue,
                       SUM(ii.taxable_value - (ii.qty * ii.purchase_cost)) as gross_profit
                FROM invoice_items ii
                JOIN invoices i ON i.id = ii.invoice_id
                WHERE {where_inv}
                GROUP BY ii.product_id
                ORDER BY revenue DESC
                LIMIT 6
                """,
                inv_args,
            ).fetchall()
        )
        bf = "AND bs.branch_id = ?" if branchId and branchId != "all" else ""
        low_args = [tenant_id, branchId] if bf else [tenant_id]
        low_stock = rows_to_dicts(
            conn.execute(
                f"""
                SELECT bs.id, p.id as product_id, p.name, p.sku, p.min_stock, p.unit, b.name as branch_name, bs.qty_available
                FROM branch_stock bs
                JOIN products p ON p.id = bs.product_id
                JOIN branches b ON b.id = bs.branch_id
                WHERE bs.tenant_id = ? AND p.is_deleted = 0 AND bs.qty_available <= p.min_stock {bf}
                ORDER BY bs.qty_available ASC
                LIMIT 10
                """,
                low_args,
            ).fetchall()
        )
        customer_dues = rows_to_dicts(
            conn.execute(
                "SELECT id, name, phone, segment, outstanding_balance, due_date FROM customers WHERE tenant_id = ? AND is_deleted = 0 AND outstanding_balance > 0 ORDER BY outstanding_balance DESC LIMIT 8",
                (tenant_id,),
            ).fetchall()
        )
        sup_pay = conn.execute("SELECT COALESCE(SUM(balance_payable), 0) as total_payable FROM suppliers WHERE tenant_id = ? AND is_deleted = 0", (tenant_id,)).fetchone()
        attendance_today = rows_to_dicts(
            conn.execute(
                """
                SELECT a.*, u.full_name, u.role, b.name as branch_name
                FROM attendance_logs a
                JOIN users u ON u.id = a.user_id
                JOIN branches b ON b.id = a.branch_id
                WHERE a.tenant_id = ? AND a.log_date = date(?)
                """,
                (tenant_id, today),
            ).fetchall()
        )
        pend_trf = conn.execute("SELECT COUNT(*) as c FROM stock_transfers WHERE tenant_id = ? AND status = 'dispatched'", (tenant_id,)).fetchone()["c"]
        open_cmp = conn.execute("SELECT COUNT(*) as c FROM customer_complaints WHERE tenant_id = ? AND status != 'resolved'", (tenant_id,)).fetchone()["c"]

        gross_profit = float(sales_agg["total_taxable"] or 0) - float(cogs_agg["total_cogs"] or 0)
        net_profit = gross_profit - float(exp_agg["total_expenses"] or 0)

        return {
            "kpis": {
                "totalSales": sales_agg["total_sales"],
                "todaySales": today_sales["amount"],
                "todayInvoices": today_sales["count"],
                "totalPurchases": purchase_agg["total_purchases"],
                "grossProfit": gross_profit,
                "netProfit": net_profit,
                "totalExpenses": exp_agg["total_expenses"],
                "customerOutstanding": sum(float(c["outstanding_balance"] or 0) for c in customer_dues),
                "supplierPayable": sup_pay["total_payable"],
                "cashBalance": cash_total,
                "upiBalance": upi_total,
                "cardBankBalance": card_total + bank_total,
                "invoiceCount": sales_agg["invoice_count"],
            },
            "branchBreakdown": branch_breakdown,
            "topProducts": top_products,
            "lowStock": low_stock,
            "customerDues": customer_dues,
            "attendanceToday": attendance_today,
            "pendingApprovals": {
                "pendingTransfers": pend_trf,
                "openComplaints": open_cmp,
                "lowStockCount": len(low_stock),
            },
        }


# ================= BRANCHES =================
@app.get("/api/branches")
def list_branches(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT * FROM branches WHERE tenant_id = ? ORDER BY is_headquarters DESC, name ASC",
                (auth.active_tenant_id,),
            ).fetchall()
        )


@app.post("/api/branches")
def create_branch(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    name = body.get("name")
    city = body.get("city")
    if not name or not city:
        raise HTTPException(status_code=400, detail="Branch name and city are required")
    bid = uid("br")
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, gstin, phone, lat, lng, radius_meters)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                bid,
                auth.active_tenant_id,
                body.get("code") or f"BR-{secrets.token_hex(2).upper()}",
                name,
                body.get("address") or "",
                city,
                body.get("state") or "Maharashtra",
                body.get("stateCode") or "27",
                body.get("gstin") or "",
                body.get("phone") or "",
                float(body.get("lat") or 19.076),
                float(body.get("lng") or 72.8777),
                int(body.get("radiusMeters") or 300),
            ),
        )
        for p in conn.execute("SELECT id FROM products WHERE tenant_id = ? AND is_deleted = 0", (auth.active_tenant_id,)).fetchall():
            conn.execute(
                "INSERT OR IGNORE INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available) VALUES (?, ?, ?, ?, 0)",
                (uid("stk"), auth.active_tenant_id, bid, p["id"]),
            )
        log_audit(conn, auth.active_tenant_id, bid, auth.session, "CREATE_BRANCH", "branch", bid, {"name": name, "city": city}, auth.ip)
        return {"ok": True, "id": bid}


# ================= INVENTORY & STOCK TRANSFERS =================
@app.get("/api/inventory/products")
def list_products(
    branchId: str = Query(default="all"),
    category: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    auth: AuthContext = Depends(get_auth),
):
    tenant_id = auth.active_tenant_id
    with get_db() as conn:
        products = rows_to_dicts(
            conn.execute("SELECT * FROM products WHERE tenant_id = ? AND is_deleted = 0 ORDER BY category_name, name", (tenant_id,)).fetchall()
        )
        stock_rows = rows_to_dicts(
            conn.execute(
                "SELECT bs.*, b.name as branch_name, b.code as branch_code FROM branch_stock bs JOIN branches b ON b.id = bs.branch_id WHERE bs.tenant_id = ?",
                (tenant_id,),
            ).fetchall()
        )

    stock_by_prod: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for s in stock_rows:
        stock_by_prod[str(s["product_id"])].append(s)

    enriched = []
    for p in products:
        stocks = stock_by_prod.get(str(p["id"]), [])
        if branchId != "all":
            match = next((s for s in stocks if s["branch_id"] == branchId), None)
            active = match or {"qty_available": 0, "qty_damaged": 0, "qty_dead": 0}
        else:
            active = {
                "qty_available": sum(float(s.get("qty_available") or 0) for s in stocks),
                "qty_damaged": sum(float(s.get("qty_damaged") or 0) for s in stocks),
                "qty_dead": sum(float(s.get("qty_dead") or 0) for s in stocks),
            }
        enriched.append(
            {
                **p,
                "qty_available": float(active.get("qty_available") or 0),
                "qty_damaged": float(active.get("qty_damaged") or 0),
                "qty_dead": float(active.get("qty_dead") or 0),
                "branch_stocks": stocks,
            }
        )

    if category and category != "All":
        enriched = [p for p in enriched if str(p.get("category_name", "")).lower() == category.lower()]
    if search:
        q = search.lower()
        enriched = [
            p
            for p in enriched
            if q in str(p.get("name", "")).lower()
            or q in str(p.get("sku", "")).lower()
            or q in str(p.get("barcode") or "").lower()
            or q in str(p.get("brand") or "").lower()
            or q in str(p.get("shade") or "").lower()
        ]
    return enriched


@app.post("/api/inventory/products")
def create_product(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    name = body.get("name")
    sku = body.get("sku")
    cat = body.get("categoryName")
    if not name or not sku or not cat:
        raise HTTPException(status_code=400, detail="Product name, SKU, and category are required")

    pid = uid("prd")
    img_map = {
        "Tiles": "/src/assets/images/tile_marble_slab_1794811964688.jpg",
        "Paint": "/src/assets/images/paint_bucket_studio_1794811965564.jpg",
        "Sanitaryware": "/src/assets/images/sanitary_faucet_brass_1794811965032.jpg",
    }
    default_img = img_map.get(cat, "/src/assets/images/hardware_lockset_steel_1794811966531.jpg")

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO products (id, tenant_id, category_name, subcategory, sku, barcode, qr_code, name, brand, hsn_code, gst_rate, tax_inclusive, unit, base_unit, conversion_factor, box_coverage_sqft, shade, batch_no, lot_no, color_code, mfg_date, exp_date, purchase_price, mrp, selling_price, min_stock, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                auth.active_tenant_id,
                cat,
                body.get("subcategory") or "",
                sku,
                body.get("barcode") or sku,
                f"QR-{sku}",
                name,
                body.get("brand") or "",
                body.get("hsnCode") or "6907",
                float(body.get("gstRate") if body.get("gstRate") is not None else 18),
                1 if body.get("taxInclusive") else 0,
                body.get("unit") or "Piece",
                body.get("baseUnit") or body.get("unit") or "Piece",
                float(body.get("conversionFactor") or 1),
                float(body["boxCoverageSqft"]) if body.get("boxCoverageSqft") else None,
                body.get("shade") or None,
                body.get("batchNo") or None,
                body.get("lotNo") or None,
                body.get("colorCode") or None,
                body.get("mfgDate") or None,
                body.get("expDate") or None,
                float(body.get("purchasePrice") or 0),
                float(body.get("mrp") or body.get("sellingPrice") or 0),
                float(body.get("sellingPrice") or 0),
                float(body.get("minStock") or 10),
                body.get("imageUrl") or default_img,
            ),
        )
        for b in conn.execute("SELECT id FROM branches WHERE tenant_id = ?", (auth.active_tenant_id,)).fetchall():
            init_qty = float(body.get("openingStock") or 0) if body.get("openingBranchId") == b["id"] else 0.0
            conn.execute(
                "INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available) VALUES (?, ?, ?, ?, ?)",
                (uid("stk"), auth.active_tenant_id, b["id"], pid, init_qty),
            )
            if init_qty > 0:
                conn.execute(
                    "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'opening', ?, 'product_create', ?, 'Opening stock on SKU creation', ?)",
                    (uid("mov"), auth.active_tenant_id, b["id"], pid, init_qty, float(body.get("purchasePrice") or 0), auth.session["userId"]),
                )
        log_audit(conn, auth.active_tenant_id, None, auth.session, "CREATE_PRODUCT", "product", pid, {"sku": sku, "name": name}, auth.ip)
        return {"ok": True, "id": pid}


@app.post("/api/inventory/adjust")
def adjust_stock(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    branch_id = body.get("branchId")
    product_id = body.get("productId")
    movement_type = body.get("movementType")
    qty_delta = float(body.get("qtyDelta") or 0)
    notes = body.get("notes") or ""
    if not branch_id or not product_id or not qty_delta:
        raise HTTPException(status_code=400, detail="branchId, productId, and qtyDelta required")

    with get_db() as conn:
        prod = conn.execute("SELECT purchase_price FROM products WHERE id = ? AND tenant_id = ?", (product_id, auth.active_tenant_id)).fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail="Product not found for tenant")
        stock = conn.execute("SELECT * FROM branch_stock WHERE branch_id = ? AND product_id = ? AND tenant_id = ?", (branch_id, product_id, auth.active_tenant_id)).fetchone()
        if not stock:
            raise HTTPException(status_code=404, detail="Branch stock record missing")

        avail = float(stock["qty_available"])
        if movement_type == "damage":
            ded = abs(qty_delta)
            if avail < ded:
                raise HTTPException(status_code=400, detail="Cannot mark more damaged than available stock")
            conn.execute("UPDATE branch_stock SET qty_available = qty_available - ?, qty_damaged = qty_damaged + ?, last_updated = datetime('now') WHERE id = ?", (ded, ded, stock["id"]))
        elif movement_type == "dead_stock":
            ded = abs(qty_delta)
            if avail < ded:
                raise HTTPException(status_code=400, detail="Cannot mark more dead stock than available stock")
            conn.execute("UPDATE branch_stock SET qty_available = qty_available - ?, qty_dead = qty_dead + ?, last_updated = datetime('now') WHERE id = ?", (ded, ded, stock["id"]))
        else:
            next_qty = avail + qty_delta
            if next_qty < 0:
                raise HTTPException(status_code=400, detail="Adjustment would result in negative stock")
            conn.execute("UPDATE branch_stock SET qty_available = ?, last_updated = datetime('now') WHERE id = ?", (next_qty, stock["id"]))

        delta_val = -abs(qty_delta) if movement_type in ("damage", "dead_stock") else qty_delta
        conn.execute(
            "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)",
            (uid("mov"), auth.active_tenant_id, branch_id, product_id, movement_type, delta_val, prod["purchase_price"], notes, auth.session["userId"]),
        )
        log_audit(conn, auth.active_tenant_id, branch_id, auth.session, "STOCK_ADJUST", "product", product_id, {"movementType": movement_type, "qtyDelta": qty_delta, "notes": notes}, auth.ip)
        return {"ok": True}


@app.get("/api/inventory/movements")
def list_movements(branchId: Optional[str] = Query(default=None), auth: AuthContext = Depends(get_auth)):
    bf = "AND sm.branch_id = ?" if branchId and branchId != "all" else ""
    args = [auth.active_tenant_id, branchId] if bf else [auth.active_tenant_id]
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                f"""
                SELECT sm.*, p.name as product_name, p.sku, p.unit, b.name as branch_name
                FROM stock_movements sm
                JOIN products p ON p.id = sm.product_id
                JOIN branches b ON b.id = sm.branch_id
                WHERE sm.tenant_id = ? {bf}
                ORDER BY sm.created_at DESC
                LIMIT 100
                """,
                args,
            ).fetchall()
        )


@app.get("/api/inventory/transfers")
def list_transfers(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        transfers = rows_to_dicts(
            conn.execute(
                """
                SELECT t.*, bf.name as from_branch_name, bt.name as to_branch_name
                FROM stock_transfers t
                JOIN branches bf ON bf.id = t.from_branch_id
                JOIN branches bt ON bt.id = t.to_branch_id
                WHERE t.tenant_id = ?
                ORDER BY t.dispatched_at DESC
                """,
                (auth.active_tenant_id,),
            ).fetchall()
        )
        for t in transfers:
            t["items"] = rows_to_dicts(
                conn.execute(
                    "SELECT ti.*, p.name as product_name, p.sku, p.unit FROM stock_transfer_items ti JOIN products p ON p.id = ti.product_id WHERE ti.transfer_id = ?",
                    (t["id"],),
                ).fetchall()
            )
        return transfers


@app.post("/api/inventory/transfers")
def create_transfer(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    from_id = body.get("fromBranchId")
    to_id = body.get("toBranchId")
    items = body.get("items") or []
    notes = body.get("notes") or ""
    if not from_id or not to_id or from_id == to_id or not items:
        raise HTTPException(status_code=400, detail="Valid source branch, destination branch, and items are required")

    trf_id = uid("trf")
    trf_no = f"TRF-{datetime.now(timezone.utc).year}-{secrets.randbelow(9000) + 1000}"
    with get_db() as conn:
        conn.execute(
            "INSERT INTO stock_transfers (id, tenant_id, transfer_no, from_branch_id, to_branch_id, status, notes, dispatched_by) VALUES (?, ?, ?, ?, ?, 'dispatched', ?, ?)",
            (trf_id, auth.active_tenant_id, trf_no, from_id, to_id, notes, auth.session["userId"]),
        )
        for it in items:
            pid = it.get("productId")
            qty = float(it.get("qty") or 0)
            stk = conn.execute("SELECT id, qty_available FROM branch_stock WHERE tenant_id = ? AND branch_id = ? AND product_id = ?", (auth.active_tenant_id, from_id, pid)).fetchone()
            if not stk or float(stk["qty_available"]) < qty:
                raise HTTPException(status_code=400, detail=f"Insufficient stock at source branch for product {pid}")
            conn.execute("UPDATE branch_stock SET qty_available = qty_available - ?, last_updated = datetime('now') WHERE id = ?", (qty, stk["id"]))
            conn.execute("INSERT INTO stock_transfer_items (id, transfer_id, product_id, qty_sent, qty_received) VALUES (?, ?, ?, ?, 0)", (uid("trfi"), trf_id, pid, qty))
            conn.execute(
                "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, notes, created_by) VALUES (?, ?, ?, ?, 'transfer_out', ?, 'stock_transfer', ?, 'Dispatched to destination branch', ?)",
                (uid("mov"), auth.active_tenant_id, from_id, pid, -qty, trf_no, auth.session["userId"]),
            )
        log_audit(conn, auth.active_tenant_id, from_id, auth.session, "DISPATCH_TRANSFER", "stock_transfer", trf_id, {"transferNo": trf_no, "toBranchId": to_id, "items": items}, auth.ip)
        return {"ok": True, "id": trf_id, "transferNo": trf_no}


@app.post("/api/inventory/transfers/{transfer_id}/receive")
def receive_transfer(transfer_id: str, auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    with get_db() as conn:
        trf = conn.execute("SELECT * FROM stock_transfers WHERE id = ? AND tenant_id = ?", (transfer_id, auth.active_tenant_id)).fetchone()
        if not trf:
            raise HTTPException(status_code=404, detail="Transfer not found")
        if trf["status"] == "received":
            raise HTTPException(status_code=400, detail="Transfer already received")
        items = conn.execute("SELECT * FROM stock_transfer_items WHERE transfer_id = ?", (transfer_id,)).fetchall()
        conn.execute("UPDATE stock_transfers SET status = 'received', received_by = ?, received_at = datetime('now') WHERE id = ?", (auth.session["userId"], transfer_id))
        for it in items:
            conn.execute("UPDATE stock_transfer_items SET qty_received = ? WHERE id = ?", (it["qty_sent"], it["id"]))
            conn.execute(
                """
                INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET qty_available = qty_available + excluded.qty_available, last_updated = datetime('now')
                """,
                (uid("stk"), auth.active_tenant_id, trf["to_branch_id"], it["product_id"], it["qty_sent"]),
            )
            conn.execute(
                "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, notes, created_by) VALUES (?, ?, ?, ?, 'transfer_in', ?, 'stock_transfer', ?, 'Received from source branch', ?)",
                (uid("mov"), auth.active_tenant_id, trf["to_branch_id"], it["product_id"], it["qty_sent"], trf["transfer_no"], auth.session["userId"]),
            )
        log_audit(conn, auth.active_tenant_id, trf["to_branch_id"], auth.session, "RECEIVE_TRANSFER", "stock_transfer", transfer_id, {"transferNo": trf["transfer_no"]}, auth.ip)
        return {"ok": True}


# ================= SUPPLIERS & PURCHASE ORDERS =================
@app.get("/api/purchases/suppliers")
def list_suppliers(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM suppliers WHERE tenant_id = ? AND is_deleted = 0 ORDER BY name", (auth.active_tenant_id,)).fetchall())


@app.post("/api/purchases/suppliers")
def create_supplier(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager", "accountant"]))):
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Supplier name required")
    sid = uid("sup")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO suppliers (id, tenant_id, name, gstin, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (sid, auth.active_tenant_id, name, body.get("gstin") or "", body.get("phone") or "", body.get("email") or "", body.get("address") or ""),
        )
        return {"ok": True, "id": sid}


@app.get("/api/purchases/orders")
def list_purchase_orders(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT po.*, s.name as supplier_name, b.name as branch_name
                FROM purchase_orders po
                JOIN suppliers s ON s.id = po.supplier_id
                JOIN branches b ON b.id = po.branch_id
                WHERE po.tenant_id = ?
                ORDER BY po.created_at DESC
                """,
                (auth.active_tenant_id,),
            ).fetchall()
        )


@app.post("/api/purchases/orders")
def create_purchase_order(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager", "accountant"]))):
    branch_id = body.get("branchId")
    supplier_id = body.get("supplierId")
    items = body.get("items") or []
    if not branch_id or not supplier_id or not items:
        raise HTTPException(status_code=400, detail="Branch, supplier, and items required")

    receive_now = bool(body.get("receiveImmediately"))
    subtotal = 0.0
    gst_amount = 0.0
    for it in items:
        line_sub = float(it["qty"]) * float(it["unitCost"])
        subtotal += line_sub
        gst_amount += (line_sub * float(it.get("gstRate", 18))) / 100.0
    total_amount = round(subtotal + gst_amount)
    paid = min(total_amount, float(body.get("paidAmount") or 0))
    balance_added = total_amount - paid
    po_id = uid("po")
    po_no = f"PO-{datetime.now(timezone.utc).year}-{secrets.randbelow(9000) + 1000}"

    with get_db() as conn:
        conn.execute(
            "INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, po_no, status, subtotal, gst_amount, total_amount, paid_amount, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (po_id, auth.active_tenant_id, branch_id, supplier_id, po_no, "received" if receive_now else "ordered", subtotal, gst_amount, total_amount, paid, body.get("notes") or "", auth.session["userId"]),
        )
        for it in items:
            qty = float(it["qty"])
            cost = float(it["unitCost"])
            gst = float(it.get("gstRate", 18))
            line_sub = qty * cost
            line_tot = line_sub + (line_sub * gst) / 100.0
            conn.execute(
                "INSERT INTO purchase_order_items (id, po_id, product_id, qty, unit_cost, gst_rate, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (uid("poi"), po_id, it["productId"], qty, cost, gst, line_tot),
            )
            if receive_now:
                conn.execute(
                    """
                    INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET qty_available = qty_available + excluded.qty_available, last_updated = datetime('now')
                    """,
                    (uid("stk"), auth.active_tenant_id, branch_id, it["productId"], qty),
                )
                conn.execute("UPDATE products SET purchase_price = ? WHERE id = ? AND tenant_id = ?", (cost, it["productId"], auth.active_tenant_id))
                conn.execute(
                    "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase_order', ?, ?, 'PO received into stock', ?)",
                    (uid("mov"), auth.active_tenant_id, branch_id, it["productId"], qty, po_no, cost, auth.session["userId"]),
                )
        if receive_now and balance_added > 0:
            conn.execute("UPDATE suppliers SET balance_payable = balance_payable + ? WHERE id = ? AND tenant_id = ?", (balance_added, supplier_id, auth.active_tenant_id))
        log_audit(conn, auth.active_tenant_id, branch_id, auth.session, "CREATE_PO", "purchase_order", po_id, {"poNo": po_no, "totalAmount": total_amount, "receiveImmediately": receive_now}, auth.ip)
        return {"ok": True, "id": po_id, "poNo": po_no, "totalAmount": total_amount}


@app.post("/api/purchases/orders/{po_id}/receive")
def receive_purchase_order(po_id: str, auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    with get_db() as conn:
        po = conn.execute("SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?", (po_id, auth.active_tenant_id)).fetchone()
        if not po:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        if po["status"] == "received":
            raise HTTPException(status_code=400, detail="Already received")
        items = conn.execute("SELECT * FROM purchase_order_items WHERE po_id = ?", (po_id,)).fetchall()
        conn.execute("UPDATE purchase_orders SET status = 'received' WHERE id = ?", (po_id,))
        for it in items:
            conn.execute(
                """
                INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET qty_available = qty_available + excluded.qty_available, last_updated = datetime('now')
                """,
                (uid("stk"), auth.active_tenant_id, po["branch_id"], it["product_id"], it["qty"]),
            )
            conn.execute(
                "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase_order', ?, ?, 'PO receiving confirmed', ?)",
                (uid("mov"), auth.active_tenant_id, po["branch_id"], it["product_id"], it["qty"], po["po_no"], it["unit_cost"], auth.session["userId"]),
            )
        unpaid = float(po["total_amount"]) - float(po["paid_amount"])
        if unpaid > 0:
            conn.execute("UPDATE suppliers SET balance_payable = balance_payable + ? WHERE id = ?", (unpaid, po["supplier_id"]))
        return {"ok": True}


# ================= POS BILLING & SALES =================
@app.get("/api/pos/invoices")
def list_invoices(branchId: Optional[str] = Query(default=None), auth: AuthContext = Depends(get_auth)):
    bf = "AND i.branch_id = ?" if branchId and branchId != "all" else ""
    args = [auth.active_tenant_id, branchId] if bf else [auth.active_tenant_id]
    with get_db() as conn:
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.gstin as customer_gstin, c.address as customer_address,
                       b.name as branch_name, b.code as branch_code, b.address as branch_address, b.gstin as branch_gstin, b.state_code as branch_state_code,
                       u.full_name as salesman_name
                FROM invoices i
                LEFT JOIN customers c ON c.id = i.customer_id
                JOIN branches b ON b.id = i.branch_id
                LEFT JOIN users u ON u.id = i.salesman_id
                WHERE i.tenant_id = ? {bf}
                ORDER BY i.created_at DESC
                LIMIT 100
                """,
                args,
            ).fetchall()
        )
        for r in rows:
            r["payment_breakdown"] = json.loads(str(r.get("payment_breakdown_json") or "{}"))
            r["items"] = rows_to_dicts(conn.execute("SELECT * FROM invoice_items WHERE invoice_id = ?", (r["id"],)).fetchall())
        return rows


@app.post("/api/pos/invoices")
def create_invoice(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    branch_id = body.get("branchId")
    doc_type = body.get("docType") or "invoice"
    customer_id = body.get("customerId") or None
    salesman_id = body.get("salesmanId") or None
    items = body.get("items") or []
    overall_disc = float(body.get("overallDiscountAmount") or 0)
    pay_bk = body.get("paymentBreakdown") or {"cash": 0, "upi": 0, "card": 0, "bank": 0}
    due_date = body.get("dueDate") or None
    notes = body.get("notes") or ""
    idem = body.get("idempotencyKey") or None
    allow_neg_override = bool(body.get("allowNegativeOverride"))

    if not branch_id or not items:
        raise HTTPException(status_code=400, detail="Branch and at least one line item are required")

    with get_db() as conn:
        if idem:
            dup = conn.execute("SELECT id, invoice_no FROM invoices WHERE tenant_id = ? AND idempotency_key = ?", (tenant_id, idem)).fetchone()
            if dup:
                return {"ok": True, "id": dup["id"], "invoiceNo": dup["invoice_no"], "deduplicated": True}

        trow = conn.execute("SELECT config_json FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
        tenant_cfg = json.loads(str(trow["config_json"] or "{}")) if trow else {}
        branch = conn.execute("SELECT * FROM branches WHERE id = ? AND tenant_id = ?", (branch_id, tenant_id)).fetchone()
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found for tenant")

        customer = conn.execute("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", (customer_id, tenant_id)).fetchone() if customer_id else None
        is_interstate = bool(customer and customer["state_code"] and str(customer["state_code"]) != str(branch["state_code"]))
        affects_stock = doc_type in ("invoice", "challan")

        max_cashier_disc = float(tenant_cfg.get("maxCashierDiscountPct", 10))
        for line in items:
            disc_pct = float(line.get("discountPct") or 0)
            if disc_pct > max_cashier_disc and auth.session["role"] not in ("super_admin", "owner", "branch_manager"):
                raise HTTPException(status_code=403, detail=f"Line discount ({disc_pct}%) exceeds cashier limit of {max_cashier_disc}%. Manager approval required.")

        inv_id = uid("inv")
        prefix = "QTN" if doc_type == "quotation" else "CHL" if doc_type == "challan" else "INV"
        invoice_no = f"{prefix}-{branch['code']}-{datetime.now(timezone.utc).year}-{secrets.randbelow(9000) + 1000}"

        subtotal = total_line_disc = taxable_total = cgst_total = sgst_total = igst_total = 0.0
        computed_lines = []

        for line in items:
            prod = conn.execute("SELECT * FROM products WHERE id = ? AND tenant_id = ? AND is_deleted = 0", (line["productId"], tenant_id)).fetchone()
            if not prod:
                raise HTTPException(status_code=400, detail=f"Product {line['productId']} not found")
            qty = float(line["qty"])
            unit_price = float(line["unitPrice"])
            disc_pct = float(line.get("discountPct") or 0)

            if affects_stock:
                stk = conn.execute("SELECT qty_available FROM branch_stock WHERE branch_id = ? AND product_id = ? AND tenant_id = ?", (branch_id, line["productId"], tenant_id)).fetchone()
                avail = float(stk["qty_available"] if stk else 0)
                can_neg = bool(tenant_cfg.get("allowNegativeStock")) or (allow_neg_override and auth.session["role"] in ("super_admin", "owner"))
                if not can_neg and avail < qty:
                    raise HTTPException(status_code=400, detail=f"Insufficient stock at {branch['name']} for \"{prod['name']}\" (Available: {avail}, Requested: {qty})")

            gst_rate = float(prod["gst_rate"] if prod["gst_rate"] is not None else 18)
            inclusive = bool(line.get("taxInclusive")) if line.get("taxInclusive") is not None else bool(prod["tax_inclusive"])
            gross_line = qty * unit_price
            line_disc = (gross_line * disc_pct) / 100.0
            after_disc = gross_line - line_disc

            if inclusive:
                taxable_val = after_disc / (1.0 + gst_rate / 100.0)
                tax_val = after_disc - taxable_val
            else:
                taxable_val = after_disc
                tax_val = (after_disc * gst_rate) / 100.0

            cgst = 0.0 if is_interstate else tax_val / 2.0
            sgst = 0.0 if is_interstate else tax_val / 2.0
            igst = tax_val if is_interstate else 0.0

            subtotal += gross_line
            total_line_disc += line_disc
            taxable_total += taxable_val
            cgst_total += cgst
            sgst_total += sgst
            igst_total += igst

            computed_lines.append({
                "id": uid("ii"),
                "productId": prod["id"],
                "sku": prod["sku"],
                "productName": prod["name"],
                "hsnCode": prod["hsn_code"],
                "qty": qty,
                "unit": prod["unit"],
                "unitPrice": unit_price,
                "purchaseCost": float(prod["purchase_price"] or 0),
                "discountPct": disc_pct,
                "gstRate": gst_rate,
                "taxableValue": round(taxable_val, 2),
                "cgst": round(cgst, 2),
                "sgst": round(sgst, 2),
                "igst": round(igst, 2),
                "total": round(taxable_val + cgst + sgst + igst, 2),
            })

        extra_disc = min(taxable_total * 0.5, overall_disc)
        discount_amount = round(total_line_disc + extra_disc, 2)
        ratio = max(0.0, (taxable_total - extra_disc) / taxable_total) if taxable_total > 0 else 1.0
        taxable_total = round(taxable_total * ratio, 2)
        cgst_total = round(cgst_total * ratio, 2)
        sgst_total = round(sgst_total * ratio, 2)
        igst_total = round(igst_total * ratio, 2)

        total_amount = round(taxable_total + cgst_total + sgst_total + igst_total)
        raw_paid = float(pay_bk.get("cash") or 0) + float(pay_bk.get("upi") or 0) + float(pay_bk.get("card") or 0) + float(pay_bk.get("bank") or 0)
        paid_amount = 0.0 if doc_type == "quotation" else min(total_amount, raw_paid)
        due_amount = 0.0 if doc_type == "quotation" else max(0.0, total_amount - paid_amount)
        payment_status = "quotation" if doc_type == "quotation" else ("paid" if due_amount == 0 else ("partial" if paid_amount > 0 else "unpaid"))

        if doc_type == "invoice" and due_amount > 0 and customer:
            next_due = float(customer["outstanding_balance"] or 0) + due_amount
            limit = float(customer["credit_limit"] or 0)
            if limit > 0 and next_due > limit and auth.session["role"] not in ("super_admin", "owner"):
                raise HTTPException(status_code=400, detail=f"Customer credit limit exceeded (Limit: {limit}, Projected Due: {next_due})")

        conn.execute(
            """
            INSERT INTO invoices (id, tenant_id, branch_id, invoice_no, doc_type, customer_id, salesman_id, cashier_id, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, paid_amount, due_amount, payment_status, payment_breakdown_json, due_date, notes, idempotency_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                inv_id, tenant_id, branch_id, invoice_no, doc_type, customer_id,
                salesman_id or auth.session["userId"], auth.session["userId"],
                round(subtotal, 2), discount_amount, taxable_total, cgst_total, sgst_total, igst_total,
                total_amount, paid_amount, due_amount, payment_status, json.dumps(pay_bk), due_date, notes, idem,
            ),
        )

        for cl in computed_lines:
            conn.execute(
                """
                INSERT INTO invoice_items (id, invoice_id, product_id, sku, product_name, hsn_code, qty, unit, unit_price, purchase_cost, discount_pct, gst_rate, taxable_value, cgst, sgst, igst, total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (cl["id"], inv_id, cl["productId"], cl["sku"], cl["productName"], cl["hsnCode"], cl["qty"], cl["unit"], cl["unitPrice"], cl["purchaseCost"], cl["discountPct"], cl["gstRate"], cl["taxableValue"], cl["cgst"], cl["sgst"], cl["igst"], cl["total"]),
            )
            if affects_stock:
                conn.execute(
                    "UPDATE branch_stock SET qty_available = qty_available - ?, last_updated = datetime('now') WHERE branch_id = ? AND product_id = ? AND tenant_id = ?",
                    (cl["qty"], branch_id, cl["productId"], tenant_id),
                )
                conn.execute(
                    "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'sale', ?, 'invoice', ?, ?, ?, ?)",
                    (uid("mov"), tenant_id, branch_id, cl["productId"], -cl["qty"], invoice_no, cl["purchaseCost"], f"{doc_type.upper()} billed", auth.session["userId"]),
                )

        if doc_type == "invoice":
            if due_amount > 0 and customer_id:
                conn.execute(
                    "UPDATE customers SET outstanding_balance = outstanding_balance + ?, due_date = COALESCE(?, due_date) WHERE id = ? AND tenant_id = ?",
                    (due_amount, due_date, customer_id, tenant_id),
                )
            for mk, mamt in pay_bk.items():
                amt = float(mamt or 0)
                if amt > 0:
                    db_mode = "bank_transfer" if mk == "bank" else mk
                    conn.execute(
                        "INSERT INTO payments (id, tenant_id, branch_id, party_type, party_id, invoice_id, amount, mode, reference_no, status, notes, verified_by) VALUES (?, ?, ?, 'customer', ?, ?, ?, ?, ?, 'verified', ?, ?)",
                        (uid("pay"), tenant_id, branch_id, customer_id or "walkin", inv_id, amt, db_mode, invoice_no, f"POS {db_mode.upper()} payment", auth.session["userId"]),
                    )

        log_audit(conn, tenant_id, branch_id, auth.session, "CREATE_INVOICE", "invoice", inv_id, {"invoiceNo": invoice_no, "docType": doc_type, "totalAmount": total_amount, "paidAmount": paid_amount, "dueAmount": due_amount}, auth.ip)
        return {"ok": True, "id": inv_id, "invoiceNo": invoice_no, "totalAmount": total_amount, "dueAmount": due_amount, "cgstTotal": cgst_total, "sgstTotal": sgst_total, "igstTotal": igst_total}


@app.post("/api/pos/invoices/{inv_id}/cancel")
def cancel_invoice(inv_id: str, body: Dict[str, Any] = Body(default={}), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    reason = body.get("reason") or "Sales return / Credit note issued"
    with get_db() as conn:
        inv = conn.execute("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?", (inv_id, auth.active_tenant_id)).fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if inv["is_cancelled"]:
            raise HTTPException(status_code=400, detail="Invoice already cancelled / returned")
        items = conn.execute("SELECT * FROM invoice_items WHERE invoice_id = ?", (inv_id,)).fetchall()
        conn.execute("UPDATE invoices SET is_cancelled = 1, payment_status = 'cancelled', cancel_reason = ? WHERE id = ?", (reason, inv_id))
        if inv["doc_type"] in ("invoice", "challan"):
            for it in items:
                conn.execute(
                    "UPDATE branch_stock SET qty_available = qty_available + ?, last_updated = datetime('now') WHERE branch_id = ? AND product_id = ? AND tenant_id = ?",
                    (it["qty"], inv["branch_id"], it["product_id"], auth.active_tenant_id),
                )
                conn.execute(
                    "INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'return', ?, 'credit_note', ?, ?, ?, ?)",
                    (uid("mov"), auth.active_tenant_id, inv["branch_id"], it["product_id"], it["qty"], inv["invoice_no"], it["purchase_cost"], reason, auth.session["userId"]),
                )
            if inv["customer_id"] and float(inv["due_amount"]) > 0:
                conn.execute("UPDATE customers SET outstanding_balance = MAX(0, outstanding_balance - ?) WHERE id = ? AND tenant_id = ?", (inv["due_amount"], inv["customer_id"], auth.active_tenant_id))
        log_audit(conn, auth.active_tenant_id, inv["branch_id"], auth.session, "CANCEL_INVOICE", "invoice", inv_id, {"invoiceNo": inv["invoice_no"], "reason": reason}, auth.ip)
        return {"ok": True}


# ================= ACCOUNTS & FINANCIAL LEDGER =================
@app.get("/api/accounts/overview")
def accounts_overview(branchId: Optional[str] = Query(default=None), auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    bf_p = "AND p.branch_id = ?" if branchId and branchId != "all" else ""
    bf_e = "AND e.branch_id = ?" if branchId and branchId != "all" else ""
    bf_c = "AND c.branch_id = ?" if branchId and branchId != "all" else ""
    bf_plain = "AND branch_id = ?" if branchId and branchId != "all" else ""
    args = [tenant_id, branchId] if bf_plain else [tenant_id]

    with get_db() as conn:
        payments = rows_to_dicts(conn.execute(f"SELECT p.*, b.name as branch_name FROM payments p JOIN branches b ON b.id = p.branch_id WHERE p.tenant_id = ? {bf_p} ORDER BY p.created_at DESC LIMIT 80", args).fetchall())
        expenses = rows_to_dicts(conn.execute(f"SELECT e.*, b.name as branch_name FROM expenses e JOIN branches b ON b.id = e.branch_id WHERE e.tenant_id = ? AND e.is_deleted = 0 {bf_e} ORDER BY e.expense_date DESC LIMIT 80", args).fetchall())
        closings = rows_to_dicts(conn.execute(f"SELECT c.*, b.name as branch_name FROM cash_closings c JOIN branches b ON b.id = c.branch_id WHERE c.tenant_id = ? {bf_c} ORDER BY c.closing_date DESC LIMIT 30", args).fetchall())
        pnl_rows = rows_to_dicts(
            conn.execute(
                """
                SELECT b.id as branch_id, b.name as branch_name,
                  COALESCE((SELECT SUM(i.taxable_amount) FROM invoices i WHERE i.branch_id = b.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'), 0) as revenue_ex_tax,
                  COALESCE((SELECT SUM(ii.qty * ii.purchase_cost) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.branch_id = b.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'), 0) as cogs,
                  COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.branch_id = b.id AND e.is_deleted = 0), 0) as expenses
                FROM branches b WHERE b.tenant_id = ?
                """,
                (tenant_id,),
            ).fetchall()
        )
        branch_pnl = []
        for r in pnl_rows:
            gp = float(r["revenue_ex_tax"] or 0) - float(r["cogs"] or 0)
            np = gp - float(r["expenses"] or 0)
            branch_pnl.append({**r, "grossProfit": gp, "netProfit": np})

        cash_total = conn.execute(f"SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND mode = 'cash' {bf_plain}", args).fetchone()["s"]
        upi_total = conn.execute(f"SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND mode = 'upi' {bf_plain}", args).fetchone()["s"]
        bank_total = conn.execute(f"SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND mode IN ('bank_transfer','card') {bf_plain}", args).fetchone()["s"]
        return {
            "payments": payments,
            "expenses": expenses,
            "closings": closings,
            "branchPnl": branch_pnl,
            "totals": {
                "cashInflow": cash_total,
                "upiInflow": upi_total,
                "bankCardInflow": bank_total,
                "totalExpenses": sum(float(e.get("amount") or 0) for e in expenses),
            },
        }


@app.post("/api/accounts/expenses")
def create_expense(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    branch_id = body.get("branchId")
    category = body.get("category")
    amount = body.get("amount")
    if not branch_id or not category or not amount:
        raise HTTPException(status_code=400, detail="Branch, category, and amount required")
    eid = uid("exp")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO expenses (id, tenant_id, branch_id, category, description, amount, payment_mode, vendor_name, expense_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                eid,
                auth.active_tenant_id,
                branch_id,
                category,
                body.get("description") or "",
                float(amount),
                body.get("paymentMode") or "cash",
                body.get("vendorName") or "",
                body.get("expenseDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                auth.session["userId"],
            ),
        )
        log_audit(conn, auth.active_tenant_id, branch_id, auth.session, "CREATE_EXPENSE", "expense", eid, {"category": category, "amount": amount}, auth.ip)
        return {"ok": True, "id": eid}


@app.post("/api/accounts/payments")
def record_payment(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    branch_id = body.get("branchId")
    party_type = body.get("partyType") or "customer"
    party_id = body.get("partyId")
    invoice_id = body.get("invoiceId") or None
    amt = float(body.get("amount") or 0)
    mode = body.get("mode") or "upi"
    if not branch_id or not party_id or amt <= 0:
        raise HTTPException(status_code=400, detail="Branch, party, and positive amount are required")

    pay_id = uid("pay")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO payments (id, tenant_id, branch_id, party_type, party_id, invoice_id, amount, mode, reference_no, status, notes, verified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)",
            (pay_id, tenant_id, branch_id, party_type, party_id, invoice_id, amt, mode, body.get("referenceNo") or f"RCPT-{int(time.time()) % 1000000}", body.get("notes") or "Payment recorded & verified", auth.session["userId"]),
        )
        if party_type == "supplier":
            conn.execute("UPDATE suppliers SET balance_payable = MAX(0, balance_payable - ?) WHERE id = ? AND tenant_id = ?", (amt, party_id, tenant_id))
        else:
            conn.execute("UPDATE customers SET outstanding_balance = MAX(0, outstanding_balance - ?) WHERE id = ? AND tenant_id = ?", (amt, party_id, tenant_id))
            if invoice_id:
                inv = conn.execute("SELECT paid_amount, due_amount, total_amount FROM invoices WHERE id = ? AND tenant_id = ?", (invoice_id, tenant_id)).fetchone()
                if inv:
                    next_paid = min(float(inv["total_amount"]), float(inv["paid_amount"]) + amt)
                    next_due = max(0.0, float(inv["total_amount"]) - next_paid)
                    conn.execute("UPDATE invoices SET paid_amount = ?, due_amount = ?, payment_status = ? WHERE id = ?", (next_paid, next_due, "paid" if next_due == 0 else "partial", invoice_id))
            cust = conn.execute("SELECT name, phone, whatsapp_opt_in, outstanding_balance FROM customers WHERE id = ?", (party_id,)).fetchone()
            if cust and cust["whatsapp_opt_in"]:
                conn.execute(
                    "INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, ?, 'outbound', 'payment_thank_you', ?, 'simulated', 1)",
                    (uid("wa"), tenant_id, branch_id, party_id, cust["phone"], f"Thank you {cust['name']}! We verified your payment of ₹{amt:,.0f} via {str(mode).upper()}. Remaining balance: ₹{float(cust['outstanding_balance']):,.0f}."),
                )
        log_audit(conn, tenant_id, branch_id, auth.session, "RECORD_PAYMENT", "payment", pay_id, {"partyType": party_type, "partyId": party_id, "amt": amt, "mode": mode}, auth.ip)
        return {"ok": True, "id": pay_id}


@app.post("/api/accounts/cash-closing")
def create_cash_closing(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    branch_id = body.get("branchId")
    date_str = body.get("closingDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    opening_cash = float(body.get("openingCash") or 0)
    actual_cash = float(body.get("actualCash") or 0)
    with get_db() as conn:
        cash_sales = conn.execute("SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND branch_id = ? AND mode = 'cash' AND date(created_at) = date(?)", (tenant_id, branch_id, date_str)).fetchone()["s"]
        cash_exp = conn.execute("SELECT COALESCE(SUM(amount), 0) as s FROM expenses WHERE tenant_id = ? AND branch_id = ? AND payment_mode = 'cash' AND date(expense_date) = date(?) AND is_deleted = 0", (tenant_id, branch_id, date_str)).fetchone()["s"]
        expected = opening_cash + float(cash_sales) - float(cash_exp)
        discrepancy = actual_cash - expected
        cid = uid("cls")
        conn.execute(
            "INSERT INTO cash_closings (id, tenant_id, branch_id, closing_date, opening_cash, cash_sales, cash_receipts, cash_expenses, expected_cash, actual_cash, discrepancy, notes, closed_by) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
            (cid, tenant_id, branch_id, date_str, opening_cash, cash_sales, cash_exp, expected, actual_cash, discrepancy, body.get("notes") or "", auth.session["userId"]),
        )
        log_audit(conn, tenant_id, branch_id, auth.session, "CASH_CLOSING", "cash_closing", cid, {"expectedCash": expected, "actualCash": actual_cash, "discrepancy": discrepancy}, auth.ip)
        return {"ok": True, "id": cid, "expectedCash": expected, "discrepancy": discrepancy}


# ================= CUSTOMER CRM & 9 AM SCHEDULER =================
@app.get("/api/crm/customers")
def list_customers(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT c.*,
                  (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice') as invoice_count,
                  (SELECT COALESCE(SUM(total_amount), 0) FROM invoices i WHERE i.customer_id = c.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice') as lifetime_value
                FROM customers c
                WHERE c.tenant_id = ? AND c.is_deleted = 0
                ORDER BY c.outstanding_balance DESC, c.name ASC
                """,
                (auth.active_tenant_id,),
            ).fetchall()
        )


@app.post("/api/crm/customers")
def create_customer(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    name = body.get("name")
    phone = body.get("phone")
    if not name or not phone:
        raise HTTPException(status_code=400, detail="Customer name and phone are required")
    cid = uid("cust")
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO customers (id, tenant_id, branch_id, name, phone, email, address, state_code, gstin, segment, credit_limit, whatsapp_opt_in, due_date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cid,
                auth.active_tenant_id,
                body.get("branchId") or None,
                name,
                phone,
                body.get("email") or "",
                body.get("address") or "",
                body.get("stateCode") or "27",
                body.get("gstin") or "",
                body.get("segment") or "retail",
                float(body.get("creditLimit") if body.get("creditLimit") is not None else 50000),
                0 if body.get("whatsappOptIn") is False else 1,
                body.get("dueDate") or None,
                body.get("notes") or "",
            ),
        )
        return {"ok": True, "id": cid}


@app.patch("/api/crm/customers/{cust_id}")
def update_customer(cust_id: str, body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    wa_opt = None if "whatsappOptIn" not in body or body["whatsappOptIn"] is None else (1 if body["whatsappOptIn"] else 0)
    with get_db() as conn:
        conn.execute(
            """
            UPDATE customers
            SET whatsapp_opt_in = COALESCE(?, whatsapp_opt_in),
                credit_limit = COALESCE(?, credit_limit),
                segment = COALESCE(?, segment),
                due_date = COALESCE(?, due_date)
            WHERE id = ? AND tenant_id = ?
            """,
            (wa_opt, body.get("creditLimit"), body.get("segment"), body.get("dueDate"), cust_id, auth.active_tenant_id),
        )
        return {"ok": True}


@app.post("/api/crm/run-reminders")
def run_reminders(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        overdue = conn.execute(
            "SELECT * FROM customers WHERE tenant_id = ? AND is_deleted = 0 AND whatsapp_opt_in = 1 AND outstanding_balance > 0 AND (due_date IS NULL OR date(due_date) <= date('now'))",
            (auth.active_tenant_id,),
        ).fetchall()
        sent = 0
        for c in overdue:
            conn.execute(
                "INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, ?, 'outbound', 'due_payment_reminder_9am', ?, 'simulated', 1)",
                (uid("wa"), auth.active_tenant_id, c["branch_id"], c["id"], c["phone"], f"[09:00 AM Scheduler] Dear {c['name']}, reminder for your pending balance of ₹{float(c['outstanding_balance']):,.0f}. Pay via UPI or bank transfer to stop further reminders."),
            )
            sent += 1
        log_audit(conn, auth.active_tenant_id, None, auth.session, "RUN_9AM_REMINDERS", "crm", None, {"sentCount": sent}, auth.ip)
        return {"ok": True, "sentCount": sent}


@app.get("/api/crm/complaints")
def list_complaints(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT cc.*, c.name as customer_name, c.phone as customer_phone FROM customer_complaints cc JOIN customers c ON c.id = cc.customer_id WHERE cc.tenant_id = ? ORDER BY cc.created_at DESC",
                (auth.active_tenant_id,),
            ).fetchall()
        )


@app.post("/api/crm/complaints")
def create_complaint(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    cust_id = body.get("customerId")
    subject = body.get("subject")
    if not cust_id or not subject:
        raise HTTPException(status_code=400, detail="Customer and subject required")
    cid = uid("cmp")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO customer_complaints (id, tenant_id, branch_id, customer_id, subject, description, status, follow_up_date) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
            (cid, auth.active_tenant_id, body.get("branchId") or None, cust_id, subject, body.get("description") or "", body.get("followUpDate") or None),
        )
        return {"ok": True, "id": cid}


@app.patch("/api/crm/complaints/{comp_id}")
def update_complaint(comp_id: str, body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        conn.execute("UPDATE customer_complaints SET status = ? WHERE id = ? AND tenant_id = ?", (body.get("status"), comp_id, auth.active_tenant_id))
        return {"ok": True}


# ================= STAFF, FACE ATTENDANCE & PAYROLL =================
@app.get("/api/staff/employees")
def list_employees(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT u.id, u.tenant_id, u.branch_id, b.name as branch_name, u.email, u.full_name, u.role, u.phone, u.address,
                       u.salary_monthly, u.joining_date, u.monthly_target, u.commission_rate, u.face_enrolled, u.face_consent, u.status,
                       COALESCE((SELECT SUM(i.taxable_amount) FROM invoices i WHERE i.salesman_id = u.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'), 0) as achieved_sales
                FROM users u
                LEFT JOIN branches b ON b.id = u.branch_id
                WHERE u.tenant_id = ? AND u.role != 'super_admin'
                ORDER BY u.full_name ASC
                """,
                (auth.active_tenant_id,),
            ).fetchall()
        )


@app.post("/api/staff/employees")
def create_employee(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    full_name = body.get("fullName")
    email = body.get("email")
    password = body.get("password")
    if not full_name or not email or not password:
        raise HTTPException(status_code=400, detail="Name, email, and password required")
    with get_db() as conn:
        if conn.execute("SELECT id FROM users WHERE lower(email) = lower(?)", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="Email already registered")
        eid = uid("usr")
        conn.execute(
            """
            INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, phone, address, salary_monthly, joining_date, monthly_target, commission_rate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                eid,
                auth.active_tenant_id,
                body.get("branchId") or None,
                email,
                hash_password(password),
                full_name,
                body.get("role") or "salesman",
                body.get("pinCode") or "1234",
                body.get("phone") or "",
                body.get("address") or "",
                float(body.get("salaryMonthly") or 0),
                body.get("joiningDate") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                float(body.get("monthlyTarget") or 0),
                float(body.get("commissionRate") or 0),
            ),
        )
        return {"ok": True, "id": eid}


@app.post("/api/staff/attendance/enroll-face")
def enroll_face(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    user_id = body.get("userId")
    consent = bool(body.get("consent"))
    descriptor = body.get("descriptor") or []
    if not consent:
        raise HTTPException(status_code=400, detail="Employee biometric consent is mandatory before enrollment")
    if len(descriptor) < 16:
        raise HTTPException(status_code=400, detail="Valid facial descriptor vector required")
    with get_db() as conn:
        if not conn.execute("SELECT id FROM users WHERE id = ? AND tenant_id = ?", (user_id, auth.active_tenant_id)).fetchone():
            raise HTTPException(status_code=404, detail="Employee not found")
        conn.execute(
            "UPDATE users SET face_enrolled = 1, face_consent = 1, face_embedding_enc = ? WHERE id = ? AND tenant_id = ?",
            (encrypt_json({"vec": descriptor}), user_id, auth.active_tenant_id),
        )
        log_audit(conn, auth.active_tenant_id, None, auth.session, "ENROLL_FACE_BIOMETRIC", "user", user_id, {"vectorDim": len(descriptor)}, auth.ip)
        return {"ok": True}


@app.get("/api/staff/attendance")
def list_attendance(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(
            conn.execute(
                """
                SELECT a.*, u.full_name, u.role, b.name as branch_name
                FROM attendance_logs a
                JOIN users u ON u.id = a.user_id
                JOIN branches b ON b.id = a.branch_id
                WHERE a.tenant_id = ?
                ORDER BY a.log_date DESC, a.check_in_time DESC
                LIMIT 100
                """,
                (auth.active_tenant_id,),
            ).fetchall()
        )


@app.post("/api/staff/attendance/check")
def attendance_check(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    user_id = body.get("userId")
    branch_id = body.get("branchId")
    action = body.get("action")
    method = body.get("method")
    descriptor = body.get("descriptor") or []
    liveness = body.get("livenessChecks") or {}
    pin_code = body.get("pinCode")
    lat = body.get("lat")
    lng = body.get("lng")

    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ? AND tenant_id = ?", (user_id, tenant_id)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Employee not found")
        branch = conn.execute("SELECT * FROM branches WHERE id = ? AND tenant_id = ?", (branch_id, tenant_id)).fetchone()
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")

        liveness_score = 0.0
        face_match_score = 0.0
        if method == "face_liveness":
            if not user["face_enrolled"] or not user["face_embedding_enc"]:
                raise HTTPException(status_code=400, detail="Face biometric not enrolled for this employee. Use PIN fallback or enroll first.")
            motion = float(liveness.get("motionDelta") or 0)
            lum = float(liveness.get("luminanceVariance") or 0)
            if motion < 0.015 and lum < 1.5:
                raise HTTPException(status_code=403, detail="Liveness verification failed: static photo or spoof detected. Blink or turn slightly during capture.")
            liveness_score = min(0.99, round(0.82 + min(0.17, motion * 2 + lum * 0.01), 2))
            stored = decrypt_json(str(user["face_embedding_enc"]))
            face_match_score = round(cosine_similarity(stored.get("vec") or [], descriptor), 3)
            if face_match_score < 0.72:
                raise HTTPException(status_code=403, detail=f"Face match confidence too low ({face_match_score * 100:.1f}%). Retry in clear lighting.")
        else:
            if str(user["pin_code"]) != str(pin_code):
                raise HTTPException(status_code=403, detail="Invalid attendance PIN")

        geofence_ok = 1
        if lat is not None and lng is not None:
            dist = haversine_meters(float(lat), float(lng), float(branch["lat"]), float(branch["lng"]))
            geofence_ok = 1 if dist <= float(branch["radius_meters"] or 300) else 0

        now_dt = datetime.now(timezone.utc)
        today = now_dt.strftime("%Y-%m-%d")
        now_time = now_dt.strftime("%H:%M")
        existing = conn.execute("SELECT * FROM attendance_logs WHERE tenant_id = ? AND user_id = ? AND log_date = ?", (tenant_id, user_id, today)).fetchone()

        if action == "IN":
            if existing and existing["check_in_time"]:
                raise HTTPException(status_code=409, detail=f"Duplicate IN blocked: already checked in today at {existing['check_in_time']}")
            status = "late" if now_time > "09:15" else "present"
            aid = uid("att")
            conn.execute(
                "INSERT INTO attendance_logs (id, tenant_id, branch_id, user_id, log_date, check_in_time, method, liveness_score, face_match_score, lat, lng, geofence_ok, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (aid, tenant_id, branch_id, user_id, today, now_time, method, liveness_score, face_match_score, lat, lng, geofence_ok, status),
            )
            conn.execute(
                "INSERT INTO whatsapp_logs (id, tenant_id, branch_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, 'outbound', 'owner_attendance_alert', ?, 'simulated', 1)",
                (uid("wa"), tenant_id, branch_id, branch["phone"] or "+91 98200 00001", f"[Attendance IN] {user['full_name']} checked IN at {branch['name']} ({now_time}) via {method}. Geofence: {'OK' if geofence_ok else 'OUTSIDE'}."),
            )
            return {"ok": True, "id": aid, "time": now_time, "status": status, "geofenceOk": geofence_ok, "livenessScore": liveness_score, "faceMatchScore": face_match_score}
        else:
            if not existing:
                raise HTTPException(status_code=400, detail="Cannot check OUT before checking IN today")
            if existing["check_out_time"]:
                raise HTTPException(status_code=409, detail=f"Duplicate OUT blocked: already checked out at {existing['check_out_time']}")
            ot_mins = 45 if now_time > "19:00" else 0
            conn.execute("UPDATE attendance_logs SET check_out_time = ?, overtime_mins = ? WHERE id = ?", (now_time, ot_mins, existing["id"]))
            conn.execute(
                "INSERT INTO whatsapp_logs (id, tenant_id, branch_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, 'outbound', 'owner_attendance_alert', ?, 'simulated', 1)",
                (uid("wa"), tenant_id, branch_id, branch["phone"] or "+91 98200 00001", f"[Attendance OUT] {user['full_name']} checked OUT from {branch['name']} at {now_time}. Overtime: {ot_mins} mins."),
            )
            return {"ok": True, "id": existing["id"], "time": now_time, "overtimeMins": ot_mins}


@app.post("/api/staff/attendance/correct")
def correct_attendance(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    att_id = body.get("attendanceId")
    with get_db() as conn:
        conn.execute(
            "UPDATE attendance_logs SET check_in_time = COALESCE(?, check_in_time), check_out_time = COALESCE(?, check_out_time), status = COALESCE(?, status), method = 'manual_correction', approved_by = ?, correction_reason = ? WHERE id = ? AND tenant_id = ?",
            (body.get("checkInTime"), body.get("checkOutTime"), body.get("status"), auth.session["userId"], body.get("reason") or "Manager approved correction", att_id, auth.active_tenant_id),
        )
        log_audit(conn, auth.active_tenant_id, None, auth.session, "ATTENDANCE_CORRECTION", "attendance", att_id, body, auth.ip)
        return {"ok": True}


@app.post("/api/staff/salary-adjustments")
def create_salary_adjustment(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager", "accountant"]))):
    sid = uid("sadj")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO salary_adjustments (id, tenant_id, branch_id, user_id, amount, type, notes, adj_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?)",
            (sid, auth.active_tenant_id, body.get("branchId") or auth.session.get("branchId"), body.get("userId"), float(body.get("amount") or 0), body.get("type"), body.get("notes") or "", auth.session["userId"]),
        )
        return {"ok": True, "id": sid}


@app.get("/api/staff/payroll")
def get_payroll(auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    with get_db() as conn:
        staff = rows_to_dicts(
            conn.execute(
                "SELECT u.id, u.full_name, u.role, u.salary_monthly, u.joining_date, b.name as branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.tenant_id = ? AND u.role != 'super_admin'",
                (tenant_id,),
            ).fetchall()
        )
        out = []
        for s in staff:
            att = conn.execute("SELECT COUNT(*) as present_days, COALESCE(SUM(overtime_mins), 0) as ot_mins, SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days FROM attendance_logs WHERE tenant_id = ? AND user_id = ?", (tenant_id, s["id"])).fetchone()
            adjs = conn.execute("SELECT type, amount FROM salary_adjustments WHERE tenant_id = ? AND user_id = ?", (tenant_id, s["id"])).fetchall()
            adv = sum(float(a["amount"]) for a in adjs if a["type"] in ("advance", "loan", "deduction"))
            bon = sum(float(a["amount"]) for a in adjs if a["type"] == "bonus")
            ot_pay = round((float(s["salary_monthly"]) / 208.0) * (float(att["ot_mins"]) / 60.0) * 1.5)
            net_sal = max(0.0, float(s["salary_monthly"]) + ot_pay + bon - adv)
            out.append({
                **s,
                "present_days": att["present_days"],
                "late_days": att["late_days"] or 0,
                "overtime_mins": att["ot_mins"],
                "overtime_pay": ot_pay,
                "advances_deductions": adv,
                "bonuses": bon,
                "net_salary": net_sal,
            })
        return out


# ================= META WHATSAPP AUTOMATION =================
@app.get("/api/whatsapp/logs")
def whatsapp_logs(auth: AuthContext = Depends(get_auth)):
    tenant_id = auth.active_tenant_id
    with get_db() as conn:
        logs = rows_to_dicts(
            conn.execute(
                "SELECT w.*, c.name as customer_name FROM whatsapp_logs w LEFT JOIN customers c ON c.id = w.customer_id WHERE w.tenant_id = ? ORDER BY w.created_at DESC LIMIT 80",
                (tenant_id,),
            ).fetchall()
        )
        cfg_row = conn.execute("SELECT status, config_encrypted_json FROM integration_configs WHERE tenant_id = ? AND provider = 'meta_whatsapp'", (tenant_id,)).fetchone()
        cfg = decrypt_json(cfg_row["config_encrypted_json"]) if cfg_row else {}
        return {
            "status": cfg_row["status"] if cfg_row else "not_configured",
            "webhookUrl": cfg.get("webhookUrl") or f"{os.environ.get('APP_URL', '')}/api/whatsapp/webhook/{tenant_id}",
            "logs": logs,
        }


@app.post("/api/whatsapp/send")
def whatsapp_send(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    cust_ids = body.get("customerIds") or []
    msg_body = body.get("messageBody") or ""
    if not cust_ids or not msg_body:
        raise HTTPException(status_code=400, detail="Recipients and message body required")
    with get_db() as conn:
        cfg_row = conn.execute("SELECT status FROM integration_configs WHERE tenant_id = ? AND provider = 'meta_whatsapp'", (auth.active_tenant_id,)).fetchone()
        is_cfg = bool(cfg_row and cfg_row["status"] == "configured")
        sent = skipped = 0
        for cid in cust_ids:
            cust = conn.execute("SELECT id, name, phone, whatsapp_opt_in FROM customers WHERE id = ? AND tenant_id = ?", (cid, auth.active_tenant_id)).fetchone()
            if not cust:
                continue
            if not cust["whatsapp_opt_in"]:
                skipped += 1
                continue
            personalized = msg_body.replace("{{name}}", cust["name"]).replace("{{NAME}}", cust["name"])
            conn.execute(
                "INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?)",
                (uid("wa"), auth.active_tenant_id, body.get("branchId"), cust["id"], cust["phone"], body.get("templateName") or "approved_utility_template", personalized, "sent" if is_cfg else "simulated", 0 if is_cfg else 1),
            )
            sent += 1
        return {"ok": True, "sent": sent, "skippedOptOut": skipped, "mode": "live_meta" if is_cfg else "demo_simulated"}


# ================= AI BRAIN & OWNER ASSISTANT =================
@app.get("/api/ai/knowledge")
def list_knowledge(auth: AuthContext = Depends(get_auth)):
    with get_db() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM ai_knowledge WHERE tenant_id = ? ORDER BY category, updated_at DESC", (auth.active_tenant_id,)).fetchall())


@app.post("/api/ai/knowledge")
def upsert_knowledge(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    title = body.get("title")
    content = body.get("content")
    if not title or not content:
        raise HTTPException(status_code=400, detail="Title and content required")
    kid = body.get("id")
    with get_db() as conn:
        if kid:
            conn.execute("UPDATE ai_knowledge SET category = ?, title = ?, content = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?", (body.get("category") or "faq", title, content, kid, auth.active_tenant_id))
            return {"ok": True, "id": kid}
        new_id = uid("kb")
        conn.execute("INSERT INTO ai_knowledge (id, tenant_id, category, title, content) VALUES (?, ?, ?, ?, ?)", (new_id, auth.active_tenant_id, body.get("category") or "faq", title, content))
        return {"ok": True, "id": new_id}


@app.delete("/api/ai/knowledge/{kb_id}")
def delete_knowledge(kb_id: str, auth: AuthContext = Depends(require_roles(["super_admin", "owner", "branch_manager"]))):
    with get_db() as conn:
        conn.execute("DELETE FROM ai_knowledge WHERE id = ? AND tenant_id = ?", (kb_id, auth.active_tenant_id))
        return {"ok": True}


@app.post("/api/ai/customer-chat")
def ai_customer_chat(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    message = body.get("message")
    if not message:
        raise HTTPException(status_code=400, detail="Message required")
    with get_db() as conn:
        return run_customer_enquiry_ai(conn, auth.active_tenant_id, message, body.get("customerId"))


@app.post("/api/ai/owner-assistant")
def ai_owner_assistant(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(get_auth)):
    question = body.get("question")
    if not question:
        raise HTTPException(status_code=400, detail="Question required")
    with get_db() as conn:
        return run_owner_assistant_ai(conn, auth.active_tenant_id, question)


# ================= REPORTS & EXCEL EXPORT =================
@app.get("/api/reports/summary")
def reports_summary(
    branchId: Optional[str] = Query(default=None),
    dateFrom: Optional[str] = Query(default=None),
    dateTo: Optional[str] = Query(default=None),
    auth: AuthContext = Depends(get_auth),
):
    tenant_id = auth.active_tenant_id
    clauses = ["i.tenant_id = ?", "i.is_cancelled = 0", "i.doc_type = 'invoice'"]
    args: List[Any] = [tenant_id]
    if branchId and branchId != "all":
        clauses.append("i.branch_id = ?")
        args.append(branchId)
    if dateFrom:
        clauses.append("date(i.created_at) >= date(?)")
        args.append(dateFrom)
    if dateTo:
        clauses.append("date(i.created_at) <= date(?)")
        args.append(dateTo)
    where_inv = " AND ".join(clauses)

    with get_db() as conn:
        gstr1 = rows_to_dicts(
            conn.execute(
                f"SELECT i.invoice_no, date(i.created_at) as inv_date, b.name as branch_name, COALESCE(c.name, 'Walk-in') as customer_name, COALESCE(c.gstin, 'URP') as customer_gstin, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount FROM invoices i JOIN branches b ON b.id = i.branch_id LEFT JOIN customers c ON c.id = i.customer_id WHERE {where_inv} ORDER BY i.created_at DESC",
                args,
            ).fetchall()
        )
        prod_profit = rows_to_dicts(
            conn.execute(
                f"SELECT ii.sku, ii.product_name, SUM(ii.qty) as qty_sold, SUM(ii.taxable_value) as sales_val, SUM(ii.qty * ii.purchase_cost) as cogs_val, SUM(ii.taxable_value - (ii.qty * ii.purchase_cost)) as gross_profit FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE {where_inv} GROUP BY ii.product_id ORDER BY sales_val DESC",
                args,
            ).fetchall()
        )
        bf = "AND bs.branch_id = ?" if branchId and branchId != "all" else ""
        stk_args = [tenant_id, branchId] if bf else [tenant_id]
        stock_val = rows_to_dicts(
            conn.execute(
                f"SELECT b.name as branch_name, p.sku, p.name, p.category_name, bs.qty_available, bs.qty_damaged, bs.qty_dead, (bs.qty_available * p.purchase_price) as cost_valuation, (bs.qty_available * p.selling_price) as retail_valuation FROM branch_stock bs JOIN products p ON p.id = bs.product_id JOIN branches b ON b.id = bs.branch_id WHERE bs.tenant_id = ? AND p.is_deleted = 0 {bf} ORDER BY cost_valuation DESC",
                stk_args,
            ).fetchall()
        )
        return {"gstr1": gstr1, "productProfit": prod_profit, "stockValuation": stock_val}


@app.get("/api/reports/export/excel")
def export_excel(
    type: str = Query(default="stock_valuation"),
    branchId: Optional[str] = Query(default=None),
    dateFrom: Optional[str] = Query(default=None),
    dateTo: Optional[str] = Query(default=None),
    auth: AuthContext = Depends(get_auth),
):
    with get_db() as conn:
        content, filename = build_excel_report(conn, auth.active_tenant_id, type, branchId, dateFrom, dateTo)
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


# ================= SETTINGS, INTEGRATIONS & SECURITY BACKUP =================
@app.patch("/api/settings/tenant")
def update_tenant_settings(body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    tenant_id = auth.active_tenant_id
    with get_db() as conn:
        curr = conn.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
        if not curr:
            raise HTTPException(status_code=404, detail="Tenant not found")
        merged_branding = {**json.loads(str(curr["branding_json"] or "{}")), **(body.get("branding") or {})}
        merged_config = {**json.loads(str(curr["config_json"] or "{}")), **(body.get("config") or {})}
        conn.execute(
            """
            UPDATE tenants
            SET name = COALESCE(?, name), legal_name = COALESCE(?, legal_name), gstin = COALESCE(?, gstin),
                address = COALESCE(?, address), phone = COALESCE(?, phone), email = COALESCE(?, email),
                currency = COALESCE(?, currency), currency_symbol = COALESCE(?, currency_symbol),
                branding_json = ?, config_json = ?
            WHERE id = ?
            """,
            (
                body.get("name"), body.get("legalName"), body.get("gstin"), body.get("address"),
                body.get("phone"), body.get("email"), body.get("currency"), body.get("currencySymbol"),
                json.dumps(merged_branding), json.dumps(merged_config), tenant_id,
            ),
        )
        log_audit(conn, tenant_id, None, auth.session, "UPDATE_TENANT_SETTINGS", "tenant", tenant_id, {"name": body.get("name"), "currency": body.get("currency")}, auth.ip)
        return {"ok": True}


@app.get("/api/settings/integrations")
def list_integrations(auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM integration_configs WHERE tenant_id = ?", (auth.active_tenant_id,)).fetchall()
        return [
            {
                "id": r["id"],
                "provider": r["provider"],
                "status": r["status"],
                "last_tested_at": r["last_tested_at"],
                "updated_at": r["updated_at"],
                "config": mask_secrets(decrypt_json(r["config_encrypted_json"])),
            }
            for r in rows
        ]


@app.put("/api/settings/integrations/{provider}")
def save_integration(provider: str, body: Dict[str, Any] = Body(...), auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    incoming = body.get("config") or {}
    with get_db() as conn:
        existing_row = conn.execute("SELECT config_encrypted_json FROM integration_configs WHERE tenant_id = ? AND provider = ?", (auth.active_tenant_id, provider)).fetchone()
        existing_dec = decrypt_json(existing_row["config_encrypted_json"]) if existing_row else {}
        merged = merge_masked_config(existing_dec, incoming)
        has_values = any(isinstance(v, str) and v.strip() for v in merged.values())
        status = "configured" if has_values else "not_configured"
        conn.execute(
            """
            INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(tenant_id, provider) DO UPDATE SET config_encrypted_json = excluded.config_encrypted_json, status = excluded.status, updated_at = datetime('now')
            """,
            (uid("int"), auth.active_tenant_id, provider, encrypt_json(merged), status),
        )
        log_audit(conn, auth.active_tenant_id, None, auth.session, "UPDATE_INTEGRATION", "integration", provider, {"status": status}, auth.ip)
        return {"ok": True, "status": status, "config": mask_secrets(merged)}


@app.post("/api/settings/integrations/{provider}/test")
def test_integration(provider: str, auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    with get_db() as conn:
        row = conn.execute("SELECT config_encrypted_json, status FROM integration_configs WHERE tenant_id = ? AND provider = ?", (auth.active_tenant_id, provider)).fetchone()
        cfg = decrypt_json(row["config_encrypted_json"]) if row else {}
        ok = False
        message = "Integration is not configured."

        if provider == "database":
            ok = True
            message = "Transactional SQL database (WAL mode) active and healthy."
        elif provider == "ai_provider":
            key = os.environ.get("GEMINI_API_KEY", "").strip()
            if key and key != "MY_GEMINI_API_KEY":
                ok = True
                message = f"Gemini AI server adapter ready (Model: {cfg.get('model') or 'gemini-2.5-flash'})."
            else:
                message = "GEMINI_API_KEY is not injected in server environment; using grounded deterministic fallback."
        elif provider == "meta_whatsapp":
            if cfg.get("phoneNumberId") and cfg.get("accessToken"):
                ok = True
                message = f"Meta Cloud API credentials present for Phone ID {cfg['phoneNumberId']} ({cfg.get('apiVersion') or 'v21.0'})."
            else:
                message = "Missing Phone Number ID or Access Token. Demo simulator mode remains active."
        elif provider == "firebase":
            if cfg.get("projectId") and cfg.get("apiKey"):
                ok = True
                message = f"Firebase adapter configured for project {cfg['projectId']}."
            else:
                message = "Firebase Project ID and API Key not configured yet."

        conn.execute("UPDATE integration_configs SET last_tested_at = datetime('now') WHERE tenant_id = ? AND provider = ?", (auth.active_tenant_id, provider))
        return {"ok": ok, "message": message}


@app.delete("/api/settings/integrations/{provider}")
def reset_integration(provider: str, auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    with get_db() as conn:
        conn.execute(
            "UPDATE integration_configs SET config_encrypted_json = ?, status = 'not_configured', updated_at = datetime('now') WHERE tenant_id = ? AND provider = ?",
            (encrypt_json({}), auth.active_tenant_id, provider),
        )
        return {"ok": True}


@app.get("/api/security/audit-logs")
def list_audit_logs(auth: AuthContext = Depends(require_roles(["super_admin", "owner", "accountant"]))):
    with get_db() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100", (auth.active_tenant_id,)).fetchall())


@app.get("/api/security/backup")
def export_backup(auth: AuthContext = Depends(require_roles(["super_admin", "owner"]))):
    tid = auth.active_tenant_id
    with get_db() as conn:
        backup = {
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "tenantId": tid,
            "tenant": row_to_dict(conn.execute("SELECT * FROM tenants WHERE id = ?", (tid,)).fetchone()),
            "branches": rows_to_dicts(conn.execute("SELECT * FROM branches WHERE tenant_id = ?", (tid,)).fetchall()),
            "products": rows_to_dicts(conn.execute("SELECT * FROM products WHERE tenant_id = ?", (tid,)).fetchall()),
            "branch_stock": rows_to_dicts(conn.execute("SELECT * FROM branch_stock WHERE tenant_id = ?", (tid,)).fetchall()),
            "customers": rows_to_dicts(conn.execute("SELECT * FROM customers WHERE tenant_id = ?", (tid,)).fetchall()),
            "suppliers": rows_to_dicts(conn.execute("SELECT * FROM suppliers WHERE tenant_id = ?", (tid,)).fetchall()),
            "invoices": rows_to_dicts(conn.execute("SELECT * FROM invoices WHERE tenant_id = ?", (tid,)).fetchall()),
            "expenses": rows_to_dicts(conn.execute("SELECT * FROM expenses WHERE tenant_id = ?", (tid,)).fetchall()),
            "ai_knowledge": rows_to_dicts(conn.execute("SELECT * FROM ai_knowledge WHERE tenant_id = ?", (tid,)).fetchall()),
        }
        body_bytes = json.dumps(backup, indent=2).encode("utf-8")
        log_audit(conn, tid, None, auth.session, "EXPORT_BACKUP", "tenant", tid, {"size": len(body_bytes)}, auth.ip)
        fname = f"titangrid_backup_{tid}_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.json"
        return Response(
            content=body_bytes,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )


# ================= PRESERVED V1 MICROSERVICE ENDPOINTS =================
class FaceVerifyRequest(BaseModel):
    tenant_id: str
    user_id: str
    stored_embedding: List[float]
    probe_embedding: List[float]
    motion_delta: float
    luminance_variance: float


class StockValuationRow(BaseModel):
    branch: str
    sku: str
    name: str
    qty: float
    cost: float
    selling_price: float


@app.post("/api/v1/face/verify")
def verify_face_liveness(payload: FaceVerifyRequest):
    if payload.motion_delta < 0.015 and payload.luminance_variance < 1.5:
        raise HTTPException(status_code=403, detail="Liveness verification failed: spoof or static photo detected.")
    score = cosine_similarity(payload.stored_embedding, payload.probe_embedding)
    if score < 0.72:
        raise HTTPException(status_code=403, detail=f"Face match confidence {score:.2f} below threshold 0.72")
    return {"verified": True, "confidence": round(score, 4), "liveness_passed": True}


@app.post("/api/v1/exports/openpyxl/stock")
def export_stock_openpyxl(rows: List[StockValuationRow], x_tenant_id: Optional[str] = Header(default=None)):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Stock Valuation"
    ws.append(["Tenant", x_tenant_id or "default", "Generated", datetime.now(timezone.utc).isoformat()])
    ws.append(["Branch", "SKU", "Product", "Available Qty", "Purchase Cost", "Selling Price", "Cost Valuation"])
    for r in rows:
        ws.append([r.branch, r.sku, r.name, r.qty, r.cost, r.selling_price, r.qty * r.cost])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=stock_valuation_openpyxl.xlsx"},
    )
