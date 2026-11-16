import json
import os
import sqlite3
import urllib.request
from typing import Any, Dict, Optional

from security import decrypt_json


def _call_gemini_rest(api_key: str, model: str, prompt: str, system_instruction: str) -> Optional[str]:
    clean_model = model.replace("models/", "") if model else "gemini-2.5-flash"
    # Map logical aliases cleanly to supported REST endpoints, retrying flash if alias unavailable
    candidates = [clean_model, "gemini-2.5-flash"] if clean_model != "gemini-2.5-flash" else ["gemini-2.5-flash"]
    for m in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
        payload = {
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "contents": [{"parts": [{"text": prompt}]}],
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "aistudio-build"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                text = "".join(p.get("text", "") for p in parts).strip()
                if text:
                    return text
        except Exception:
            continue
    return None


def _get_ai_config(conn: sqlite3.Connection, tenant_id: str) -> Dict[str, str]:
    row = conn.execute(
        "SELECT config_encrypted_json FROM integration_configs WHERE tenant_id = ? AND provider = 'ai_provider'",
        (tenant_id,),
    ).fetchone()
    cfg = decrypt_json(row["config_encrypted_json"]) if row else {}
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key == "MY_GEMINI_API_KEY":
        api_key = ""
    return {
        "apiKey": api_key,
        "model": str(cfg.get("model") or "gemini-2.5-flash"),
        "systemInstruction": str(cfg.get("systemInstruction") or ""),
    }


def run_customer_enquiry_ai(
    conn: sqlite3.Connection,
    tenant_id: str,
    message: str,
    verified_customer_id: Optional[str] = None,
) -> Dict[str, Any]:
    tenant = dict(conn.execute("SELECT name, currency_symbol, address, phone FROM tenants WHERE id = ?", (tenant_id,)).fetchone())
    branches = [dict(r) for r in conn.execute("SELECT id, name, city, phone FROM branches WHERE tenant_id = ? AND status = 'active'", (tenant_id,)).fetchall()]
    knowledge = [dict(r) for r in conn.execute("SELECT category, title, content FROM ai_knowledge WHERE tenant_id = ?", (tenant_id,)).fetchall()]
    products = [
        dict(r)
        for r in conn.execute(
            """
            SELECT p.sku, p.name, p.category_name, p.brand, p.unit, p.base_unit, p.conversion_factor, p.box_coverage_sqft,
                   p.shade, p.batch_no, p.selling_price, p.mrp, p.gst_rate,
                   COALESCE(SUM(bs.qty_available), 0) as total_stock
            FROM products p
            LEFT JOIN branch_stock bs ON bs.product_id = p.id
            WHERE p.tenant_id = ? AND p.is_deleted = 0 AND p.is_active = 1
            GROUP BY p.id
            LIMIT 40
            """,
            (tenant_id,),
        ).fetchall()
    ]

    customer_context = "Customer identity not verified for account balance lookup."
    if verified_customer_id:
        cust = conn.execute(
            "SELECT name, segment, outstanding_balance, credit_limit, due_date FROM customers WHERE id = ? AND tenant_id = ?",
            (verified_customer_id, tenant_id),
        ).fetchone()
        if cust:
            customer_context = (
                f"Verified Customer: {cust['name']} ({cust['segment']}). "
                f"Outstanding Balance: {tenant['currency_symbol']}{cust['outstanding_balance']}, "
                f"Due Date: {cust['due_date'] or 'None'}."
            )

    lower = message.lower()
    needs_escalation = any(w in lower for w in ("complaint", "broken", "legal", "refund", "manager", "angry"))
    cfg = _get_ai_config(conn, tenant_id)

    if cfg["apiKey"]:
        prompt = f"""
Business: {tenant['name']} ({tenant['address']}, Phone: {tenant['phone']}, Currency: {tenant['currency_symbol']})
Branches: {json.dumps(branches)}
Verified Knowledge Base: {json.dumps(knowledge)}
Live Inventory & Pricing: {json.dumps(products)}
Customer Context: {customer_context}

Customer WhatsApp Message: "{message}"

Rules:
1. NEVER invent stock quantities, prices, discounts, or policies not present in the Live Inventory or Knowledge Base above.
2. Quote exact prices with GST rate and box coverage/unit conversion when recommending tiles or paint.
3. If the customer asks for dues/orders and identity is NOT verified, politely ask for verification instead of revealing private data.
4. If the query is a serious complaint, dispute, or custom bulk negotiation beyond policy, clearly state you are escalating to human staff and include [ESCALATE] at the end.
5. Keep reply concise, warm, and WhatsApp-friendly.
"""
        sys_inst = cfg["systemInstruction"] or f"You are the official customer WhatsApp sales & support specialist for {tenant['name']}. Be accurate, concise, and strictly grounded in database records."
        text = _call_gemini_rest(cfg["apiKey"], cfg["model"], prompt, sys_inst)
        if text:
            escalated = ("[ESCALATE]" in text) or needs_escalation
            return {
                "reply": text.replace("[ESCALATE]", "").strip(),
                "escalated": escalated,
                "source": "gemini",
            }

    if needs_escalation:
        return {
            "reply": f"I have logged your concern for priority review and am transferring this conversation to our branch specialist at {tenant['name']} ({tenant['phone']}).",
            "escalated": True,
            "source": "deterministic_fallback",
        }

    matched = [
        p
        for p in products
        if lower in str(p["name"]).lower()
        or lower in str(p["category_name"]).lower()
        or lower in str(p["sku"]).lower()
        or ("tile" in lower and str(p["category_name"]).lower() == "tiles")
        or ("paint" in lower and str(p["category_name"]).lower() == "paint")
        or ("faucet" in lower and str(p["category_name"]).lower() == "sanitaryware")
        or ("lock" in lower and str(p["category_name"]).lower() == "hardware")
    ]
    if matched:
        lines = [
            f"• {p['name']} (SKU: {p['sku']}) — {tenant['currency_symbol']}{p['selling_price']}/{p['unit']} + {p['gst_rate']}% GST · In stock: {p['total_stock']} {p['unit']}s"
            for p in matched[:3]
        ]
        tail = customer_context if verified_customer_id else "Reply with your registered phone number to check invoice dues."
        return {
            "reply": f"Here are verified in-stock items from {tenant['name']}:\n" + "\n".join(lines) + f"\n\n{tail}",
            "escalated": False,
            "source": "deterministic_fallback",
        }

    return {
        "reply": f"Welcome to {tenant['name']}. We carry Tiles, Paint, Sanitaryware & Hardware across {len(branches)} branches. Ask about any SKU, tile box coverage, paint shades, or delivery policy!",
        "escalated": False,
        "source": "deterministic_fallback",
    }


def run_owner_assistant_ai(conn: sqlite3.Connection, tenant_id: str, question: str) -> Dict[str, Any]:
    tenant = dict(conn.execute("SELECT name, currency_symbol FROM tenants WHERE id = ?", (tenant_id,)).fetchone())
    sales_summary = [
        dict(r)
        for r in conn.execute(
            """
            SELECT b.name as branch_name,
                   COUNT(i.id) as invoice_count,
                   COALESCE(SUM(i.total_amount), 0) as total_sales,
                   COALESCE(SUM(i.due_amount), 0) as total_due
            FROM branches b
            LEFT JOIN invoices i ON i.branch_id = b.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'
            WHERE b.tenant_id = ?
            GROUP BY b.id
            """,
            (tenant_id,),
        ).fetchall()
    ]
    low_stock = [
        dict(r)
        for r in conn.execute(
            """
            SELECT p.name, p.sku, b.name as branch_name, bs.qty_available, p.min_stock
            FROM branch_stock bs
            JOIN products p ON p.id = bs.product_id
            JOIN branches b ON b.id = bs.branch_id
            WHERE bs.tenant_id = ? AND p.is_deleted = 0 AND bs.qty_available <= p.min_stock
            LIMIT 15
            """,
            (tenant_id,),
        ).fetchall()
    ]
    overdue = [
        dict(r)
        for r in conn.execute(
            """
            SELECT name, phone, segment, outstanding_balance, due_date
            FROM customers
            WHERE tenant_id = ? AND is_deleted = 0 AND outstanding_balance > 0
            ORDER BY outstanding_balance DESC
            LIMIT 10
            """,
            (tenant_id,),
        ).fetchall()
    ]
    exp_row = conn.execute("SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE tenant_id = ? AND is_deleted = 0", (tenant_id,)).fetchone()
    total_expenses = float(exp_row["total_expenses"] or 0)

    lower = question.lower()
    destructive = any(w in lower for w in ("delete", "cancel", "write off", "transfer", "pay"))
    cfg = _get_ai_config(conn, tenant_id)

    if cfg["apiKey"]:
        prompt = f"""
Owner Question: "{question}"
Tenant: {tenant['name']} (Currency: {tenant['currency_symbol']})
Branch Sales Summary: {json.dumps(sales_summary)}
Low Stock Alerts: {json.dumps(low_stock)}
Overdue Customer Receivables: {json.dumps(overdue)}
Total Expenses: {total_expenses}

Provide a sharp, executive, numbers-first answer strictly from this live data. If the owner asks to execute a financial or destructive change (cancel invoice, write-off debt, transfer funds), explain the exact impact and require explicit UI confirmation before execution.
"""
        text = _call_gemini_rest(
            cfg["apiKey"],
            cfg["model"],
            prompt,
            "You are an executive CFO & Retail Operations AI Assistant. Be concise, quantitative, and strictly factual.",
        )
        if text:
            return {
                "answer": text,
                "requiresConfirmation": destructive,
                "source": "gemini",
            }

    total_sales = sum(float(r["total_sales"] or 0) for r in sales_summary)
    total_due = sum(float(r["total_due"] or 0) for r in sales_summary)
    sym = tenant["currency_symbol"]
    top_overdue = overdue[0]["name"] if overdue else "None"
    return {
        "answer": f"{tenant['name']} Live Snapshot ({sym}): Total Sales {sym}{total_sales:,.0f} · Receivable Dues {sym}{total_due:,.0f} · Recorded Expenses {sym}{total_expenses:,.0f} · {len(low_stock)} low-stock branch alerts. Top overdue: {top_overdue}.",
        "requiresConfirmation": destructive,
        "source": "deterministic_fallback",
    }
