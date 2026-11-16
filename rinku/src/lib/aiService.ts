import { GoogleGenAI } from '@google/genai';
import { db } from '../db/database.ts';
import { decryptJson } from './crypto.ts';

interface AiConfig {
  provider?: string;
  model?: string;
  systemInstruction?: string;
}

export function getAiClientForTenant(tenantId: string): { ai: GoogleGenAI | null; model: string; systemInstruction: string } {
  const row = db
    .prepare(`SELECT config_encrypted_json, status FROM integration_configs WHERE tenant_id = ? AND provider = 'ai_provider'`)
    .get(tenantId) as { config_encrypted_json: string; status: string } | undefined;

  const cfg = row ? decryptJson<AiConfig>(row.config_encrypted_json) : {};
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      ai: null,
      model: cfg.model || 'gemini-4-hydrogen',
      systemInstruction: cfg.systemInstruction || '',
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return {
    ai,
    model: cfg.model || 'gemini-4-hydrogen',
    systemInstruction: cfg.systemInstruction || '',
  };
}

export async function runCustomerEnquiryAi(params: {
  tenantId: string;
  customerPhone?: string;
  verifiedCustomerId?: string | null;
  message: string;
}): Promise<{ reply: string; escalated: boolean; source: 'gemini' | 'deterministic_fallback' }> {
  const { tenantId, verifiedCustomerId, message } = params;

  const tenant = db.prepare(`SELECT name, currency_symbol, address, phone FROM tenants WHERE id = ?`).get(tenantId) as {
    name: string;
    currency_symbol: string;
    address: string;
    phone: string;
  };
  const branches = db.prepare(`SELECT id, name, city, phone FROM branches WHERE tenant_id = ? AND status = 'active'`).all(tenantId);
  const knowledge = db.prepare(`SELECT category, title, content FROM ai_knowledge WHERE tenant_id = ?`).all(tenantId) as Array<{
    category: string;
    title: string;
    content: string;
  }>;

  const products = db
    .prepare(`
      SELECT p.sku, p.name, p.category_name, p.brand, p.unit, p.base_unit, p.conversion_factor, p.box_coverage_sqft,
             p.shade, p.batch_no, p.selling_price, p.mrp, p.gst_rate,
             COALESCE(SUM(bs.qty_available), 0) as total_stock
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id
      WHERE p.tenant_id = ? AND p.is_deleted = 0 AND p.is_active = 1
      GROUP BY p.id
      LIMIT 40
    `)
    .all(tenantId) as Array<Record<string, unknown>>;

  let customerContext = 'Customer identity not verified for account balance lookup.';
  if (verifiedCustomerId) {
    const cust = db
      .prepare(`SELECT name, segment, outstanding_balance, credit_limit, due_date FROM customers WHERE id = ? AND tenant_id = ?`)
      .get(verifiedCustomerId, tenantId) as Record<string, unknown> | undefined;
    if (cust) {
      customerContext = `Verified Customer: ${cust.name} (${cust.segment}). Outstanding Balance: ${tenant.currency_symbol}${cust.outstanding_balance}, Due Date: ${cust.due_date || 'None'}.`;
    }
  }

  const lower = message.toLowerCase();
  const needsEscalation =
    lower.includes('complaint') ||
    lower.includes('broken') ||
    lower.includes('legal') ||
    lower.includes('refund') ||
    lower.includes('manager') ||
    lower.includes('angry');

  const { ai, model, systemInstruction } = getAiClientForTenant(tenantId);

  if (!ai) {
    // Grounded deterministic fallback when GEMINI_API_KEY is not configured in environment
    const matched = products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(lower) ||
        String(p.category_name).toLowerCase().includes(lower) ||
        String(p.sku).toLowerCase().includes(lower) ||
        (lower.includes('tile') && String(p.category_name).toLowerCase() === 'tiles') ||
        (lower.includes('paint') && String(p.category_name).toLowerCase() === 'paint') ||
        (lower.includes('faucet') && String(p.category_name).toLowerCase() === 'sanitaryware') ||
        (lower.includes('lock') && String(p.category_name).toLowerCase() === 'hardware')
    );

    if (needsEscalation) {
      return {
        reply: `I have logged your concern for priority review and am transferring this conversation to our branch specialist at ${tenant.name} (${tenant.phone}).`,
        escalated: true,
        source: 'deterministic_fallback',
      };
    }

    if (matched.length > 0) {
      const lines = matched.slice(0, 3).map(
        (p) =>
          `• ${p.name} (SKU: ${p.sku}) — ${tenant.currency_symbol}${p.selling_price}/${p.unit} + ${p.gst_rate}% GST · In stock: ${p.total_stock} ${p.unit}s`
      );
      return {
        reply: `Here are verified in-stock items from ${tenant.name}:\n${lines.join('\n')}\n\n${verifiedCustomerId ? customerContext : 'Reply with your registered phone number to check invoice dues.'}`,
        escalated: false,
        source: 'deterministic_fallback',
      };
    }

    return {
      reply: `Welcome to ${tenant.name}. We carry Tiles, Paint, Sanitaryware & Hardware across ${branches.length} branches. Ask about any SKU, tile box coverage, paint shades, or delivery policy!`,
      escalated: false,
      source: 'deterministic_fallback',
    };
  }

  const prompt = `
Business: ${tenant.name} (${tenant.address}, Phone: ${tenant.phone}, Currency: ${tenant.currency_symbol})
Branches: ${JSON.stringify(branches)}
Verified Knowledge Base: ${JSON.stringify(knowledge)}
Live Inventory & Pricing: ${JSON.stringify(products)}
Customer Context: ${customerContext}

Customer WhatsApp Message: "${message}"

Rules:
1. NEVER invent stock quantities, prices, discounts, or policies not present in the Live Inventory or Knowledge Base above.
2. Quote exact prices with GST rate and box coverage/unit conversion when recommending tiles or paint.
3. If the customer asks for dues/orders and identity is NOT verified, politely ask for verification instead of revealing private data.
4. If the query is a serious complaint, dispute, or custom bulk negotiation beyond policy, clearly state you are escalating to human staff and include [ESCALATE] at the end.
5. Keep reply concise, warm, and WhatsApp-friendly.
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        systemInstruction ||
        `You are the official customer WhatsApp sales & support specialist for ${tenant.name}. Be accurate, concise, and strictly grounded in database records.`,
    },
  });

  const text = (response.text || '').trim();
  const escalated = text.includes('[ESCALATE]') || needsEscalation;
  return {
    reply: text.replace('[ESCALATE]', '').trim(),
    escalated,
    source: 'gemini',
  };
}

export async function runOwnerAssistantAi(params: {
  tenantId: string;
  question: string;
}): Promise<{ answer: string; requiresConfirmation: boolean; source: 'gemini' | 'deterministic_fallback' }> {
  const { tenantId, question } = params;

  const tenant = db.prepare(`SELECT name, currency_symbol FROM tenants WHERE id = ?`).get(tenantId) as {
    name: string;
    currency_symbol: string;
  };
  const salesSummary = db
    .prepare(`
      SELECT b.name as branch_name,
             COUNT(i.id) as invoice_count,
             COALESCE(SUM(i.total_amount), 0) as total_sales,
             COALESCE(SUM(i.due_amount), 0) as total_due
      FROM branches b
      LEFT JOIN invoices i ON i.branch_id = b.id AND i.is_cancelled = 0 AND i.doc_type = 'invoice'
      WHERE b.tenant_id = ?
      GROUP BY b.id
    `)
    .all(tenantId) as Array<Record<string, unknown>>;

  const lowStock = db
    .prepare(`
      SELECT p.name, p.sku, b.name as branch_name, bs.qty_available, p.min_stock
      FROM branch_stock bs
      JOIN products p ON p.id = bs.product_id
      JOIN branches b ON b.id = bs.branch_id
      WHERE bs.tenant_id = ? AND p.is_deleted = 0 AND bs.qty_available <= p.min_stock
      LIMIT 15
    `)
    .all(tenantId) as Array<Record<string, unknown>>;

  const overdueCustomers = db
    .prepare(`
      SELECT name, phone, segment, outstanding_balance, due_date
      FROM customers
      WHERE tenant_id = ? AND is_deleted = 0 AND outstanding_balance > 0
      ORDER BY outstanding_balance DESC
      LIMIT 10
    `)
    .all(tenantId) as Array<Record<string, unknown>>;

  const expenses = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE tenant_id = ? AND is_deleted = 0`)
    .get(tenantId) as { total_expenses: number };

  const lower = question.toLowerCase();
  const destructiveIntent =
    lower.includes('delete') ||
    lower.includes('cancel') ||
    lower.includes('write off') ||
    lower.includes('transfer') ||
    lower.includes('pay');

  const { ai, model } = getAiClientForTenant(tenantId);
  if (!ai) {
    const totalSales = salesSummary.reduce((acc, r) => acc + Number(r.total_sales || 0), 0);
    const totalDue = salesSummary.reduce((acc, r) => acc + Number(r.total_due || 0), 0);
    return {
      answer: `${tenant.name} Live Snapshot (${tenant.currency_symbol}): Total Sales ${tenant.currency_symbol}${totalSales.toLocaleString()} · Receivable Dues ${tenant.currency_symbol}${totalDue.toLocaleString()} · Recorded Expenses ${tenant.currency_symbol}${expenses.total_expenses.toLocaleString()} · ${lowStock.length} low-stock branch alerts. Top overdue: ${overdueCustomers[0]?.name || 'None'}.`,
      requiresConfirmation: destructiveIntent,
      source: 'deterministic_fallback',
    };
  }

  const response = await ai.models.generateContent({
    model,
    contents: `
Owner Question: "${question}"
Tenant: ${tenant.name} (Currency: ${tenant.currency_symbol})
Branch Sales Summary: ${JSON.stringify(salesSummary)}
Low Stock Alerts: ${JSON.stringify(lowStock)}
Overdue Customer Receivables: ${JSON.stringify(overdueCustomers)}
Total Expenses: ${expenses.total_expenses}

Provide a sharp, executive, numbers-first answer strictly from this live data. If the owner asks to execute a financial or destructive change (cancel invoice, write-off debt, transfer funds), explain the exact impact and require explicit UI confirmation before execution.
`,
    config: {
      systemInstruction: 'You are an executive CFO & Retail Operations AI Assistant. Be concise, quantitative, and strictly factual.',
    },
  });

  return {
    answer: (response.text || 'Unable to generate summary right now.').trim(),
    requiresConfirmation: destructiveIntent,
    source: 'gemini',
  };
}
