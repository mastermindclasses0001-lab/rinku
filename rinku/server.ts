import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase } from './src/db/database.ts';
import {
  cosineSimilarity,
  decryptJson,
  encryptJson,
  hashPassword,
  maskSecrets,
  mergeMaskedConfig,
  SessionPayload,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './src/lib/crypto.ts';
import { runCustomerEnquiryAi, runOwnerAssistantAi } from './src/lib/aiService.ts';
import { buildExcelReport, ReportType } from './src/lib/excelExport.ts';
import { buildCleanSourceZip } from './src/lib/sourceZip.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Sliding-window API rate limiter
const rateBuckets = new Map<string, number[]>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/')) return next();
  const key = req.ip || 'local';
  const now = Date.now();
  const windowMs = 60_000;
  const maxReq = 240;
  const list = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= maxReq) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please retry in a few seconds.' });
  }
  list.push(now);
  rateBuckets.set(key, list);
  next();
}
app.use(rateLimit);

interface AuthedRequest extends Request {
  session?: SessionPayload;
  activeTenantId?: string;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifySessionToken(header.slice(7));
    req.session = payload;
    // Strict tenant isolation: only super_admin may switch active tenant via header
    const requestedTenant = req.headers['x-tenant-id'] as string | undefined;
    if (payload.role === 'super_admin' && requestedTenant) {
      req.activeTenantId = requestedTenant;
    } else {
      req.activeTenantId = payload.tenantId;
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

function requireRole(roles: SessionPayload['role'][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.session || !roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'Insufficient role permissions for this operation' });
    }
    next();
  };
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function logAudit(
  tenantId: string,
  branchId: string | null,
  session: SessionPayload | undefined,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown>,
  ip?: string
) {
  db.prepare(
    `INSERT INTO audit_logs (id, tenant_id, branch_id, user_id, user_name, action, entity_type, entity_id, details_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('aud'),
    tenantId,
    branchId,
    session?.userId || null,
    session?.fullName || 'System',
    action,
    entityType,
    entityId,
    JSON.stringify(details),
    ip || '127.0.0.1'
  );
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'TitanGrid Retail ERP', timestamp: new Date().toISOString() });
});

// ================= AUTH & SETUP WIZARD =================
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = db.prepare(`SELECT * FROM users WHERE lower(email) = lower(?) AND status = 'active'`).get(email.trim()) as
    | Record<string, unknown>
    | undefined;

  if (!user || !verifyPassword(password, String(user.password_hash))) {
    db.prepare(`INSERT INTO login_history (id, tenant_id, user_id, email, role, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).run(
      uid('log'),
      user ? String(user.tenant_id) : null,
      user ? String(user.id) : null,
      email,
      user ? String(user.role) : null,
      req.ip || '127.0.0.1',
      req.headers['user-agent'] || ''
    );
    return res.status(401).json({ error: 'Invalid credentials or inactive account' });
  }

  const tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(String(user.tenant_id)) as Record<string, unknown>;
  if (tenant.status !== 'active' && user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Business subscription is suspended. Contact platform administrator.' });
  }

  const session: SessionPayload = {
    userId: String(user.id),
    tenantId: String(user.tenant_id),
    branchId: user.branch_id ? String(user.branch_id) : null,
    role: user.role as SessionPayload['role'],
    email: String(user.email),
    fullName: String(user.full_name),
  };
  const token = signSessionToken(session);

  db.prepare(`INSERT INTO login_history (id, tenant_id, user_id, email, role, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
    uid('log'),
    session.tenantId,
    session.userId,
    session.email,
    session.role,
    req.ip || '127.0.0.1',
    req.headers['user-agent'] || ''
  );

  res.json({ token, user: session });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenantId) as Record<string, unknown>;
  const branches = db.prepare(`SELECT * FROM branches WHERE tenant_id = ? ORDER BY is_headquarters DESC, name ASC`).all(tenantId);
  const user = db.prepare(`SELECT id, tenant_id, branch_id, email, full_name, role, phone, face_enrolled, monthly_target, commission_rate FROM users WHERE id = ?`).get(req.session!.userId);
  res.json({
    session: req.session,
    user,
    tenant: {
      ...tenant,
      branding: JSON.parse(String(tenant.branding_json || '{}')),
      config: JSON.parse(String(tenant.config_json || '{}')),
    },
    branches,
  });
});

app.post('/api/auth/setup-wizard', (req, res) => {
  const { businessName, legalName, gstin, address, phone, email, ownerName, ownerEmail, ownerPassword, branchName, branchCity, branchState, stateCode } = req.body;
  if (!businessName || !ownerEmail || !ownerPassword || !branchName) {
    return res.status(400).json({ error: 'Missing required business or owner onboarding fields' });
  }
  const existing = db.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).get(ownerEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const tenantId = uid('ten');
  const branchId = uid('br');
  const userId = uid('usr');
  const slug = String(businessName).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) + '-' + crypto.randomBytes(2).toString('hex');

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tenants (id, slug, name, legal_name, gstin, address, phone, email, currency, currency_symbol, plan, status, is_demo, branding_json, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', '₹', 'pro', 'active', 0, ?, ?)
    `).run(
      tenantId,
      slug,
      businessName,
      legalName || businessName,
      gstin || '',
      address || '',
      phone || '',
      email || ownerEmail,
      JSON.stringify({ accent: '#38BDF8', invoiceFooter: `Thank you for your business with ${businessName}.`, financialYear: '2026-27', language: 'en-IN' }),
      JSON.stringify({ reminderTime: '09:00', allowNegativeStock: false, maxCashierDiscountPct: 10, stateCode: stateCode || '20' })
    );

    db.prepare(`
      INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, gstin, phone, is_headquarters)
      VALUES (?, ?, 'BR-HQ', ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(branchId, tenantId, branchName, address || branchCity || 'Main Road', branchCity || 'Ranchi', branchState || 'Jharkhand', stateCode || '20', gstin || '', phone || '');

    db.prepare(`
      INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, phone, joining_date)
      VALUES (?, ?, ?, ?, ?, ?, 'owner', '1234', ?, date('now'))
    `).run(userId, tenantId, branchId, ownerEmail, hashPassword(ownerPassword), ownerName || 'Business Owner', phone || '');

    for (const [slugCat, nameCat] of [['tiles', 'Tiles'], ['paint', 'Paint'], ['sanitaryware', 'Sanitaryware'], ['hardware', 'Hardware']]) {
      db.prepare(`INSERT INTO categories (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)`).run(uid('cat'), tenantId, nameCat, slugCat);
    }
    for (const prov of ['firebase', 'meta_whatsapp', 'ai_provider', 'database']) {
      db.prepare(`INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status) VALUES (?, ?, ?, ?, ?)`).run(
        uid('int'),
        tenantId,
        prov,
        encryptJson({}),
        prov === 'database' ? 'configured' : 'not_configured'
      );
    }
  });
  tx();

  const session: SessionPayload = {
    userId,
    tenantId,
    branchId,
    role: 'owner',
    email: ownerEmail,
    fullName: ownerName || 'Business Owner',
  };
  res.json({ token: signSessionToken(session), user: session, tenantId });
});

app.get('/api/auth/login-history', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`SELECT * FROM login_history WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50`).all(req.activeTenantId!);
  res.json(rows);
});

// ================= SUPER ADMIN TENANT MANAGEMENT =================
app.get('/api/super-admin/tenants', requireAuth, requireRole(['super_admin']), (_req, res) => {
  const tenants = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as branch_count,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as user_count,
      (SELECT COALESCE(SUM(total_amount), 0) FROM invoices i WHERE i.tenant_id = t.id AND i.is_cancelled = 0) as total_gmv
    FROM tenants t
    ORDER BY t.created_at DESC
  `).all();
  res.json(tenants);
});

app.post('/api/super-admin/tenants', requireAuth, requireRole(['super_admin']), (req: AuthedRequest, res) => {
  const { name, legalName, gstin, address, phone, email, plan, ownerName, ownerEmail, ownerPassword, branchName, branchCity, branchState, stateCode } = req.body;
  if (!name || !ownerEmail || !ownerPassword) {
    return res.status(400).json({ error: 'Business name, owner email, and password are required' });
  }
  const exists = db.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).get(ownerEmail);
  if (exists) return res.status(409).json({ error: 'Owner email already exists' });

  const tenantId = uid('ten');
  const branchId = uid('br');
  const userId = uid('usr');
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + crypto.randomBytes(2).toString('hex');

  db.transaction(() => {
    db.prepare(`
      INSERT INTO tenants (id, slug, name, legal_name, gstin, address, phone, email, plan, status, is_demo, branding_json, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `).run(
      tenantId,
      slug,
      name,
      legalName || name,
      gstin || '',
      address || '',
      phone || '',
      email || ownerEmail,
      plan || 'enterprise',
      JSON.stringify({ accent: '#38BDF8', invoiceFooter: `Official Invoice — ${name}`, financialYear: '2026-27', language: 'en-IN' }),
      JSON.stringify({ reminderTime: '09:00', allowNegativeStock: false, maxCashierDiscountPct: 10, stateCode: stateCode || '20' })
    );
    db.prepare(`INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, is_headquarters) VALUES (?, ?, 'BR-HQ', ?, ?, ?, ?, ?, 1)`).run(
      branchId,
      tenantId,
      branchName || `${name} HQ`,
      address || 'Main Branch',
      branchCity || 'Ranchi',
      branchState || 'Jharkhand',
      stateCode || '20'
    );
    db.prepare(`INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, joining_date) VALUES (?, ?, ?, ?, ?, ?, 'owner', '1234', date('now'))`).run(
      userId,
      tenantId,
      branchId,
      ownerEmail,
      hashPassword(ownerPassword),
      ownerName || 'Tenant Owner'
    );
    for (const [slugCat, nameCat] of [['tiles', 'Tiles'], ['paint', 'Paint'], ['sanitaryware', 'Sanitaryware'], ['hardware', 'Hardware']]) {
      db.prepare(`INSERT INTO categories (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)`).run(uid('cat'), tenantId, nameCat, slugCat);
    }
    for (const prov of ['firebase', 'meta_whatsapp', 'ai_provider', 'database']) {
      db.prepare(`INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status) VALUES (?, ?, ?, ?, ?)`).run(
        uid('int'),
        tenantId,
        prov,
        encryptJson({}),
        prov === 'database' ? 'configured' : 'not_configured'
      );
    }
  })();

  logAudit(tenantId, branchId, req.session, 'CREATE_TENANT', 'tenant', tenantId, { name, plan }, req.ip);
  res.json({ ok: true, tenantId });
});

app.patch('/api/super-admin/tenants/:id/status', requireAuth, requireRole(['super_admin']), (req: AuthedRequest, res) => {
  const { status, plan } = req.body;
  db.prepare(`UPDATE tenants SET status = COALESCE(?, status), plan = COALESCE(?, plan) WHERE id = ?`).run(status || null, plan || null, req.params.id);
  logAudit(req.params.id, null, req.session, 'UPDATE_TENANT_STATUS', 'tenant', req.params.id, { status, plan }, req.ip);
  res.json({ ok: true });
});

