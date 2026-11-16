export type UserRole = 'super_admin' | 'owner' | 'branch_manager' | 'cashier' | 'salesman' | 'accountant';

export interface SessionUser {
  userId: string;
  tenantId: string;
  branchId: string | null;
  role: UserRole;
  email: string;
  fullName: string;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  legal_name: string;
  gstin: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  currency_symbol: string;
  plan: string;
  status: string;
  is_demo: number;
  branding: {
    accent?: string;
    invoiceFooter?: string;
    financialYear?: string;
    language?: string;
  };
  config: {
    reminderTime?: string;
    allowNegativeStock?: boolean;
    maxCashierDiscountPct?: number;
    stateCode?: string;
  };
}

export interface Branch {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  state_code: string;
  gstin: string;
  phone: string;
  lat: number;
  lng: number;
  radius_meters: number;
  is_headquarters: number;
  status: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  category_name: string;
  subcategory: string;
  sku: string;
  barcode: string;
  qr_code: string;
  name: string;
  brand: string;
  hsn_code: string;
  gst_rate: number;
  tax_inclusive: number;
  unit: string;
  base_unit: string;
  conversion_factor: number;
  box_coverage_sqft: number | null;
  shade: string | null;
  batch_no: string | null;
  lot_no: string | null;
  color_code: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  purchase_price: number;
  mrp: number;
  selling_price: number;
  min_stock: number;
  image_url: string;
  qty_available: number;
  qty_damaged: number;
  qty_dead: number;
  branch_stocks?: Array<{ branch_id: string; branch_name: string; branch_code: string; qty_available: number; qty_damaged: number; qty_dead: number }>;
}

export interface Customer {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  state_code: string;
  gstin: string;
  segment: 'retail' | 'contractor' | 'builder' | 'architect';
  credit_limit: number;
  outstanding_balance: number;
  whatsapp_opt_in: number;
  due_date: string | null;
  notes: string;
  invoice_count?: number;
  lifetime_value?: number;
}

export interface InvoiceItem {
  id?: string;
  product_id: string;
  sku: string;
  product_name: string;
  hsn_code: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount_pct: number;
  gst_rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  doc_type: 'invoice' | 'quotation' | 'challan' | 'credit_note';
  branch_id: string;
  branch_name: string;
  branch_address?: string;
  branch_gstin?: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_gstin?: string | null;
  salesman_name?: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  payment_status: string;
  payment_breakdown: { cash?: number; upi?: number; card?: number; bank?: number };
  due_date: string | null;
  is_cancelled: number;
  cancel_reason?: string;
  created_at: string;
  items: InvoiceItem[];
}

export type NavSection =
  | 'dashboard'
  | 'pos'
  | 'inventory'
  | 'accounts'
  | 'crm'
  | 'staff'
  | 'ai_brain'
  | 'reports'
  | 'settings'
  | 'super_admin';
