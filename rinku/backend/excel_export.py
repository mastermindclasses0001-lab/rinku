import io
import sqlite3
from datetime import datetime, timezone
from typing import Optional, Tuple

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill


def _style_header(ws, row_idx: int):
    fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    font = Font(bold=True, color="FFFFFF", size=11)
    align = Alignment(vertical="center", horizontal="left")
    ws.row_dimensions[row_idx].height = 24
    for cell in ws[row_idx]:
        cell.fill = fill
        cell.font = font
        cell.alignment = align


def build_excel_report(
    conn: sqlite3.Connection,
    tenant_id: str,
    report_type: str,
    branch_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Tuple[bytes, str]:
    tenant = conn.execute("SELECT name, gstin, currency_symbol FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
    t_name = tenant["name"] if tenant else "TitanGrid ERP"
    t_gstin = tenant["gstin"] if tenant and tenant["gstin"] else "N/A"

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = report_type.upper()[:30]

    ws.append([f"{t_name} — {report_type.replace('_', ' ').upper()}"])
    ws.append([f"GSTIN: {t_gstin} | Generated: {datetime.now(timezone.utc).isoformat()} | Branch Filter: {branch_id or 'ALL BRANCHES'}"])
    ws.append([])

    def date_cond(col: str):
        clauses, args = [], []
        if start_date:
            clauses.append(f"date({col}) >= date(?)")
            args.append(start_date)
        if end_date:
            clauses.append(f"date({col}) <= date(?)")
            args.append(end_date)
        return (" AND " + " AND ".join(clauses)) if clauses else "", args

    if report_type in ("stock_valuation", "combined_branches"):
        ws.append(["Branch", "SKU", "Category", "Product Name", "Unit", "Available Qty", "Damaged", "Dead", "Purchase Cost", "Selling Price", "Stock Value (Cost)", "Retail Value"])
        _style_header(ws, ws.max_row)
        bf = " AND bs.branch_id = ?" if branch_id and branch_id != "all" else ""
        args = [tenant_id] + ([branch_id] if bf else [])
        rows = conn.execute(
            f"""
            SELECT b.name as branch_name, p.sku, p.category_name, p.name, p.unit, bs.qty_available, bs.qty_damaged, bs.qty_dead,
                   p.purchase_price, p.selling_price,
                   (bs.qty_available * p.purchase_price) as cost_val,
                   (bs.qty_available * p.selling_price) as retail_val
            FROM branch_stock bs
            JOIN products p ON p.id = bs.product_id
            JOIN branches b ON b.id = bs.branch_id
            WHERE bs.tenant_id = ? AND p.is_deleted = 0 {bf}
            ORDER BY b.name, p.category_name, p.name
            """,
            args,
        ).fetchall()
        for r in rows:
            ws.append([r["branch_name"], r["sku"], r["category_name"], r["name"], r["unit"], r["qty_available"], r["qty_damaged"], r["qty_dead"], r["purchase_price"], r["selling_price"], r["cost_val"], r["retail_val"]])

    elif report_type == "gst_gstr1":
        ws.append(["Invoice No", "Date", "Branch", "Customer Name", "Customer GSTIN", "Taxable Value", "CGST", "SGST", "IGST", "Total Invoice", "Status"])
        _style_header(ws, ws.max_row)
        dsql, dargs = date_cond("i.created_at")
        bf = " AND i.branch_id = ?" if branch_id and branch_id != "all" else ""
        args = [tenant_id] + dargs + ([branch_id] if bf else [])
        rows = conn.execute(
            f"""
            SELECT i.invoice_no, date(i.created_at) as inv_date, b.name as branch_name,
                   COALESCE(c.name, 'Walk-in') as cust_name, COALESCE(c.gstin, 'URP') as cust_gstin,
                   i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount, i.payment_status
            FROM invoices i
            JOIN branches b ON b.id = i.branch_id
            LEFT JOIN customers c ON c.id = i.customer_id
            WHERE i.tenant_id = ? AND i.is_cancelled = 0 AND i.doc_type = 'invoice' {dsql} {bf}
            ORDER BY i.created_at DESC
            """,
            args,
        ).fetchall()
        for r in rows:
            ws.append([r["invoice_no"], r["inv_date"], r["branch_name"], r["cust_name"], r["cust_gstin"], r["taxable_amount"], r["cgst_amount"], r["sgst_amount"], r["igst_amount"], r["total_amount"], r["payment_status"]])

    elif report_type == "product_sales_profit":
        ws.append(["SKU", "Product Name", "Category", "Qty Sold", "Taxable Sales", "COGS (Purchase Cost)", "Gross Profit", "Margin %"])
        _style_header(ws, ws.max_row)
        dsql, dargs = date_cond("i.created_at")
        bf = " AND i.branch_id = ?" if branch_id and branch_id != "all" else ""
        args = [tenant_id] + dargs + ([branch_id] if bf else [])
        rows = conn.execute(
            f"""
            SELECT ii.sku, ii.product_name, p.category_name,
                   SUM(ii.qty) as qty_sold,
                   SUM(ii.taxable_value) as sales_val,
                   SUM(ii.qty * ii.purchase_cost) as cogs_val
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
            JOIN products p ON p.id = ii.product_id
            WHERE i.tenant_id = ? AND i.is_cancelled = 0 AND i.doc_type = 'invoice' {dsql} {bf}
            GROUP BY ii.product_id
            ORDER BY sales_val DESC
            """,
            args,
        ).fetchall()
        for r in rows:
            sales = float(r["sales_val"] or 0)
            cogs = float(r["cogs_val"] or 0)
            gp = sales - cogs
            margin = round((gp / sales) * 100, 2) if sales > 0 else 0
            ws.append([r["sku"], r["product_name"], r["category_name"], r["qty_sold"], sales, cogs, gp, margin])

    elif report_type in ("customer_outstanding", "customer_sales_profit"):
        ws.append(["Customer Name", "Segment", "Phone", "GSTIN", "Credit Limit", "Total Billed", "Outstanding Due", "Due Date", "WhatsApp Opt-In"])
        _style_header(ws, ws.max_row)
        rows = conn.execute(
            """
            SELECT c.name, c.segment, c.phone, COALESCE(c.gstin, '-') as gstin, c.credit_limit,
                   COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.total_amount ELSE 0 END), 0) as total_billed,
                   c.outstanding_balance, c.due_date, CASE WHEN c.whatsapp_opt_in = 1 THEN 'Opt-In' ELSE 'Opt-Out' END as wa
            FROM customers c
            LEFT JOIN invoices i ON i.customer_id = c.id
            WHERE c.tenant_id = ? AND c.is_deleted = 0
            GROUP BY c.id
            ORDER BY c.outstanding_balance DESC
            """,
            (tenant_id,),
        ).fetchall()
        for r in rows:
            ws.append([r["name"], r["segment"], r["phone"], r["gstin"], r["credit_limit"], r["total_billed"], r["outstanding_balance"], r["due_date"] or "-", r["wa"]])

    elif report_type in ("staff_attendance", "monthly_salary"):
        ws.append(["Employee", "Role", "Branch", "Base Salary", "Present Days", "Late Days", "Overtime (Mins)", "Adjustments/Advances", "Estimated Net Payable"])
        _style_header(ws, ws.max_row)
        users = conn.execute(
            """
            SELECT u.id, u.full_name, u.role, COALESCE(b.name, 'HQ') as branch_name, u.salary_monthly
            FROM users u
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE u.tenant_id = ? AND u.role != 'super_admin'
            """,
            (tenant_id,),
        ).fetchall()
        for u in users:
            att = conn.execute(
                """
                SELECT COUNT(*) as days,
                       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
                       COALESCE(SUM(overtime_mins), 0) as ot_mins
                FROM attendance_logs WHERE tenant_id = ? AND user_id = ?
                """,
                (tenant_id, u["id"]),
            ).fetchone()
            adj = conn.execute(
                """
                SELECT COALESCE(SUM(CASE WHEN type IN ('advance','loan','deduction') THEN -amount ELSE amount END), 0) as net_adj
                FROM salary_adjustments WHERE tenant_id = ? AND user_id = ?
                """,
                (tenant_id, u["id"]),
            ).fetchone()
            sal = float(u["salary_monthly"] or 0)
            ot_mins = float(att["ot_mins"] or 0)
            ot_pay = round((sal / 208.0) * (ot_mins / 60.0) * 1.5)
            net_pay = max(0.0, sal + ot_pay + float(adj["net_adj"] or 0))
            ws.append([u["full_name"], u["role"], u["branch_name"], sal, att["days"], att["late_days"] or 0, ot_mins, adj["net_adj"], net_pay])

    elif report_type == "salesman_performance":
        ws.append(["Salesman", "Branch", "Monthly Target", "Achieved Sales", "Achievement %", "Commission Rate %", "Commission Earned"])
        _style_header(ws, ws.max_row)
        rows = conn.execute(
            """
            SELECT u.full_name, COALESCE(b.name, 'HQ') as branch_name, u.monthly_target, u.commission_rate,
                   COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.taxable_amount ELSE 0 END), 0) as achieved
            FROM users u
            LEFT JOIN branches b ON b.id = u.branch_id
            LEFT JOIN invoices i ON i.salesman_id = u.id
            WHERE u.tenant_id = ? AND u.role IN ('salesman', 'branch_manager', 'cashier', 'accountant')
            GROUP BY u.id
            """,
            (tenant_id,),
        ).fetchall()
        for r in rows:
            target = float(r["monthly_target"] or 0)
            achieved = float(r["achieved"] or 0)
            pct = round((achieved / target) * 100, 1) if target > 0 else 0
            comm = round((achieved * float(r["commission_rate"] or 0)) / 100)
            ws.append([r["full_name"], r["branch_name"], target, achieved, pct, r["commission_rate"], comm])

    elif report_type in ("daily_sales_expenses", "cash_upi_collection"):
        ws.append(["Type", "Date", "Branch", "Reference", "Party / Category", "Mode", "Amount"])
        _style_header(ws, ws.max_row)
        for r in conn.execute(
            """
            SELECT 'Collection' as rtype, date(p.created_at) as dt, b.name as branch_name, p.reference_no, p.party_type, p.mode, p.amount
            FROM payments p JOIN branches b ON b.id = p.branch_id
            WHERE p.tenant_id = ?
            ORDER BY p.created_at DESC
            """,
            (tenant_id,),
        ).fetchall():
            ws.append([r["rtype"], r["dt"], r["branch_name"], r["reference_no"] or "-", r["party_type"], r["mode"], r["amount"]])
        for r in conn.execute(
            """
            SELECT 'Expense' as rtype, e.expense_date as dt, b.name as branch_name, e.vendor_name, e.category, e.payment_mode, -e.amount as amount
            FROM expenses e JOIN branches b ON b.id = e.branch_id
            WHERE e.tenant_id = ? AND e.is_deleted = 0
            ORDER BY e.expense_date DESC
            """,
            (tenant_id,),
        ).fetchall():
            ws.append([r["rtype"], r["dt"], r["branch_name"], r["vendor_name"] or "-", r["category"], r["payment_mode"], r["amount"]])

    else:
        ws.append(["Date", "Branch", "Type", "Reference", "Details", "Quantity / Amount"])
        _style_header(ws, ws.max_row)
        for r in conn.execute(
            """
            SELECT sm.created_at, b.name as branch_name, sm.movement_type, sm.reference_id, p.name as prod_name, sm.qty_delta
            FROM stock_movements sm
            JOIN branches b ON b.id = sm.branch_id
            JOIN products p ON p.id = sm.product_id
            WHERE sm.tenant_id = ?
            ORDER BY sm.created_at DESC
            LIMIT 200
            """,
            (tenant_id,),
        ).fetchall():
            ws.append([r["created_at"], r["branch_name"], r["movement_type"], r["reference_id"] or "-", r["prod_name"], r["qty_delta"]])

    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"{report_type}_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.xlsx"
    return buf.getvalue(), filename