// ================= OWNER DASHBOARD =================
app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = req.query.branchId as string | undefined;
  const salesmanId = req.query.salesmanId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  const invClauses = [`i.tenant_id = ?`, `i.is_cancelled = 0`, `i.doc_type = 'invoice'`];
  const invArgs: unknown[] = [tenantId];
  if (branchId && branchId !== 'all') {
    invClauses.push(`i.branch_id = ?`);
    invArgs.push(branchId);
  }
  if (salesmanId && salesmanId !== 'all') {
    invClauses.push(`i.salesman_id = ?`);
    invArgs.push(salesmanId);
  }
  if (dateFrom) {
    invClauses.push(`date(i.created_at) >= date(?)`);
    invArgs.push(dateFrom);
  }
  if (dateTo) {
    invClauses.push(`date(i.created_at) <= date(?)`);
    invArgs.push(dateTo);
  }
  const whereInv = invClauses.join(' AND ');

  const salesAgg = db.prepare(`
    SELECT COALESCE(SUM(i.total_amount), 0) as total_sales,
           COALESCE(SUM(i.taxable_amount), 0) as total_taxable,
           COALESCE(SUM(i.paid_amount), 0) as total_collected,
           COALESCE(SUM(i.due_amount), 0) as total_due,
           COUNT(i.id) as invoice_count
    FROM invoices i WHERE ${whereInv}
  `).get(...invArgs) as Record<string, number>;

  const cogsAgg = db.prepare(`
    SELECT COALESCE(SUM(ii.qty * ii.purchase_cost), 0) as total_cogs
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE ${whereInv}
  `).get(...invArgs) as { total_cogs: number };

  const today = new Date().toISOString().slice(0, 10);
  const todaySales = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as amount, COUNT(*) as count
    FROM invoices i WHERE ${whereInv} AND date(i.created_at) = date(?)
  `).get(...invArgs, today) as { amount: number; count: number };

  const expClauses = [`tenant_id = ?`, `is_deleted = 0`];
  const expArgs: unknown[] = [tenantId];
  if (branchId && branchId !== 'all') {
    expClauses.push(`branch_id = ?`);
    expArgs.push(branchId);
  }
  if (dateFrom) {
    expClauses.push(`date(expense_date) >= date(?)`);
    expArgs.push(dateFrom);
  }
  if (dateTo) {
    expClauses.push(`date(expense_date) <= date(?)`);
    expArgs.push(dateTo);
  }
  const expAgg = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE ${expClauses.join(' AND ')}`).get(...expArgs) as { total_expenses: number };

  const purchaseClauses = [`tenant_id = ?`, `status != 'cancelled'`];
  const purchaseArgs: unknown[] = [tenantId];
  if (branchId && branchId !== 'all') {
    purchaseClauses.push(`branch_id = ?`);
    purchaseArgs.push(branchId);
  }
  const purchaseAgg = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as total_purchases FROM purchase_orders WHERE ${purchaseClauses.join(' AND ')}`).get(...purchaseArgs) as { total_purchases: number };

  // Payment mode breakdown across matching invoices
  const invRows = db.prepare(`SELECT payment_breakdown_json FROM invoices i WHERE ${whereInv}`).all(...invArgs) as Array<{ payment_breakdown_json: string }>;
  let cashTotal = 0, upiTotal = 0, cardTotal = 0, bankTotal = 0;
  for (const r of invRows) {
    try {
      const b = JSON.parse(r.payment_breakdown_json || '{}');
      cashTotal += Number(b.cash || 0);
      upiTotal += Number(b.upi || 0);
      cardTotal += Number(b.card || 0);
      bankTotal += Number(b.bank || 0);
    } catch { /* ignore */ }
  }

  const branchBreakdown = db.prepare(`
    SELECT b.id, b.name, b.code, b.city,
           COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.total_amount ELSE 0 END), 0) as sales,
           COALESCE(SUM(CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.due_amount ELSE 0 END), 0) as dues,
           COUNT(DISTINCT CASE WHEN i.is_cancelled = 0 AND i.doc_type = 'invoice' THEN i.id END) as orders
    FROM branches b
    LEFT JOIN invoices i ON i.branch_id = b.id
    WHERE b.tenant_id = ?
    GROUP BY b.id
  `).all(tenantId);

  const topProducts = db.prepare(`
    SELECT ii.product_id, ii.product_name, ii.sku, SUM(ii.qty) as qty_sold, SUM(ii.total) as revenue,
           SUM(ii.taxable_value - (ii.qty * ii.purchase_cost)) as gross_profit
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE ${whereInv}
    GROUP BY ii.product_id
    ORDER BY revenue DESC
    LIMIT 6
  `).all(...invArgs);

  const lowStock = db.prepare(`
    SELECT bs.id, p.id as product_id, p.name, p.sku, p.min_stock, p.unit, b.name as branch_name, bs.qty_available
    FROM branch_stock bs
    JOIN products p ON p.id = bs.product_id
    JOIN branches b ON b.id = bs.branch_id
    WHERE bs.tenant_id = ? AND p.is_deleted = 0 AND bs.qty_available <= p.min_stock ${branchId && branchId !== 'all' ? 'AND bs.branch_id = ?' : ''}
    ORDER BY bs.qty_available ASC
    LIMIT 10
  `).all(...(branchId && branchId !== 'all' ? [tenantId, branchId] : [tenantId]));

  const customerDues = db.prepare(`
    SELECT id, name, phone, segment, outstanding_balance, due_date
    FROM customers WHERE tenant_id = ? AND is_deleted = 0 AND outstanding_balance > 0
    ORDER BY outstanding_balance DESC LIMIT 8
  `).all(tenantId);

  const supplierPayables = db.prepare(`
    SELECT COALESCE(SUM(balance_payable), 0) as total_payable FROM suppliers WHERE tenant_id = ? AND is_deleted = 0
  `).get(tenantId) as { total_payable: number };

  const attendanceToday = db.prepare(`
    SELECT a.*, u.full_name, u.role, b.name as branch_name
    FROM attendance_logs a
    JOIN users u ON u.id = a.user_id
    JOIN branches b ON b.id = a.branch_id
    WHERE a.tenant_id = ? AND a.log_date = date(?)
  `).all(tenantId, today);

  const pendingTransfers = db.prepare(`SELECT COUNT(*) as c FROM stock_transfers WHERE tenant_id = ? AND status = 'dispatched'`).get(tenantId) as { c: number };
  const openComplaints = db.prepare(`SELECT COUNT(*) as c FROM customer_complaints WHERE tenant_id = ? AND status != 'resolved'`).get(tenantId) as { c: number };

  const grossProfit = Number(salesAgg.total_taxable || 0) - Number(cogsAgg.total_cogs || 0);
  const netProfit = grossProfit - Number(expAgg.total_expenses || 0);

  res.json({
    kpis: {
      totalSales: salesAgg.total_sales,
      todaySales: todaySales.amount,
      todayInvoices: todaySales.count,
      totalPurchases: purchaseAgg.total_purchases,
      grossProfit,
      netProfit,
      totalExpenses: expAgg.total_expenses,
      customerOutstanding: customerDues.reduce((s: number, c: any) => s + Number(c.outstanding_balance || 0), 0),
      supplierPayable: supplierPayables.total_payable,
      cashBalance: cashTotal,
      upiBalance: upiTotal,
      cardBankBalance: cardTotal + bankTotal,
      invoiceCount: salesAgg.invoice_count,
    },
    branchBreakdown,
    topProducts,
    lowStock,
    customerDues,
    attendanceToday,
    pendingApprovals: {
      pendingTransfers: pendingTransfers.c,
      openComplaints: openComplaints.c,
      lowStockCount: lowStock.length,
    },
  });
});

// ================= BRANCHES =================
app.get('/api/branches', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`SELECT * FROM branches WHERE tenant_id = ? ORDER BY is_headquarters DESC, name ASC`).all(req.activeTenantId!);
  res.json(rows);
});

app.post('/api/branches', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const { code, name, address, city, state, stateCode, gstin, phone, lat, lng, radiusMeters } = req.body;
  if (!name || !city) return res.status(400).json({ error: 'Branch name and city are required' });
  const id = uid('br');
  db.prepare(`
    INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, gstin, phone, lat, lng, radius_meters)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.activeTenantId!,
    code || `BR-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    name,
    address || '',
    city,
    state || 'Jharkhand',
    stateCode || '20',
    gstin || '',
    phone || '',
    Number(lat || 23.3441),
    Number(lng || 85.3096),
    Number(radiusMeters || 300)
  );
  // Initialize 0-qty branch_stock rows for existing tenant products
  const products = db.prepare(`SELECT id FROM products WHERE tenant_id = ? AND is_deleted = 0`).all(req.activeTenantId!) as Array<{ id: string }>;
  const ins = db.prepare(`INSERT OR IGNORE INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available) VALUES (?, ?, ?, ?, 0)`);
  for (const p of products) ins.run(uid('stk'), req.activeTenantId!, id, p.id);

  logAudit(req.activeTenantId!, id, req.session, 'CREATE_BRANCH', 'branch', id, { name, city }, req.ip);
  res.json({ ok: true, id });
});

app.patch('/api/branches/:id', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = req.params.id;
  const { code, name, address, city, state, stateCode, gstin, phone } = req.body;
  const existing = db.prepare(`SELECT id FROM branches WHERE id = ? AND tenant_id = ?`).get(branchId, tenantId);
  if (!existing) return res.status(404).json({ error: 'Branch not found for this tenant' });

  db.prepare(`
    UPDATE branches
    SET code = COALESCE(?, code),
        name = COALESCE(?, name),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        state_code = COALESCE(?, state_code),
        gstin = COALESCE(?, gstin),
        phone = COALESCE(?, phone)
    WHERE id = ? AND tenant_id = ?
  `).run(
    code ?? null,
    name ?? null,
    address ?? null,
    city ?? null,
    state ?? null,
    stateCode ?? null,
    gstin ?? null,
    phone ?? null,
    branchId,
    tenantId
  );

  logAudit(tenantId, branchId, req.session, 'UPDATE_BRANCH', 'branch', branchId, { name, city, address }, req.ip);
  res.json({ ok: true });
});

// ================= INVENTORY & STOCK TRANSFERS =================
app.get('/api/inventory/products', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = (req.query.branchId as string) || 'all';
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;

  const products = db
    .prepare(`SELECT * FROM products WHERE tenant_id = ? AND is_deleted = 0 ORDER BY category_name, name`)
    .all(tenantId) as Array<Record<string, unknown>>;

  const stockRows = db
    .prepare(`SELECT bs.*, b.name as branch_name, b.code as branch_code FROM branch_stock bs JOIN branches b ON b.id = bs.branch_id WHERE bs.tenant_id = ?`)
    .all(tenantId) as Array<Record<string, unknown>>;

  const stockByProduct = new Map<string, Array<Record<string, unknown>>>();
  for (const s of stockRows) {
    const pid = String(s.product_id);
    if (!stockByProduct.has(pid)) stockByProduct.set(pid, []);
    stockByProduct.get(pid)!.push(s);
  }

  let enriched: Array<Record<string, unknown>> = products.map((p) => {
    const stocks = stockByProduct.get(String(p.id)) || [];
    const activeBranchStock =
      branchId !== 'all'
        ? stocks.find((s) => s.branch_id === branchId) || { qty_available: 0, qty_damaged: 0, qty_dead: 0 }
        : {
            qty_available: stocks.reduce((acc, s) => acc + Number(s.qty_available || 0), 0),
            qty_damaged: stocks.reduce((acc, s) => acc + Number(s.qty_damaged || 0), 0),
            qty_dead: stocks.reduce((acc, s) => acc + Number(s.qty_dead || 0), 0),
          };
    return {
      ...p,
      qty_available: Number(activeBranchStock.qty_available || 0),
      qty_damaged: Number(activeBranchStock.qty_damaged || 0),
      qty_dead: Number(activeBranchStock.qty_dead || 0),
      branch_stocks: stocks,
    };
  });

  if (category && category !== 'All') {
    enriched = enriched.filter((p) => String(p.category_name).toLowerCase() === category.toLowerCase());
  }
  if (search) {
    const q = search.toLowerCase();
    enriched = enriched.filter(
      (p) =>
        String(p.name).toLowerCase().includes(q) ||
        String(p.sku).toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase().includes(q) ||
        String(p.brand || '').toLowerCase().includes(q) ||
        String(p.shade || '').toLowerCase().includes(q)
    );
  }

  res.json(enriched);
});

app.post('/api/inventory/products', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const p = req.body;
  if (!p.name || !p.sku || !p.categoryName) {
    return res.status(400).json({ error: 'Product name, SKU, and category are required' });
  }
  const id = uid('prd');
  const defaultImg =
    p.categoryName === 'Tiles'
      ? '/src/assets/images/tile_marble_slab_1794811964688.jpg'
      : p.categoryName === 'Paint'
      ? '/src/assets/images/paint_bucket_studio_1794811965564.jpg'
      : p.categoryName === 'Sanitaryware'
      ? '/src/assets/images/sanitary_faucet_brass_1794811965032.jpg'
      : '/src/assets/images/hardware_lockset_steel_1794811966531.jpg';

  db.transaction(() => {
    db.prepare(`
      INSERT INTO products (id, tenant_id, category_name, subcategory, sku, barcode, qr_code, name, brand, hsn_code, gst_rate, tax_inclusive, unit, base_unit, conversion_factor, box_coverage_sqft, shade, batch_no, lot_no, color_code, mfg_date, exp_date, purchase_price, mrp, selling_price, min_stock, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tenantId,
      p.categoryName,
      p.subcategory || '',
      p.sku,
      p.barcode || p.sku,
      `QR-${p.sku}`,
      p.name,
      p.brand || '',
      p.hsnCode || '6907',
      Number(p.gstRate ?? 18),
      p.taxInclusive ? 1 : 0,
      p.unit || 'Piece',
      p.baseUnit || p.unit || 'Piece',
      Number(p.conversionFactor || 1),
      p.boxCoverageSqft ? Number(p.boxCoverageSqft) : null,
      p.shade || null,
      p.batchNo || null,
      p.lotNo || null,
      p.colorCode || null,
      p.mfgDate || null,
      p.expDate || null,
      Number(p.purchasePrice || 0),
      Number(p.mrp || p.sellingPrice || 0),
      Number(p.sellingPrice || 0),
      Number(p.minStock || 10),
      p.imageUrl || defaultImg
    );

    const branches = db.prepare(`SELECT id FROM branches WHERE tenant_id = ?`).all(tenantId) as Array<{ id: string }>;
    for (const b of branches) {
      const initQty = p.openingBranchId === b.id ? Number(p.openingStock || 0) : 0;
      db.prepare(`INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available) VALUES (?, ?, ?, ?, ?)`).run(
        uid('stk'),
        tenantId,
        b.id,
        id,
        initQty
      );
      if (initQty > 0) {
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'opening', ?, 'product_create', ?, 'Opening stock on SKU creation', ?)`).run(
          uid('mov'),
          tenantId,
          b.id,
          id,
          initQty,
          Number(p.purchasePrice || 0),
          req.session!.userId
        );
      }
    }
  })();

  logAudit(tenantId, null, req.session, 'CREATE_PRODUCT', 'product', id, { sku: p.sku, name: p.name }, req.ip);
  res.json({ ok: true, id });
});

app.post('/api/inventory/adjust', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const { branchId, productId, movementType, qtyDelta, notes } = req.body as {
    branchId: string;
    productId: string;
    movementType: 'adjustment' | 'damage' | 'dead_stock' | 'opening';
    qtyDelta: number;
    notes?: string;
  };
  const tenantId = req.activeTenantId!;
  if (!branchId || !productId || !qtyDelta) return res.status(400).json({ error: 'branchId, productId, and qtyDelta required' });

  const prod = db.prepare(`SELECT purchase_price FROM products WHERE id = ? AND tenant_id = ?`).get(productId, tenantId) as { purchase_price: number } | undefined;
  if (!prod) return res.status(404).json({ error: 'Product not found for tenant' });

  db.transaction(() => {
    const stock = db.prepare(`SELECT * FROM branch_stock WHERE branch_id = ? AND product_id = ? AND tenant_id = ?`).get(branchId, productId, tenantId) as
      | { id: string; qty_available: number; qty_damaged: number; qty_dead: number }
      | undefined;
    if (!stock) throw new Error('Branch stock record missing');

    if (movementType === 'damage') {
      const ded = Math.abs(qtyDelta);
      if (stock.qty_available < ded) throw new Error('Cannot mark more damaged than available stock');
      db.prepare(`UPDATE branch_stock SET qty_available = qty_available - ?, qty_damaged = qty_damaged + ?, last_updated = datetime('now') WHERE id = ?`).run(ded, ded, stock.id);
    } else if (movementType === 'dead_stock') {
      const ded = Math.abs(qtyDelta);
      if (stock.qty_available < ded) throw new Error('Cannot mark more dead stock than available stock');
      db.prepare(`UPDATE branch_stock SET qty_available = qty_available - ?, qty_dead = qty_dead + ?, last_updated = datetime('now') WHERE id = ?`).run(ded, ded, stock.id);
    } else {
      const nextQty = stock.qty_available + qtyDelta;
      if (nextQty < 0) throw new Error('Adjustment would result in negative stock');
      db.prepare(`UPDATE branch_stock SET qty_available = ?, last_updated = datetime('now') WHERE id = ?`).run(nextQty, stock.id);
    }

    db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`).run(
      uid('mov'),
      tenantId,
      branchId,
      productId,
      movementType,
      movementType === 'damage' || movementType === 'dead_stock' ? -Math.abs(qtyDelta) : qtyDelta,
      prod.purchase_price,
      notes || '',
      req.session!.userId
    );
  })();

  logAudit(tenantId, branchId, req.session, 'STOCK_ADJUST', 'product', productId, { movementType, qtyDelta, notes }, req.ip);
  res.json({ ok: true });
});

