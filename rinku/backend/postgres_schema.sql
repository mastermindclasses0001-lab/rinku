-- TitanGrid Retail ERP — Production PostgreSQL Schema with Row-Level Tenant Isolation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  gstin TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  plan TEXT NOT NULL DEFAULT 'enterprise',
  status TEXT NOT NULL DEFAULT 'active',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  branding_json JSONB NOT NULL DEFAULT '{}',
  config_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  state_code TEXT NOT NULL DEFAULT '27',
  gstin TEXT,
  phone TEXT,
  lat DOUBLE PRECISION NOT NULL DEFAULT 19.0760,
  lng DOUBLE PRECISION NOT NULL DEFAULT 72.8777,
  radius_meters INTEGER NOT NULL DEFAULT 300,
  is_headquarters BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_code TEXT,
  phone TEXT,
  salary_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  joining_date DATE,
  monthly_target NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  face_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
  face_consent BOOLEAN NOT NULL DEFAULT FALSE,
  face_embedding_enc TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  subcategory TEXT,
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  hsn_code TEXT NOT NULL,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  unit TEXT NOT NULL,
  base_unit TEXT NOT NULL,
  conversion_factor NUMERIC(10,3) NOT NULL DEFAULT 1,
  box_coverage_sqft NUMERIC(10,3),
  shade TEXT,
  batch_no TEXT,
  lot_no TEXT,
  exp_date DATE,
  purchase_price NUMERIC(12,2) NOT NULL,
  mrp NUMERIC(12,2) NOT NULL,
  selling_price NUMERIC(12,2) NOT NULL,
  min_stock NUMERIC(10,2) NOT NULL DEFAULT 10,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE branch_stock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_available NUMERIC(12,3) NOT NULL DEFAULT 0,
  qty_damaged NUMERIC(12,3) NOT NULL DEFAULT 0,
  qty_dead NUMERIC(12,3) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(branch_id, product_id)
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  gstin TEXT,
  state_code TEXT NOT NULL DEFAULT '27',
  segment TEXT NOT NULL DEFAULT 'retail',
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 50000,
  outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  due_date DATE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  invoice_no TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'invoice',
  customer_id UUID REFERENCES customers(id),
  salesman_id UUID REFERENCES users(id),
  subtotal NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable_amount NUMERIC(12,2) NOT NULL,
  cgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  payment_breakdown_json JSONB NOT NULL DEFAULT '{}',
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable PostgreSQL Row-Level Security for strict database-level tenant isolation
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_branches ON branches USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_products ON products USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_invoices ON invoices USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
