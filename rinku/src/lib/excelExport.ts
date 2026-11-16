import ExcelJS from 'exceljs';
import { db } from '../db/database.ts';

export type ReportType =
  | 'stock_valuation'
  | 'product_sales_profit'
  | 'purchase_orders'
  | 'customer_sales_profit'
  | 'customer_outstanding'
  | 'staff_attendance'
  | 'monthly_salary'
  | 'salesman_performance'
  | 'cash_upi_collection'
  | 'daily_sales_expenses'
  | 'supplier_ledger'
  | 'gst_gstr1'
  | 'stock_movements'
  | 'returns_damaged'
  | 'combined_branches';

export async function buildExcelReport(params: {
  tenantId: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
  reportType: ReportType;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { tenantId, branchId, startDate, endDate, reportType } = params;
  const tenant = db.prepare(`SELECT name, gstin, currency_symbol FROM tenants WHERE id = ?`).get(tenantId) as {
    name: string;
    gstin: string;
    currency_symbol: string;
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TitanGrid Retail ERP';
  wb.created = new Date();

  const sheet = wb.addWorksheet(reportType.toUpperCase().slice(0, 30));

  const styleHeader = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    row.alignment = { vertical: 'middle', horizontal: 'left' };
    row.height = 24;
  };

  sheet.addRow([`${tenant.name} — ${reportType.replace(/_/g, ' ').toUpperCase()}`]);
  sheet.addRow([`GSTIN: ${tenant.gstin || 'N/A'} | Generated: ${new Date().toISOString()} | Branch Filter: ${branchId || 'ALL BRANCHES'}`]);
  sheet.addRow([]);

  const dateCond = (col: string) => {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (startDate) {
      clauses.push(`date(${col}) >= date(?)`);
      args.push(startDate);
    }
    if (endDate) {
      clauses.push(`date(${col}) <= date(?)`);
      args.push(endDate);
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', args };
  };

  if (reportType === 'stock_valuation' || reportType === 'combined_branches') {
    const hdr = sheet.addRow(['Branch', 'SKU', 'Category', 'Product Name', 'Unit', 'Available Qty', 'Damaged', 'Dead', 'Purchase Cost', 'Selling Price', 'Stock Value (Cost)', 'Retail Value']);
    styleHeader(hdr);
    const branchFilter = branchId && branchId !== 'all' ? ' AND bs.branch_id = ?' : '';
    const args: unknown[] = [tenantId];
    if (branchId && branchId !== 'all') args.push(branchId);

    const rows = db.prepare(`
      SELECT b.name as branch_name, p.sku, p.category_name, p.name, p.unit, bs.qty_available, bs.qty_damaged, bs.qty_dead,
             p.purchase_price, p.selling_price,
             (bs.qty_available * p.purchase_price) as cost_val,
             (bs.qty_available * p.selling_price) as retail_val
      FROM branch_stock bs
      JOIN products p ON p.id = bs.product_id
      JOIN branches b ON b.id = bs.branch_id
      WHERE bs.tenant_id = ? AND p.is_deleted = 0 ${branchFilter}
      ORDER BY b.name, p.category_name, p.name
    `).all(...args) as Array<Record<string, unknown>>;

    for (const r of rows) {
      sheet.addRow([r.branch_name, r.sku, r.category_name, r.name, r.unit, r.qty_available, r.qty_damaged, r.qty_dead, r.purchase_price, r.selling_price, r.cost_val, r.retail_val]);
    }
  } else if (reportType === 'gst_gstr1') {
    const hdr = sheet.addRow(['Invoice No', 'Date', 'Branch', 'Customer Name', 'Customer GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Invoice', 'Status']);
    styleHeader(hdr);
    const d = dateCond('i.created_at');
    const branchFilter = branchId && branchId !== 'all' ? ' AND i.branch_id = ?' : '';
    const args: unknown[] = [tenantId, ...d.args];
    if (branchId && branchId !== 'all') args.push(branchId);

    const rows = db.prepare(`
      SELECT i.invoice_no, date(i.created_at) as inv_date, b.name as branch_name,
             COALESCE(c.name, 'Walk-in') as cust_name, COALESCE(c.gstin, 'URP') as cust_gstin,
             i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount, i.payment_status
      FROM invoices i
      JOIN branches b ON b.id = i.branch_id
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ? AND i.is_cancelled = 0 AND i.doc_type = 'invoice' ${d.sql} ${branchFilter}
      ORDER BY i.created_at DESC
    `).all(...args) as Array<Record<string, unknown>>;

    for (const r of rows) {
      sheet.addRow([r.invoice_no, r.inv_date, r.branch_name, r.cust_name, r.cust_gstin, r.taxable_amount, r.cgst_amount, r.sgst_amount, r.igst_amount, r.total_amount, r.payment_status]);
    }
  } else if (reportType === 'product_sales_profit') {
    const hdr = sheet.addRow(['SKU', 'Product Name', 'Category', 'Qty Sold', 'Taxable Sales', 'COGS (Purchase Cost)', 'Gross Profit', 'Margin %']);
    styleHeader(hdr);
    const d = dateCond('i.created_at');
    const branchFilter = branchId && branchId !== 'all' ? ' AND i.branch_id = ?' : '';
    const args: unknown[] = [tenantId, ...d.args];
    if (branchId && branchId !== 'all') args.push(branchId);

    const rows = db.prepare(`
      SELECT ii.sku, ii.product_name, p.category_name,
             SUM(ii.qty) as qty_sold,
             SUM(ii.taxable_value) as sales_val,
             SUM(ii.qty * ii.purchase_cost) as cogs_val
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      JOIN products p ON p.id = ii.product_id
      WHERE i.tenant_id = ? AND i.is_cancelled = 0 AND i.doc_type = 'invoice' ${d.sql} ${branchFilter}
      GROUP BY ii.product_id
      ORDER BY sales_val DESC
    `).all(...args) as Array<Record<string, number | string>>;

    for (const r of rows) {
      const sales = Number(r.sales_val || 0);
      const cogs = Number(r.cogs_val || 0);
      const gp = sales - cogs;
      const margin = sales > 0 ? Number(((gp / sales) * 100).toFixed(2)) : 0;
      sheet.addRow([r.sku, r.product_name, r.category_name, r.qty_sold, sales, cogs, gp, margin]);
    }
  } else if (reportType === 'customer_outstanding' || reportType === 'customer_sales_profit') {
    const hdr = sheet.addRow(['Customer Name', 'Segment', 'Phone', 'GSTIN', 'Credit Limit', 'Total Billed', 'Outstanding Due', 'Due Date', 'WhatsApp Opt-In']);
    styleHeader(hdr);
    const rows = db.prepare(`
      SELECT c.name, c.segment, c.phone, COALESCE(c.gstin, '-') as gstin, c.credit_limit,
             COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.total_amount ELSE 0 END), 0) as total_billed,
             c.outstanding_balance, c.due_date, CASE WHEN c.whatsapp_opt_in = 1 THEN 'Opt-In' ELSE 'Opt-Out' END as wa
      FROM customers c
      LEFT JOIN invoices i ON i.customer_id = c.id
      WHERE c.tenant_id = ? AND c.is_deleted = 0
      GROUP BY c.id
      ORDER BY c.outstanding_balance DESC
    `).all(tenantId) as Array<Record<string, unknown>>;
    for (const r of rows) {
      sheet.addRow([r.name, r.segment, r.phone, r.gstin, r.credit_limit, r.total_billed, r.outstanding_balance, r.due_date || '-', r.wa]);
    }
  } else if (reportType === 'staff_attendance' || reportType === 'monthly_salary') {
    const hdr = sheet.addRow(['Employee', 'Role', 'Branch', 'Base Salary', 'Present Days', 'Late Days', 'Overtime (Mins)', 'Adjustments/Advances', 'Estimated Net Payable']);
    styleHeader(hdr);
    const users = db.prepare(`
      SELECT u.id, u.full_name, u.role, COALESCE(b.name, 'HQ') as branch_name, u.salary_monthly
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.tenant_id = ? AND u.role != 'super_admin'
    `).all(tenantId) as Array<{ id: string; full_name: string; role: string; branch_name: string; salary_monthly: number }>;

    for (const u of users) {
      const att = db.prepare(`
        SELECT COUNT(*) as days,
               SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
               COALESCE(SUM(overtime_mins), 0) as ot_mins
        FROM attendance_logs WHERE tenant_id = ? AND user_id = ?
      `).get(tenantId, u.id) as { days: number; late_days: number; ot_mins: number };
      const adj = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN type IN ('advance','loan','deduction') THEN -amount ELSE amount END), 0) as net_adj
        FROM salary_adjustments WHERE tenant_id = ? AND user_id = ?
      `).get(tenantId, u.id) as { net_adj: number };
      const otPay = Math.round((u.salary_monthly / 208) * (att.ot_mins / 60) * 1.5);
      const netPay = Math.max(0, u.salary_monthly + otPay + adj.net_adj);
      sheet.addRow([u.full_name, u.role, u.branch_name, u.salary_monthly, att.days, att.late_days || 0, att.ot_mins, adj.net_adj, netPay]);
    }
  } else if (reportType === 'salesman_performance') {
    const hdr = sheet.addRow(['Salesman', 'Branch', 'Monthly Target', 'Achieved Sales', 'Achievement %', 'Commission Rate %', 'Commission Earned']);
    styleHeader(hdr);
    const rows = db.prepare(`
      SELECT u.full_name, COALESCE(b.name, 'HQ') as branch_name, u.monthly_target, u.commission_rate,
             COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.taxable_amount ELSE 0 END), 0) as achieved
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN invoices i ON i.salesman_id = u.id
      WHERE u.tenant_id = ? AND u.role IN ('salesman', 'branch_manager', 'cashier', 'accountant')
      GROUP BY u.id
    `).all(tenantId) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const target = Number(r.monthly_target || 0);
      const achieved = Number(r.achieved || 0);
      const pct = target > 0 ? Number(((achieved / target) * 100).toFixed(1)) : 0;
      const comm = Math.round((achieved * Number(r.commission_rate || 0)) / 100);
      sheet.addRow([r.full_name, r.branch_name, target, achieved, pct, r.commission_rate, comm]);
    }
  } else if (reportType === 'daily_sales_expenses' || reportType === 'cash_upi_collection') {
    const hdr = sheet.addRow(['Type', 'Date', 'Branch', 'Reference', 'Party / Category', 'Mode', 'Amount']);
    styleHeader(hdr);
    const payRows = db.prepare(`
      SELECT 'Collection' as rtype, date(p.created_at) as dt, b.name as branch_name, p.reference_no, p.party_type, p.mode, p.amount
      FROM payments p JOIN branches b ON b.id = p.branch_id
      WHERE p.tenant_id = ?
      ORDER BY p.created_at DESC
    `).all(tenantId) as Array<Record<string, unknown>>;
    for (const r of payRows) {
      sheet.addRow([r.rtype, r.dt, r.branch_name, r.reference_no || '-', r.party_type, r.mode, r.amount]);
    }
    const expRows = db.prepare(`
      SELECT 'Expense' as rtype, e.expense_date as dt, b.name as branch_name, e.vendor_name, e.category, e.payment_mode, -e.amount as amount
      FROM expenses e JOIN branches b ON b.id = e.branch_id
      WHERE e.tenant_id = ? AND e.is_deleted = 0
      ORDER BY e.expense_date DESC
    `).all(tenantId) as Array<Record<string, unknown>>;
    for (const r of expRows) {
      sheet.addRow([r.rtype, r.dt, r.branch_name, r.vendor_name || '-', r.category, r.payment_mode, r.amount]);
    }
  } else {
    // Generic fallback for purchase_orders, supplier_ledger, stock_movements, returns_damaged
    const hdr = sheet.addRow(['Date', 'Branch', 'Type', 'Reference', 'Details', 'Quantity / Amount']);
    styleHeader(hdr);
    const rows = db.prepare(`
      SELECT sm.created_at, b.name as branch_name, sm.movement_type, sm.reference_id, p.name as prod_name, sm.qty_delta
      FROM stock_movements sm
      JOIN branches b ON b.id = sm.branch_id
      JOIN products p ON p.id = sm.product_id
      WHERE sm.tenant_id = ?
      ORDER BY sm.created_at DESC
      LIMIT 200
    `).all(tenantId) as Array<Record<string, unknown>>;
    for (const r of rows) {
      sheet.addRow([r.created_at, r.branch_name, r.movement_type, r.reference_id || '-', r.prod_name, r.qty_delta]);
    }
  }

  sheet.columns.forEach((col) => {
    col.width = 20;
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    buffer,
    filename: `${reportType}_${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}