app.get('/api/inventory/movements', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = req.query.branchId as string | undefined;
  const rows = db.prepare(`
    SELECT sm.*, p.name as product_name, p.sku, p.unit, b.name as branch_name
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    JOIN branches b ON b.id = sm.branch_id
    WHERE sm.tenant_id = ? ${branchId && branchId !== 'all' ? 'AND sm.branch_id = ?' : ''}
    ORDER BY sm.created_at DESC
    LIMIT 100
  `).all(...(branchId && branchId !== 'all' ? [tenantId, branchId] : [tenantId]));
  res.json(rows);
});

app.get('/api/inventory/transfers', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const transfers = db.prepare(`
    SELECT t.*, bf.name as from_branch_name, bt.name as to_branch_name
    FROM stock_transfers t
    JOIN branches bf ON bf.id = t.from_branch_id
    JOIN branches bt ON bt.id = t.to_branch_id
    WHERE t.tenant_id = ?
    ORDER BY t.dispatched_at DESC
  `).all(tenantId) as Array<Record<string, unknown>>;

  const itemsStmt = db.prepare(`
    SELECT ti.*, p.name as product_name, p.sku, p.unit
    FROM stock_transfer_items ti
    JOIN products p ON p.id = ti.product_id
    WHERE ti.transfer_id = ?
  `);

  res.json(
    transfers.map((t) => ({
      ...t,
      items: itemsStmt.all(String(t.id)),
    }))
  );
});

app.post('/api/inventory/transfers', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { fromBranchId, toBranchId, notes, items } = req.body as {
    fromBranchId: string;
    toBranchId: string;
    notes?: string;
    items: Array<{ productId: string; qty: number }>;
  };
  if (!fromBranchId || !toBranchId || fromBranchId === toBranchId || !items?.length) {
    return res.status(400).json({ error: 'Valid source branch, destination branch, and items are required' });
  }

  const transferId = uid('trf');
  const transferNo = `TRF-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO stock_transfers (id, tenant_id, transfer_no, from_branch_id, to_branch_id, status, notes, dispatched_by) VALUES (?, ?, ?, ?, ?, 'dispatched', ?, ?)`).run(
        transferId,
        tenantId,
        transferNo,
        fromBranchId,
        toBranchId,
        notes || '',
        req.session!.userId
      );

      for (const item of items) {
        const stk = db.prepare(`SELECT id, qty_available FROM branch_stock WHERE tenant_id = ? AND branch_id = ? AND product_id = ?`).get(
          tenantId,
          fromBranchId,
          item.productId
        ) as { id: string; qty_available: number } | undefined;
        if (!stk || stk.qty_available < item.qty) {
          throw new Error(`Insufficient stock at source branch for product ${item.productId}`);
        }
        db.prepare(`UPDATE branch_stock SET qty_available = qty_available - ?, last_updated = datetime('now') WHERE id = ?`).run(item.qty, stk.id);
        db.prepare(`INSERT INTO stock_transfer_items (id, transfer_id, product_id, qty_sent, qty_received) VALUES (?, ?, ?, ?, 0)`).run(
          uid('trfi'),
          transferId,
          item.productId,
          item.qty
        );
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, notes, created_by) VALUES (?, ?, ?, ?, 'transfer_out', ?, 'stock_transfer', ?, ?, ?)`).run(
          uid('mov'),
          tenantId,
          fromBranchId,
          item.productId,
          -item.qty,
          transferNo,
          `Dispatched to destination branch`,
          req.session!.userId
        );
      }
    })();

    logAudit(tenantId, fromBranchId, req.session, 'DISPATCH_TRANSFER', 'stock_transfer', transferId, { transferNo, toBranchId, items }, req.ip);
    res.json({ ok: true, id: transferId, transferNo });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/inventory/transfers/:id/receive', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const transfer = db.prepare(`SELECT * FROM stock_transfers WHERE id = ? AND tenant_id = ?`).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.status === 'received') return res.status(400).json({ error: 'Transfer already received' });

  const items = db.prepare(`SELECT * FROM stock_transfer_items WHERE transfer_id = ?`).all(String(transfer.id)) as Array<{
    id: string;
    product_id: string;
    qty_sent: number;
  }>;

  db.transaction(() => {
    db.prepare(`UPDATE stock_transfers SET status = 'received', received_by = ?, received_at = datetime('now') WHERE id = ?`).run(
      req.session!.userId,
      transfer.id
    );
    for (const item of items) {
      db.prepare(`UPDATE stock_transfer_items SET qty_received = ? WHERE id = ?`).run(item.qty_sent, item.id);
      db.prepare(`
        INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(branch_id, product_id) DO UPDATE SET qty_available = qty_available + excluded.qty_available, last_updated = datetime('now')
      `).run(uid('stk'), tenantId, transfer.to_branch_id, item.product_id, item.qty_sent);

      db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, notes, created_by) VALUES (?, ?, ?, ?, 'transfer_in', ?, 'stock_transfer', ?, ?, ?)`).run(
        uid('mov'),
        tenantId,
        transfer.to_branch_id,
        item.product_id,
        item.qty_sent,
        transfer.transfer_no,
        `Received from source branch`,
        req.session!.userId
      );
    }
  })();

  logAudit(tenantId, String(transfer.to_branch_id), req.session, 'RECEIVE_TRANSFER', 'stock_transfer', String(transfer.id), { transferNo: transfer.transfer_no }, req.ip);
  res.json({ ok: true });
});

// ================= SUPPLIERS & PURCHASE ORDERS =================
app.get('/api/purchases/suppliers', requireAuth, (req: AuthedRequest, res) => {
  res.json(db.prepare(`SELECT * FROM suppliers WHERE tenant_id = ? AND is_deleted = 0 ORDER BY name`).all(req.activeTenantId!));
});

app.post('/api/purchases/suppliers', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager', 'accountant']), (req: AuthedRequest, res) => {
  const { name, gstin, phone, email, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Supplier name required' });
  const id = uid('sup');
  db.prepare(`INSERT INTO suppliers (id, tenant_id, name, gstin, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    req.activeTenantId!,
    name,
    gstin || '',
    phone || '',
    email || '',
    address || ''
  );
  res.json({ ok: true, id });
});

app.get('/api/purchases/orders', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT po.*, s.name as supplier_name, b.name as branch_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    JOIN branches b ON b.id = po.branch_id
    WHERE po.tenant_id = ?
    ORDER BY po.created_at DESC
  `).all(req.activeTenantId!);
  res.json(rows);
});

app.post('/api/purchases/orders', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager', 'accountant']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { branchId, supplierId, items, paidAmount, notes, receiveImmediately } = req.body as {
    branchId: string;
    supplierId: string;
    items: Array<{ productId: string; qty: number; unitCost: number; gstRate: number }>;
    paidAmount?: number;
    notes?: string;
    receiveImmediately?: boolean;
  };
  if (!branchId || !supplierId || !items?.length) return res.status(400).json({ error: 'Branch, supplier, and items required' });

  const poId = uid('po');
  const poNo = `PO-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  let subtotal = 0, gstAmount = 0;
  for (const it of items) {
    const lineSub = it.qty * it.unitCost;
    subtotal += lineSub;
    gstAmount += (lineSub * (it.gstRate ?? 18)) / 100;
  }
  const totalAmount = Math.round(subtotal + gstAmount);
  const paid = Math.min(totalAmount, Number(paidAmount || 0));
  const balanceAdded = totalAmount - paid;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, po_no, status, subtotal, gst_amount, total_amount, paid_amount, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(poId, tenantId, branchId, supplierId, poNo, receiveImmediately ? 'received' : 'ordered', subtotal, gstAmount, totalAmount, paid, notes || '', req.session!.userId);

    for (const it of items) {
      const lineSub = it.qty * it.unitCost;
      const lineTotal = lineSub + (lineSub * (it.gstRate ?? 18)) / 100;
      db.prepare(`INSERT INTO purchase_order_items (id, po_id, product_id, qty, unit_cost, gst_rate, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        uid('poi'),
        poId,
        it.productId,
        it.qty,
        it.unitCost,
        it.gstRate ?? 18,
        lineTotal
      );
      if (receiveImmediately) {
        db.prepare(`
          INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(branch_id, product_id) DO UPDATE SET qty_available = qty_available + excluded.qty_available, last_updated = datetime('now')
        `).run(uid('stk'), tenantId, branchId, it.productId, it.qty);
        db.prepare(`UPDATE products SET purchase_price = ? WHERE id = ? AND tenant_id = ?`).run(it.unitCost, it.productId, tenantId);
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase_order', ?, ?, ?, ?)`).run(
          uid('mov'),
          tenantId,
          branchId,
          it.productId,
          it.qty,
          poNo,
          it.unitCost,
          'PO received into stock',
          req.session!.userId
        );
      }
    }

    if (receiveImmediately && balanceAdded > 0) {
      db.prepare(`UPDATE suppliers SET balance_payable = balance_payable + ? WHERE id = ? AND tenant_id = ?`).run(balanceAdded, supplierId, tenantId);
    }
  })();

  logAudit(tenantId, branchId, req.session, 'CREATE_PO', 'purchase_order', poId, { poNo, totalAmount, receiveImmediately }, req.ip);
  res.json({ ok: true, id: poId, poNo, totalAmount });
});

app.post('/api/purchases/orders/:id/receive', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?`).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status === 'received') return res.status(400).json({ error: 'Already received' });

  const items = db.prepare(`SELECT * FROM purchase_order_items WHERE po_id = ?`).all(String(po.id)) as Array<{
    product_id: string;
    qty: number;
    unit_cost: number;
  }>;

  db.transaction(() => {
    db.prepare(`UPDATE purchase_orders SET status = 'received' WHERE id = ?`).run(po.id);
    for (const it of items) {
      db.prepare(`
        INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(branch_id, product_id) DO UPDATE SET qty_available = qty_available + excluded.qty_available, last_updated = datetime('now')
      `).run(uid('stk'), tenantId, po.branch_id, it.product_id, it.qty);
      db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase_order', ?, ?, ?, ?)`).run(
        uid('mov'),
        tenantId,
        po.branch_id,
        it.product_id,
        it.qty,
        po.po_no,
        it.unit_cost,
        'PO receiving confirmed',
        req.session!.userId
      );
    }
    const unpaid = Number(po.total_amount) - Number(po.paid_amount);
    if (unpaid > 0) {
      db.prepare(`UPDATE suppliers SET balance_payable = balance_payable + ? WHERE id = ?`).run(unpaid, po.supplier_id);
    }
  })();

  res.json({ ok: true });
});

// ================= POS BILLING & SALES =================
app.get('/api/pos/invoices', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = req.query.branchId as string | undefined;
  const rows = db.prepare(`
    SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.gstin as customer_gstin, c.address as customer_address,
           b.name as branch_name, b.code as branch_code, b.address as branch_address, b.gstin as branch_gstin, b.state_code as branch_state_code,
           u.full_name as salesman_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    JOIN branches b ON b.id = i.branch_id
    LEFT JOIN users u ON u.id = i.salesman_id
    WHERE i.tenant_id = ? ${branchId && branchId !== 'all' ? 'AND i.branch_id = ?' : ''}
    ORDER BY i.created_at DESC
    LIMIT 100
  `).all(...(branchId && branchId !== 'all' ? [tenantId, branchId] : [tenantId])) as Array<Record<string, unknown>>;

  const itemStmt = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`);
  res.json(
    rows.map((r) => ({
      ...r,
      payment_breakdown: JSON.parse(String(r.payment_breakdown_json || '{}')),
      items: itemStmt.all(String(r.id)),
    }))
  );
});

app.post('/api/pos/invoices', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const {
    branchId,
    docType = 'invoice',
    customerId,
    salesmanId,
    items,
    overallDiscountAmount = 0,
    paymentBreakdown = { cash: 0, upi: 0, card: 0, bank: 0 },
    dueDate,
    notes,
    idempotencyKey,
    allowNegativeOverride = false,
  } = req.body as {
    branchId: string;
    docType?: 'invoice' | 'quotation' | 'challan';
    customerId?: string;
    salesmanId?: string;
    items: Array<{ productId: string; qty: number; unitPrice: number; discountPct?: number; taxInclusive?: boolean }>;
    overallDiscountAmount?: number;
    paymentBreakdown?: { cash: number; upi: number; card: number; bank: number };
    dueDate?: string;
    notes?: string;
    idempotencyKey?: string;
    allowNegativeOverride?: boolean;
  };

  if (!branchId || !items?.length) {
    return res.status(400).json({ error: 'Branch and at least one line item are required' });
  }

  // Duplicate transaction protection
  if (idempotencyKey) {
    const dup = db.prepare(`SELECT id, invoice_no FROM invoices WHERE tenant_id = ? AND idempotency_key = ?`).get(tenantId, idempotencyKey) as
      | { id: string; invoice_no: string }
      | undefined;
    if (dup) {
      return res.json({ ok: true, id: dup.id, invoiceNo: dup.invoice_no, deduplicated: true });
    }
  }

  const tenant = db.prepare(`SELECT config_json FROM tenants WHERE id = ?`).get(tenantId) as { config_json: string };
  const tenantCfg = JSON.parse(tenant.config_json || '{}');
  const branch = db.prepare(`SELECT * FROM branches WHERE id = ? AND tenant_id = ?`).get(branchId, tenantId) as Record<string, unknown> | undefined;
  if (!branch) return res.status(404).json({ error: 'Branch not found for tenant' });

  const customer = customerId
    ? (db.prepare(`SELECT * FROM customers WHERE id = ? AND tenant_id = ?`).get(customerId, tenantId) as Record<string, unknown> | undefined)
    : undefined;

  const isInterstate = customer && customer.state_code && String(customer.state_code) !== String(branch.state_code);
  const affectsStock = docType === 'invoice' || docType === 'challan';

  // Role-based discount guard
  const maxCashierDiscount = Number(tenantCfg.maxCashierDiscountPct ?? 10);
  for (const line of items) {
    if ((line.discountPct || 0) > maxCashierDiscount && !['super_admin', 'owner', 'branch_manager'].includes(req.session!.role)) {
      return res.status(403).json({
        error: `Line discount (${line.discountPct}%) exceeds cashier limit of ${maxCashierDiscount}%. Manager approval required.`,
      });
    }
  }

  const invId = uid('inv');
  const prefix = docType === 'quotation' ? 'QTN' : docType === 'challan' ? 'CHL' : 'INV';
  const invoiceNo = `${prefix}-${branch.code}-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

  try {
    let subtotal = 0;
    let totalLineDiscount = 0;
    let taxableTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    const computedLines: Array<Record<string, unknown>> = [];

    for (const line of items) {
      const prod = db.prepare(`SELECT * FROM products WHERE id = ? AND tenant_id = ? AND is_deleted = 0`).get(line.productId, tenantId) as
        | Record<string, unknown>
        | undefined;
      if (!prod) throw new Error(`Product ${line.productId} not found`);

      if (affectsStock) {
        const stk = db.prepare(`SELECT qty_available FROM branch_stock WHERE branch_id = ? AND product_id = ? AND tenant_id = ?`).get(
          branchId,
          line.productId,
          tenantId
        ) as { qty_available: number } | undefined;
        const avail = Number(stk?.qty_available || 0);
        const canNegative = Boolean(tenantCfg.allowNegativeStock) || (allowNegativeOverride && ['super_admin', 'owner'].includes(req.session!.role));
        if (!canNegative && avail < line.qty) {
          throw new Error(`Insufficient stock at ${branch.name} for "${prod.name}" (Available: ${avail}, Requested: ${line.qty})`);
        }
      }

      const gstRate = Number(prod.gst_rate ?? 18);
      const inclusive = line.taxInclusive ?? Boolean(prod.tax_inclusive);
      const grossLine = line.qty * line.unitPrice;
      const lineDisc = (grossLine * Number(line.discountPct || 0)) / 100;
      const afterDisc = grossLine - lineDisc;

      let taxableVal = afterDisc;
      let taxVal = 0;
      if (inclusive) {
        taxableVal = afterDisc / (1 + gstRate / 100);
        taxVal = afterDisc - taxableVal;
      } else {
        taxVal = (afterDisc * gstRate) / 100;
      }

      const cgst = isInterstate ? 0 : taxVal / 2;
      const sgst = isInterstate ? 0 : taxVal / 2;
      const igst = isInterstate ? taxVal : 0;

      subtotal += grossLine;
      totalLineDiscount += lineDisc;
      taxableTotal += taxableVal;
      cgstTotal += cgst;
      sgstTotal += sgst;
      igstTotal += igst;

      computedLines.push({
        id: uid('ii'),
        productId: prod.id,
        sku: prod.sku,
        productName: prod.name,
        hsnCode: prod.hsn_code,
        qty: line.qty,
        unit: prod.unit,
        unitPrice: line.unitPrice,
        purchaseCost: Number(prod.purchase_price || 0),
        discountPct: Number(line.discountPct || 0),
        gstRate,
        taxableValue: Number(taxableVal.toFixed(2)),
        cgst: Number(cgst.toFixed(2)),
        sgst: Number(sgst.toFixed(2)),
        igst: Number(igst.toFixed(2)),
        total: Number((taxableVal + cgst + sgst + igst).toFixed(2)),
      });
    }

    const extraDisc = Math.min(taxableTotal * 0.5, Number(overallDiscountAmount || 0));
    const discountAmount = Number((totalLineDiscount + extraDisc).toFixed(2));
    // Re-proportion tax if overall extra discount was applied
    const ratio = taxableTotal > 0 ? Math.max(0, (taxableTotal - extraDisc) / taxableTotal) : 1;
    taxableTotal = Number((taxableTotal * ratio).toFixed(2));
    cgstTotal = Number((cgstTotal * ratio).toFixed(2));
    sgstTotal = Number((sgstTotal * ratio).toFixed(2));
    igstTotal = Number((igstTotal * ratio).toFixed(2));

    const totalAmount = Math.round(taxableTotal + cgstTotal + sgstTotal + igstTotal);
    const paidAmount =
      docType === 'quotation'
        ? 0
        : Math.min(
            totalAmount,
            Number(paymentBreakdown.cash || 0) + Number(paymentBreakdown.upi || 0) + Number(paymentBreakdown.card || 0) + Number(paymentBreakdown.bank || 0)
          );
    const dueAmount = docType === 'quotation' ? 0 : Math.max(0, totalAmount - paidAmount);
    const paymentStatus = docType === 'quotation' ? 'quotation' : dueAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    // Credit limit check for credit sales
    if (docType === 'invoice' && dueAmount > 0 && customer) {
      const nextDue = Number(customer.outstanding_balance || 0) + dueAmount;
      const limit = Number(customer.credit_limit || 0);
      if (limit > 0 && nextDue > limit && !['super_admin', 'owner'].includes(req.session!.role)) {
        throw new Error(`Customer credit limit exceeded (Limit: ${limit}, Projected Due: ${nextDue})`);
      }
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, tenant_id, branch_id, invoice_no, doc_type, customer_id, salesman_id, cashier_id, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, paid_amount, due_amount, payment_status, payment_breakdown_json, due_date, notes, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invId,
        tenantId,
        branchId,
        invoiceNo,
        docType,
        customerId || null,
        salesmanId || req.session!.userId,
        req.session!.userId,
        Number(subtotal.toFixed(2)),
        discountAmount,
        taxableTotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        totalAmount,
        paidAmount,
        dueAmount,
        paymentStatus,
        JSON.stringify(paymentBreakdown),
        dueDate || null,
        notes || '',
        idempotencyKey || null
      );

      for (const cl of computedLines) {
        db.prepare(`
          INSERT INTO invoice_items (id, invoice_id, product_id, sku, product_name, hsn_code, qty, unit, unit_price, purchase_cost, discount_pct, gst_rate, taxable_value, cgst, sgst, igst, total)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          cl.id,
          invId,
          cl.productId,
          cl.sku,
          cl.productName,
          cl.hsnCode,
          cl.qty,
          cl.unit,
          cl.unitPrice,
          cl.purchaseCost,
          cl.discountPct,
          cl.gstRate,
          cl.taxableValue,
          cl.cgst,
          cl.sgst,
          cl.igst,
          cl.total
        );

        if (affectsStock) {
          db.prepare(`UPDATE branch_stock SET qty_available = qty_available - ?, last_updated = datetime('now') WHERE branch_id = ? AND product_id = ? AND tenant_id = ?`).run(
            cl.qty,
            branchId,
            cl.productId,
            tenantId
          );
          db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'sale', ?, 'invoice', ?, ?, ?, ?)`).run(
            uid('mov'),
            tenantId,
            branchId,
            cl.productId,
            -Number(cl.qty),
            invoiceNo,
            cl.purchaseCost,
            `${docType.toUpperCase()} billed`,
            req.session!.userId
          );
        }
      }

      if (docType === 'invoice') {
        if (dueAmount > 0 && customerId) {
          db.prepare(`UPDATE customers SET outstanding_balance = outstanding_balance + ?, due_date = COALESCE(?, due_date) WHERE id = ? AND tenant_id = ?`).run(
            dueAmount,
            dueDate || null,
            customerId,
            tenantId
          );
        }
        // Record verified payment entries by mode
        for (const [modeKey, modeAmt] of Object.entries(paymentBreakdown)) {
          const amt = Number(modeAmt || 0);
          if (amt > 0) {
            const dbMode = modeKey === 'bank' ? 'bank_transfer' : modeKey;
            db.prepare(`INSERT INTO payments (id, tenant_id, branch_id, party_type, party_id, invoice_id, amount, mode, reference_no, status, notes, verified_by) VALUES (?, ?, ?, 'customer', ?, ?, ?, ?, ?, 'verified', ?, ?)`).run(
              uid('pay'),
              tenantId,
              branchId,
              customerId || 'walkin',
              invId,
              amt,
              dbMode,
              invoiceNo,
              `POS ${dbMode.toUpperCase()} payment`,
              req.session!.userId
            );
          }
        }
      }
    })();

    logAudit(tenantId, branchId, req.session, 'CREATE_INVOICE', 'invoice', invId, { invoiceNo, docType, totalAmount, paidAmount, dueAmount }, req.ip);
    res.json({ ok: true, id: invId, invoiceNo, totalAmount, dueAmount, cgstTotal, sgstTotal, igstTotal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pos/invoices/:id/cancel', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { reason } = req.body as { reason?: string };
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.is_cancelled) return res.status(400).json({ error: 'Invoice already cancelled / returned' });

  const items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(String(inv.id)) as Array<{
    product_id: string;
    qty: number;
    purchase_cost: number;
  }>;

  db.transaction(() => {
    db.prepare(`UPDATE invoices SET is_cancelled = 1, payment_status = 'cancelled', cancel_reason = ? WHERE id = ?`).run(
      reason || 'Sales return / Credit note issued',
      inv.id
    );
    if (inv.doc_type === 'invoice' || inv.doc_type === 'challan') {
      for (const it of items) {
        db.prepare(`UPDATE branch_stock SET qty_available = qty_available + ?, last_updated = datetime('now') WHERE branch_id = ? AND product_id = ? AND tenant_id = ?`).run(
          it.qty,
          inv.branch_id,
          it.product_id,
          tenantId
        );
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, branch_id, product_id, movement_type, qty_delta, reference_type, reference_id, unit_cost, notes, created_by) VALUES (?, ?, ?, ?, 'return', ?, 'credit_note', ?, ?, ?, ?)`).run(
          uid('mov'),
          tenantId,
          inv.branch_id,
          it.product_id,
          it.qty,
          inv.invoice_no,
          it.purchase_cost,
          reason || 'Sales return restock',
          req.session!.userId
        );
      }
      if (inv.customer_id && Number(inv.due_amount) > 0) {
        db.prepare(`UPDATE customers SET outstanding_balance = MAX(0, outstanding_balance - ?) WHERE id = ? AND tenant_id = ?`).run(
          inv.due_amount,
          inv.customer_id,
          tenantId
        );
      }
    }
  })();

  logAudit(tenantId, String(inv.branch_id), req.session, 'CANCEL_INVOICE', 'invoice', String(inv.id), { invoiceNo: inv.invoice_no, reason }, req.ip);
  res.json({ ok: true });
});

// ================= ACCOUNTS & FINANCIAL LEDGER =================
app.get('/api/accounts/overview', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = req.query.branchId as string | undefined;
  const branchCond = branchId && branchId !== 'all' ? 'AND branch_id = ?' : '';
  const args = branchId && branchId !== 'all' ? [tenantId, branchId] : [tenantId];

  const payments = db.prepare(`SELECT p.*, b.name as branch_name FROM payments p JOIN branches b ON b.id = p.branch_id WHERE p.tenant_id = ? ${branchId && branchId !== 'all' ? 'AND p.branch_id = ?' : ''} ORDER BY p.created_at DESC LIMIT 80`).all(...args);
  const expenses = db.prepare(`SELECT e.*, b.name as branch_name FROM expenses e JOIN branches b ON b.id = e.branch_id WHERE e.tenant_id = ? AND e.is_deleted = 0 ${branchId && branchId !== 'all' ? 'AND e.branch_id = ?' : ''} ORDER BY e.expense_date DESC LIMIT 80`).all(...args);
  const closings = db.prepare(`SELECT c.*, b.name as branch_name FROM cash_closings c JOIN branches b ON b.id = c.branch_id WHERE c.tenant_id = ? ${branchId && branchId !== 'all' ? 'AND c.branch_id = ?' : ''} ORDER BY c.closing_date DESC LIMIT 30`).all(...args);

  // Branch-wise P&L
  const pnl = db.prepare(`
    SELECT b.id as branch_id, b.name as branch_name,
      COALESCE((SELECT SUM(i.taxable_amount) FROM invoices i WHERE i.branch_id = b.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'), 0) as revenue_ex_tax,
      COALESCE((SELECT SUM(ii.qty * ii.purchase_cost) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.branch_id = b.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'), 0) as cogs,
      COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.branch_id = b.id AND e.is_deleted = 0), 0) as expenses
    FROM branches b WHERE b.tenant_id = ?
  `).all(tenantId) as Array<{ branch_id: string; branch_name: string; revenue_ex_tax: number; cogs: number; expenses: number }>;

  const branchPnl = pnl.map((r) => {
    const grossProfit = r.revenue_ex_tax - r.cogs;
    const netProfit = grossProfit - r.expenses;
    return { ...r, grossProfit, netProfit };
  });

  const cashTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND mode = 'cash' ${branchCond}`).get(...args) as { s: number };
  const upiTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND mode = 'upi' ${branchCond}`).get(...args) as { s: number };
  const bankTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND mode IN ('bank_transfer','card') ${branchCond}`).get(...args) as { s: number };

  res.json({
    payments,
    expenses,
    closings,
    branchPnl,
    totals: {
      cashInflow: cashTotal.s,
      upiInflow: upiTotal.s,
      bankCardInflow: bankTotal.s,
      totalExpenses: expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0),
    },
  });
});

app.post('/api/accounts/expenses', requireAuth, (req: AuthedRequest, res) => {
  const { branchId, category, description, amount, paymentMode, vendorName, expenseDate } = req.body;
  if (!branchId || !category || !amount) return res.status(400).json({ error: 'Branch, category, and amount required' });
  const id = uid('exp');
  db.prepare(`INSERT INTO expenses (id, tenant_id, branch_id, category, description, amount, payment_mode, vendor_name, expense_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    req.activeTenantId!,
    branchId,
    category,
    description || '',
    Number(amount),
    paymentMode || 'cash',
    vendorName || '',
    expenseDate || new Date().toISOString().slice(0, 10),
    req.session!.userId
  );
  logAudit(req.activeTenantId!, branchId, req.session, 'CREATE_EXPENSE', 'expense', id, { category, amount }, req.ip);
  res.json({ ok: true, id });
});

app.post('/api/accounts/payments', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { branchId, partyType, partyId, invoiceId, amount, mode, referenceNo, notes } = req.body;
  if (!branchId || !partyId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Branch, party, and positive amount are required' });
  }
  const payId = uid('pay');
  const amt = Number(amount);

  db.transaction(() => {
    db.prepare(`INSERT INTO payments (id, tenant_id, branch_id, party_type, party_id, invoice_id, amount, mode, reference_no, status, notes, verified_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)`).run(
      payId,
      tenantId,
      branchId,
      partyType || 'customer',
      partyId,
      invoiceId || null,
      amt,
      mode || 'upi',
      referenceNo || `RCPT-${Date.now().toString().slice(-6)}`,
      notes || 'Payment recorded & verified',
      req.session!.userId
    );

    if (partyType === 'supplier') {
      db.prepare(`UPDATE suppliers SET balance_payable = MAX(0, balance_payable - ?) WHERE id = ? AND tenant_id = ?`).run(amt, partyId, tenantId);
    } else {
      db.prepare(`UPDATE customers SET outstanding_balance = MAX(0, outstanding_balance - ?) WHERE id = ? AND tenant_id = ?`).run(amt, partyId, tenantId);
      if (invoiceId) {
        const inv = db.prepare(`SELECT paid_amount, due_amount, total_amount FROM invoices WHERE id = ? AND tenant_id = ?`).get(invoiceId, tenantId) as
          | { paid_amount: number; due_amount: number; total_amount: number }
          | undefined;
        if (inv) {
          const nextPaid = Math.min(inv.total_amount, inv.paid_amount + amt);
          const nextDue = Math.max(0, inv.total_amount - nextPaid);
          db.prepare(`UPDATE invoices SET paid_amount = ?, due_amount = ?, payment_status = ? WHERE id = ?`).run(
            nextPaid,
            nextDue,
            nextDue === 0 ? 'paid' : 'partial',
            invoiceId
          );
        }
      }
      // Log automatic thank-you WhatsApp receipt if opted in
      const cust = db.prepare(`SELECT name, phone, whatsapp_opt_in, outstanding_balance FROM customers WHERE id = ?`).get(partyId) as
        | { name: string; phone: string; whatsapp_opt_in: number; outstanding_balance: number }
        | undefined;
      if (cust && cust.whatsapp_opt_in) {
        db.prepare(`INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, ?, 'outbound', 'payment_thank_you', ?, 'simulated', 1)`).run(
          uid('wa'),
          tenantId,
          branchId,
          partyId,
          cust.phone,
          `Thank you ${cust.name}! We verified your payment of ₹${amt.toLocaleString()} via ${String(mode || 'UPI').toUpperCase()}. Remaining balance: ₹${cust.outstanding_balance.toLocaleString()}.`
        );
      }
    }
  })();

  logAudit(tenantId, branchId, req.session, 'RECORD_PAYMENT', 'payment', payId, { partyType, partyId, amt, mode }, req.ip);
  res.json({ ok: true, id: payId });
});

app.post('/api/accounts/cash-closing', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { branchId, closingDate, openingCash, actualCash, notes } = req.body;
  const dateStr = closingDate || new Date().toISOString().slice(0, 10);

  const cashSales = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE tenant_id = ? AND branch_id = ? AND mode = 'cash' AND date(created_at) = date(?)`).get(
    tenantId,
    branchId,
    dateStr
  ) as { s: number };
  const cashExp = db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM expenses WHERE tenant_id = ? AND branch_id = ? AND payment_mode = 'cash' AND date(expense_date) = date(?) AND is_deleted = 0`).get(
    tenantId,
    branchId,
    dateStr
  ) as { s: number };

  const expectedCash = Number(openingCash || 0) + cashSales.s - cashExp.s;
  const discrepancy = Number(actualCash || 0) - expectedCash;
  const id = uid('cls');

  db.prepare(`
    INSERT INTO cash_closings (id, tenant_id, branch_id, closing_date, opening_cash, cash_sales, cash_receipts, cash_expenses, expected_cash, actual_cash, discrepancy, notes, closed_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, branchId, dateStr, Number(openingCash || 0), cashSales.s, cashExp.s, expectedCash, Number(actualCash || 0), discrepancy, notes || '', req.session!.userId);

  logAudit(tenantId, branchId, req.session, 'CASH_CLOSING', 'cash_closing', id, { expectedCash, actualCash, discrepancy }, req.ip);
  res.json({ ok: true, id, expectedCash, discrepancy });
});

// ================= CUSTOMER CRM & 9 AM SCHEDULER =================
app.get('/api/crm/customers', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const customers = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice') as invoice_count,
      (SELECT COALESCE(SUM(total_amount), 0) FROM invoices i WHERE i.customer_id = c.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice') as lifetime_value
    FROM customers c
    WHERE c.tenant_id = ? AND c.is_deleted = 0
    ORDER BY c.outstanding_balance DESC, c.name ASC
  `).all(tenantId);
  res.json(customers);
});

app.post('/api/crm/customers', requireAuth, (req: AuthedRequest, res) => {
  const { branchId, name, phone, email, address, stateCode, gstin, segment, creditLimit, whatsappOptIn, dueDate, notes } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Customer name and phone are required' });
  const id = uid('cust');
  db.prepare(`
    INSERT INTO customers (id, tenant_id, branch_id, name, phone, email, address, state_code, gstin, segment, credit_limit, whatsapp_opt_in, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.activeTenantId!,
    branchId || null,
    name,
    phone,
    email || '',
    address || '',
    stateCode || '27',
    gstin || '',
    segment || 'retail',
    Number(creditLimit ?? 50000),
    whatsappOptIn === false ? 0 : 1,
    dueDate || null,
    notes || ''
  );
  res.json({ ok: true, id });
});

app.patch('/api/crm/customers/:id', requireAuth, (req: AuthedRequest, res) => {
  const { whatsappOptIn, creditLimit, segment, dueDate } = req.body;
  db.prepare(`
    UPDATE customers
    SET whatsapp_opt_in = COALESCE(?, whatsapp_opt_in),
        credit_limit = COALESCE(?, credit_limit),
        segment = COALESCE(?, segment),
        due_date = COALESCE(?, due_date)
    WHERE id = ? AND tenant_id = ?
  `).run(
    whatsappOptIn === undefined ? null : whatsappOptIn ? 1 : 0,
    creditLimit ?? null,
    segment ?? null,
    dueDate ?? null,
    req.params.id,
    req.activeTenantId!
  );
  res.json({ ok: true });
});

app.post('/api/crm/run-reminders', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  // Only send reminders to opted-in customers with outstanding > 0 and due_date <= today
  const overdue = db.prepare(`
    SELECT * FROM customers
    WHERE tenant_id = ? AND is_deleted = 0 AND whatsapp_opt_in = 1 AND outstanding_balance > 0 AND (due_date IS NULL OR date(due_date) <= date('now'))
  `).all(tenantId) as Array<Record<string, unknown>>;

  let sentCount = 0;
  for (const c of overdue) {
    db.prepare(`INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, ?, 'outbound', 'due_payment_reminder_9am', ?, 'simulated', 1)`).run(
      uid('wa'),
      tenantId,
      c.branch_id || null,
      c.id,
      c.phone,
      `[09:00 AM Scheduler] Dear ${c.name}, reminder for your pending balance of ₹${Number(c.outstanding_balance).toLocaleString()}. Pay via UPI or bank transfer to stop further reminders.`
    );
    sentCount++;
  }
  logAudit(tenantId, null, req.session, 'RUN_9AM_REMINDERS', 'crm', null, { sentCount }, req.ip);
  res.json({ ok: true, sentCount });
});

app.get('/api/crm/complaints', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT cc.*, c.name as customer_name, c.phone as customer_phone
    FROM customer_complaints cc
    JOIN customers c ON c.id = cc.customer_id
    WHERE cc.tenant_id = ?
    ORDER BY cc.created_at DESC
  `).all(req.activeTenantId!);
  res.json(rows);
});

app.post('/api/crm/complaints', requireAuth, (req: AuthedRequest, res) => {
  const { branchId, customerId, subject, description, followUpDate } = req.body;
  if (!customerId || !subject) return res.status(400).json({ error: 'Customer and subject required' });
  const id = uid('cmp');
  db.prepare(`INSERT INTO customer_complaints (id, tenant_id, branch_id, customer_id, subject, description, status, follow_up_date) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).run(
    id,
    req.activeTenantId!,
    branchId || null,
    customerId,
    subject,
    description || '',
    followUpDate || null
  );
  res.json({ ok: true, id });
});

app.patch('/api/crm/complaints/:id', requireAuth, (req: AuthedRequest, res) => {
  const { status } = req.body;
  db.prepare(`UPDATE customer_complaints SET status = ? WHERE id = ? AND tenant_id = ?`).run(status, req.params.id, req.activeTenantId!);
  res.json({ ok: true });
});

// ================= STAFF, FACE ATTENDANCE & PAYROLL =================
app.get('/api/staff/employees', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const rows = db.prepare(`
    SELECT u.id, u.tenant_id, u.branch_id, b.name as branch_name, u.email, u.full_name, u.role, u.phone, u.address,
           u.salary_monthly, u.joining_date, u.monthly_target, u.commission_rate, u.face_enrolled, u.face_consent, u.status,
           COALESCE((SELECT SUM(i.taxable_amount) FROM invoices i WHERE i.salesman_id = u.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'), 0) as achieved_sales
    FROM users u
    LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.tenant_id = ? AND u.role != 'super_admin'
    ORDER BY u.full_name ASC
  `).all(tenantId);
  res.json(rows);
});

app.post('/api/staff/employees', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const { fullName, email, password, role, branchId, phone, address, salaryMonthly, joiningDate, monthlyTarget, commissionRate, pinCode } = req.body;
  if (!fullName || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
  const exists = db.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).get(email);
  if (exists) return res.status(409).json({ error: 'Email already registered' });
  const id = uid('usr');
  db.prepare(`
    INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, phone, address, salary_monthly, joining_date, monthly_target, commission_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.activeTenantId!,
    branchId || null,
    email,
    hashPassword(password),
    fullName,
    role || 'salesman',
    pinCode || '1234',
    phone || '',
    address || '',
    Number(salaryMonthly || 0),
    joiningDate || new Date().toISOString().slice(0, 10),
    Number(monthlyTarget || 0),
    Number(commissionRate || 0)
  );
  res.json({ ok: true, id });
});

app.post('/api/staff/attendance/enroll-face', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { userId, consent, descriptor } = req.body as { userId: string; consent: boolean; descriptor: number[] };
  if (!consent) return res.status(400).json({ error: 'Employee biometric consent is mandatory before enrollment' });
  if (!descriptor || descriptor.length < 16) return res.status(400).json({ error: 'Valid facial descriptor vector required' });

  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`).get(userId, tenantId);
  if (!user) return res.status(404).json({ error: 'Employee not found' });

  db.prepare(`UPDATE users SET face_enrolled = 1, face_consent = 1, face_embedding_enc = ? WHERE id = ? AND tenant_id = ?`).run(
    encryptJson({ vec: descriptor }),
    userId,
    tenantId
  );
  logAudit(tenantId, null, req.session, 'ENROLL_FACE_BIOMETRIC', 'user', userId, { vectorDim: descriptor.length }, req.ip);
  res.json({ ok: true });
});

app.get('/api/staff/attendance', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const rows = db.prepare(`
    SELECT a.*, u.full_name, u.role, b.name as branch_name
    FROM attendance_logs a
    JOIN users u ON u.id = a.user_id
    JOIN branches b ON b.id = a.branch_id
    WHERE a.tenant_id = ?
    ORDER BY a.log_date DESC, a.check_in_time DESC
    LIMIT 100
  `).all(tenantId);
  res.json(rows);
});

app.post('/api/staff/attendance/check', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { userId, branchId, action, method, descriptor, livenessChecks, pinCode, lat, lng } = req.body as {
    userId: string;
    branchId: string;
    action: 'IN' | 'OUT';
    method: 'face_liveness' | 'pin_fallback';
    descriptor?: number[];
    livenessChecks?: { motionDelta: number; luminanceVariance: number; frameCount: number };
    pinCode?: string;
    lat?: number;
    lng?: number;
  };

  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND tenant_id = ?`).get(userId, tenantId) as Record<string, unknown> | undefined;
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  const branch = db.prepare(`SELECT * FROM branches WHERE id = ? AND tenant_id = ?`).get(branchId, tenantId) as Record<string, unknown> | undefined;
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  let livenessScore = 0;
  let faceMatchScore = 0;

  if (method === 'face_liveness') {
    if (!user.face_enrolled || !user.face_embedding_enc) {
      return res.status(400).json({ error: 'Face biometric not enrolled for this employee. Use PIN fallback or enroll first.' });
    }
    const motion = Number(livenessChecks?.motionDelta || 0);
    const lum = Number(livenessChecks?.luminanceVariance || 0);
    // Reject flat static photos with zero motion/micro-luminance delta
    if (motion < 0.015 && lum < 1.5) {
      return res.status(403).json({ error: 'Liveness verification failed: static photo or spoof detected. Blink or turn slightly during capture.' });
    }
    livenessScore = Math.min(0.99, Number((0.82 + Math.min(0.17, motion * 2 + lum * 0.01)).toFixed(2)));
    const stored = decryptJson<{ vec: number[] }>(String(user.face_embedding_enc));
    faceMatchScore = Number(cosineSimilarity(stored.vec || [], descriptor || []).toFixed(3));
    if (faceMatchScore < 0.72) {
      return res.status(403).json({ error: `Face match confidence too low (${(faceMatchScore * 100).toFixed(1)}%). Retry in clear lighting.` });
    }
  } else {
    if (String(user.pin_code) !== String(pinCode)) {
      return res.status(403).json({ error: 'Invalid attendance PIN' });
    }
  }

  let geofenceOk = 1;
  if (lat !== undefined && lng !== undefined) {
    const dist = haversineMeters(lat, lng, Number(branch.lat), Number(branch.lng));
    geofenceOk = dist <= Number(branch.radius_meters || 300) ? 1 : 0;
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toTimeString().slice(0, 5);
  const existing = db.prepare(`SELECT * FROM attendance_logs WHERE tenant_id = ? AND user_id = ? AND log_date = ?`).get(tenantId, userId, today) as
    | Record<string, unknown>
    | undefined;

  if (action === 'IN') {
    if (existing?.check_in_time) {
      return res.status(409).json({ error: `Duplicate IN blocked: already checked in today at ${existing.check_in_time}` });
    }
    const status = nowTime > '09:15' ? 'late' : 'present';
    const id = uid('att');
    db.prepare(`
      INSERT INTO attendance_logs (id, tenant_id, branch_id, user_id, log_date, check_in_time, method, liveness_score, face_match_score, lat, lng, geofence_ok, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, branchId, userId, today, nowTime, method, livenessScore, faceMatchScore, lat ?? null, lng ?? null, geofenceOk, status);

    // Owner notification log
    db.prepare(`INSERT INTO whatsapp_logs (id, tenant_id, branch_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, 'outbound', 'owner_attendance_alert', ?, 'simulated', 1)`).run(
      uid('wa'),
      tenantId,
      branchId,
      String(branch.phone || '+91 98200 00001'),
      `[Attendance IN] ${user.full_name} checked IN at ${branch.name} (${nowTime}) via ${method}. Geofence: ${geofenceOk ? 'OK' : 'OUTSIDE'}.`
    );
    res.json({ ok: true, id, time: nowTime, status, geofenceOk, livenessScore, faceMatchScore });
  } else {
    if (!existing) return res.status(400).json({ error: 'Cannot check OUT before checking IN today' });
    if (existing.check_out_time) return res.status(409).json({ error: `Duplicate OUT blocked: already checked out at ${existing.check_out_time}` });
    const overtimeMins = nowTime > '19:00' ? 45 : 0;
    db.prepare(`UPDATE attendance_logs SET check_out_time = ?, overtime_mins = ? WHERE id = ?`).run(nowTime, overtimeMins, existing.id);
    db.prepare(`INSERT INTO whatsapp_logs (id, tenant_id, branch_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, 'outbound', 'owner_attendance_alert', ?, 'simulated', 1)`).run(
      uid('wa'),
      tenantId,
      branchId,
      String(branch.phone || '+91 98200 00001'),
      `[Attendance OUT] ${user.full_name} checked OUT from ${branch.name} at ${nowTime}. Overtime: ${overtimeMins} mins.`
    );
    res.json({ ok: true, id: existing.id, time: nowTime, overtimeMins });
  }
});

app.post('/api/staff/attendance/correct', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const { attendanceId, checkInTime, checkOutTime, status, reason } = req.body;
  db.prepare(`UPDATE attendance_logs SET check_in_time = COALESCE(?, check_in_time), check_out_time = COALESCE(?, check_out_time), status = COALESCE(?, status), method = 'manual_correction', approved_by = ?, correction_reason = ? WHERE id = ? AND tenant_id = ?`).run(
    checkInTime || null,
    checkOutTime || null,
    status || null,
    req.session!.userId,
    reason || 'Manager approved correction',
    attendanceId,
    req.activeTenantId!
  );
  logAudit(req.activeTenantId!, null, req.session, 'ATTENDANCE_CORRECTION', 'attendance', attendanceId, { checkInTime, checkOutTime, status, reason }, req.ip);
  res.json({ ok: true });
});

app.post('/api/staff/salary-adjustments', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager', 'accountant']), (req: AuthedRequest, res) => {
  const { userId, branchId, amount, type, notes } = req.body;
  const id = uid('sadj');
  db.prepare(`INSERT INTO salary_adjustments (id, tenant_id, branch_id, user_id, amount, type, notes, adj_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?)`).run(
    id,
    req.activeTenantId!,
    branchId || req.session!.branchId,
    userId,
    Number(amount),
    type,
    notes || '',
    req.session!.userId
  );
  res.json({ ok: true, id });
});

app.get('/api/staff/payroll', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const staff = db.prepare(`
    SELECT u.id, u.full_name, u.role, u.salary_monthly, u.joining_date, b.name as branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.tenant_id = ? AND u.role != 'super_admin'
  `).all(tenantId) as Array<{ id: string; full_name: string; role: string; salary_monthly: number; joining_date: string; branch_name: string }>;

  const payroll = staff.map((s) => {
    const att = db.prepare(`SELECT COUNT(*) as present_days, COALESCE(SUM(overtime_mins), 0) as ot_mins, SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days FROM attendance_logs WHERE tenant_id = ? AND user_id = ?`).get(
      tenantId,
      s.id
    ) as { present_days: number; ot_mins: number; late_days: number };
    const adjs = db.prepare(`SELECT * FROM salary_adjustments WHERE tenant_id = ? AND user_id = ?`).all(tenantId, s.id) as Array<{ type: string; amount: number }>;
    const advances = adjs.filter((a) => ['advance', 'loan', 'deduction'].includes(a.type)).reduce((sum, a) => sum + Number(a.amount), 0);
    const bonuses = adjs.filter((a) => a.type === 'bonus').reduce((sum, a) => sum + Number(a.amount), 0);
    const overtimePay = Math.round((s.salary_monthly / 208) * (att.ot_mins / 60) * 1.5);
    const netSalary = Math.max(0, s.salary_monthly + overtimePay + bonuses - advances);
    return {
      ...s,
      present_days: att.present_days,
      late_days: att.late_days || 0,
      overtime_mins: att.ot_mins,
      overtime_pay: overtimePay,
      advances_deductions: advances,
      bonuses,
      net_salary: netSalary,
    };
  });

  res.json(payroll);
});

// ================= META WHATSAPP AUTOMATION =================
app.get('/api/whatsapp/logs', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const logs = db.prepare(`
    SELECT w.*, c.name as customer_name
    FROM whatsapp_logs w LEFT JOIN customers c ON c.id = w.customer_id
    WHERE w.tenant_id = ?
    ORDER BY w.created_at DESC LIMIT 80
  `).all(tenantId);
  const cfgRow = db.prepare(`SELECT status, config_encrypted_json FROM integration_configs WHERE tenant_id = ? AND provider = 'meta_whatsapp'`).get(tenantId) as
    | { status: string; config_encrypted_json: string }
    | undefined;
  const cfg = cfgRow ? decryptJson<Record<string, string>>(cfgRow.config_encrypted_json) : {};
  res.json({
    status: cfgRow?.status || 'not_configured',
    webhookUrl: cfg.webhookUrl || `${process.env.APP_URL || ''}/api/whatsapp/webhook/${tenantId}`,
    logs,
  });
});

app.post('/api/whatsapp/send', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { customerIds, templateName, messageBody, branchId } = req.body as {
    customerIds: string[];
    templateName: string;
    messageBody: string;
    branchId?: string;
  };
  if (!customerIds?.length || !messageBody) return res.status(400).json({ error: 'Recipients and message body required' });

  const cfgRow = db.prepare(`SELECT status FROM integration_configs WHERE tenant_id = ? AND provider = 'meta_whatsapp'`).get(tenantId) as { status: string } | undefined;
  const isConfigured = cfgRow?.status === 'configured';

  let sent = 0, skippedOptOut = 0;
  for (const cid of customerIds) {
    const cust = db.prepare(`SELECT id, name, phone, whatsapp_opt_in FROM customers WHERE id = ? AND tenant_id = ?`).get(cid, tenantId) as
      | { id: string; name: string; phone: string; whatsapp_opt_in: number }
      | undefined;
    if (!cust) continue;
    if (!cust.whatsapp_opt_in) {
      skippedOptOut++;
      continue;
    }
    const personalized = messageBody.replace(/\{\{name\}\}/gi, cust.name);
    db.prepare(`INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo) VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?)`).run(
      uid('wa'),
      tenantId,
      branchId || null,
      cust.id,
      cust.phone,
      templateName || 'approved_utility_template',
      personalized,
      isConfigured ? 'sent' : 'simulated',
      isConfigured ? 0 : 1
    );
    sent++;
  }
  res.json({ ok: true, sent, skippedOptOut, mode: isConfigured ? 'live_meta' : 'demo_simulated' });
});

// ================= AI BRAIN & OWNER ASSISTANT =================
app.get('/api/ai/knowledge', requireAuth, (req: AuthedRequest, res) => {
  res.json(db.prepare(`SELECT * FROM ai_knowledge WHERE tenant_id = ? ORDER BY category, updated_at DESC`).all(req.activeTenantId!));
});

app.post('/api/ai/knowledge', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  const { id, category, title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  if (id) {
    db.prepare(`UPDATE ai_knowledge SET category = ?, title = ?, content = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(
      category,
      title,
      content,
      id,
      req.activeTenantId!
    );
    return res.json({ ok: true, id });
  }
  const newId = uid('kb');
  db.prepare(`INSERT INTO ai_knowledge (id, tenant_id, category, title, content) VALUES (?, ?, ?, ?, ?)`).run(
    newId,
    req.activeTenantId!,
    category || 'faq',
    title,
    content
  );
  res.json({ ok: true, id: newId });
});

app.delete('/api/ai/knowledge/:id', requireAuth, requireRole(['super_admin', 'owner', 'branch_manager']), (req: AuthedRequest, res) => {
  db.prepare(`DELETE FROM ai_knowledge WHERE id = ? AND tenant_id = ?`).run(req.params.id, req.activeTenantId!);
  res.json({ ok: true });
});

app.post('/api/ai/customer-chat', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { message, customerId } = req.body as { message: string; customerId?: string };
    if (!message) return res.status(400).json({ error: 'Message required' });
    const result = await runCustomerEnquiryAi({
      tenantId: req.activeTenantId!,
      verifiedCustomerId: customerId || null,
      message,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'AI Customer Assistant error' });
  }
});

app.post('/api/ai/owner-assistant', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { question } = req.body as { question: string };
    if (!question) return res.status(400).json({ error: 'Question required' });
    const result = await runOwnerAssistantAi({
      tenantId: req.activeTenantId!,
      question,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Owner AI Assistant error' });
  }
});

// ================= REPORTS & EXCEL EXPORT =================
app.get('/api/reports/summary', requireAuth, (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const branchId = req.query.branchId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  const invClauses = [`i.tenant_id = ?`, `i.is_cancelled = 0`, `i.doc_type = 'invoice'`];
  const args: unknown[] = [tenantId];
  if (branchId && branchId !== 'all') {
    invClauses.push(`i.branch_id = ?`);
    args.push(branchId);
  }
  if (dateFrom) {
    invClauses.push(`date(i.created_at) >= date(?)`);
    args.push(dateFrom);
  }
  if (dateTo) {
    invClauses.push(`date(i.created_at) <= date(?)`);
    args.push(dateTo);
  }
  const whereInv = invClauses.join(' AND ');

  const gstr1 = db.prepare(`
    SELECT i.invoice_no, date(i.created_at) as inv_date, b.name as branch_name, COALESCE(c.name, 'Walk-in') as customer_name,
           COALESCE(c.gstin, 'URP') as customer_gstin, i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount
    FROM invoices i JOIN branches b ON b.id = i.branch_id LEFT JOIN customers c ON c.id = i.customer_id
    WHERE ${whereInv} ORDER BY i.created_at DESC
  `).all(...args);

  const productProfit = db.prepare(`
    SELECT ii.sku, ii.product_name, SUM(ii.qty) as qty_sold, SUM(ii.taxable_value) as sales_val,
           SUM(ii.qty * ii.purchase_cost) as cogs_val,
           SUM(ii.taxable_value - (ii.qty * ii.purchase_cost)) as gross_profit
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    WHERE ${whereInv}
    GROUP BY ii.product_id ORDER BY sales_val DESC
  `).all(...args);

  const stockValuation = db.prepare(`
    SELECT b.name as branch_name, p.sku, p.name, p.category_name, bs.qty_available, bs.qty_damaged, bs.qty_dead,
           (bs.qty_available * p.purchase_price) as cost_valuation,
           (bs.qty_available * p.selling_price) as retail_valuation
    FROM branch_stock bs JOIN products p ON p.id = bs.product_id JOIN branches b ON b.id = bs.branch_id
    WHERE bs.tenant_id = ? AND p.is_deleted = 0 ${branchId && branchId !== 'all' ? 'AND bs.branch_id = ?' : ''}
    ORDER BY cost_valuation DESC
  `).all(...(branchId && branchId !== 'all' ? [tenantId, branchId] : [tenantId]));

  res.json({ gstr1, productProfit, stockValuation });
});

app.get('/api/reports/export/excel', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const reportType = (req.query.type as ReportType) || 'stock_valuation';
    const branchId = req.query.branchId as string | undefined;
    const startDate = req.query.dateFrom as string | undefined;
    const endDate = req.query.dateTo as string | undefined;

    const { buffer, filename } = await buildExcelReport({
      tenantId: req.activeTenantId!,
      branchId,
      startDate,
      endDate,
      reportType,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Excel export failed' });
  }
});

// ================= SETTINGS, INTEGRATIONS & SECURITY BACKUP =================
app.patch('/api/settings/tenant', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const { name, legalName, gstin, address, phone, email, currency, currencySymbol, branding, config } = req.body;
  const curr = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenantId) as Record<string, unknown>;
  const mergedBranding = { ...JSON.parse(String(curr.branding_json || '{}')), ...(branding || {}) };
  const mergedConfig = { ...JSON.parse(String(curr.config_json || '{}')), ...(config || {}) };

  db.prepare(`
    UPDATE tenants
    SET name = COALESCE(?, name),
        legal_name = COALESCE(?, legal_name),
        gstin = COALESCE(?, gstin),
        address = COALESCE(?, address),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        currency = COALESCE(?, currency),
        currency_symbol = COALESCE(?, currency_symbol),
        branding_json = ?,
        config_json = ?
    WHERE id = ?
  `).run(
    name ?? null,
    legalName ?? null,
    gstin ?? null,
    address ?? null,
    phone ?? null,
    email ?? null,
    currency ?? null,
    currencySymbol ?? null,
    JSON.stringify(mergedBranding),
    JSON.stringify(mergedConfig),
    tenantId
  );

  logAudit(tenantId, null, req.session, 'UPDATE_TENANT_SETTINGS', 'tenant', tenantId, { name, currency }, req.ip);
  res.json({ ok: true });
});

app.get('/api/settings/integrations', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const rows = db.prepare(`SELECT * FROM integration_configs WHERE tenant_id = ?`).all(req.activeTenantId!) as Array<{
    id: string;
    provider: string;
    config_encrypted_json: string;
    status: string;
    last_tested_at: string | null;
    updated_at: string;
  }>;

  res.json(
    rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      status: r.status,
      last_tested_at: r.last_tested_at,
      updated_at: r.updated_at,
      config: maskSecrets(decryptJson<Record<string, unknown>>(r.config_encrypted_json)),
    }))
  );
});

app.put('/api/settings/integrations/:provider', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const provider = req.params.provider;
  const incoming = req.body.config as Record<string, unknown>;

  const existingRow = db.prepare(`SELECT config_encrypted_json FROM integration_configs WHERE tenant_id = ? AND provider = ?`).get(
    tenantId,
    provider
  ) as { config_encrypted_json: string } | undefined;

  const existingDecrypted = existingRow ? decryptJson<Record<string, unknown>>(existingRow.config_encrypted_json) : {};
  const merged = mergeMaskedConfig(existingDecrypted, incoming || {});
  const hasValues = Object.values(merged).some((v) => typeof v === 'string' && v.trim().length > 0);
  const status = hasValues ? 'configured' : 'not_configured';

  db.prepare(`
    INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, provider) DO UPDATE SET config_encrypted_json = excluded.config_encrypted_json, status = excluded.status, updated_at = datetime('now')
  `).run(uid('int'), tenantId, provider, encryptJson(merged), status);

  logAudit(tenantId, null, req.session, 'UPDATE_INTEGRATION', 'integration', provider, { status }, req.ip);
  res.json({ ok: true, status, config: maskSecrets(merged) });
});

app.post('/api/settings/integrations/:provider/test', requireAuth, requireRole(['super_admin', 'owner']), async (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const provider = req.params.provider;
  const row = db.prepare(`SELECT config_encrypted_json, status FROM integration_configs WHERE tenant_id = ? AND provider = ?`).get(tenantId, provider) as
    | { config_encrypted_json: string; status: string }
    | undefined;
  const cfg = row ? decryptJson<Record<string, string>>(row.config_encrypted_json) : {};

  let ok = false;
  let message = 'Integration is not configured.';

  if (provider === 'database') {
    ok = true;
    message = 'Transactional SQL database (WAL mode) active and healthy.';
  } else if (provider === 'ai_provider') {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
      ok = true;
      message = `Gemini AI server adapter ready (Model: ${cfg.model || 'gemini-4-hydrogen'}).`;
    } else {
      message = 'GEMINI_API_KEY is not injected in server environment; using grounded deterministic fallback.';
    }
  } else if (provider === 'meta_whatsapp') {
    if (cfg.phoneNumberId && cfg.accessToken) {
      ok = true;
      message = `Meta Cloud API credentials present for Phone ID ${cfg.phoneNumberId} (${cfg.apiVersion || 'v21.0'}).`;
    } else {
      message = 'Missing Phone Number ID or Access Token. Demo simulator mode remains active.';
    }
  } else if (provider === 'firebase') {
    if (cfg.projectId && cfg.apiKey) {
      ok = true;
      message = `Firebase adapter configured for project ${cfg.projectId}.`;
    } else {
      message = 'Firebase Project ID and API Key not configured yet.';
    }
  }

  db.prepare(`UPDATE integration_configs SET last_tested_at = datetime('now') WHERE tenant_id = ? AND provider = ?`).run(tenantId, provider);
  res.json({ ok, message });
});

app.delete('/api/settings/integrations/:provider', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  db.prepare(`UPDATE integration_configs SET config_encrypted_json = ?, status = 'not_configured', updated_at = datetime('now') WHERE tenant_id = ? AND provider = ?`).run(
    encryptJson({}),
    tenantId,
    req.params.provider
  );
  res.json({ ok: true });
});

app.get('/api/security/audit-logs', requireAuth, requireRole(['super_admin', 'owner', 'accountant']), (req: AuthedRequest, res) => {
  res.json(db.prepare(`SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`).all(req.activeTenantId!));
});

app.get('/api/security/backup', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const tenantId = req.activeTenantId!;
  const backup = {
    exportedAt: new Date().toISOString(),
    tenantId,
    tenant: db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenantId),
    branches: db.prepare(`SELECT * FROM branches WHERE tenant_id = ?`).all(tenantId),
    products: db.prepare(`SELECT * FROM products WHERE tenant_id = ?`).all(tenantId),
    branch_stock: db.prepare(`SELECT * FROM branch_stock WHERE tenant_id = ?`).all(tenantId),
    customers: db.prepare(`SELECT * FROM customers WHERE tenant_id = ?`).all(tenantId),
    suppliers: db.prepare(`SELECT * FROM suppliers WHERE tenant_id = ?`).all(tenantId),
    invoices: db.prepare(`SELECT * FROM invoices WHERE tenant_id = ?`).all(tenantId),
    expenses: db.prepare(`SELECT * FROM expenses WHERE tenant_id = ?`).all(tenantId),
    ai_knowledge: db.prepare(`SELECT * FROM ai_knowledge WHERE tenant_id = ?`).all(tenantId),
  };
  logAudit(tenantId, null, req.session, 'EXPORT_BACKUP', 'tenant', tenantId, { size: JSON.stringify(backup).length }, req.ip);
  res.setHeader('Content-Disposition', `attachment; filename="titangrid_backup_${tenantId}_${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
});

app.get('/api/security/export-source', requireAuth, requireRole(['super_admin', 'owner']), (req: AuthedRequest, res) => {
  const { buffer, fileCount } = buildCleanSourceZip(process.cwd());
  logAudit(req.activeTenantId!, null, req.session, 'EXPORT_SOURCE_ZIP', 'system', 'source_bundle', { fileCount, bytes: buffer.length }, req.ip);
  const filename = `rinku_erp_source_${new Date().toISOString().slice(0, 10)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
});

// ================= SERVE FRONTEND (VITE DEV OR DIST PROD) =================
async function startServer() {
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TitanGrid Retail ERP running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
