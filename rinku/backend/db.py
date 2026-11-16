import json
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator

from security import encrypt_json, hash_password

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "erp.db")
DB_PATH = os.environ.get("SQLITE_DB_PATH") or DEFAULT_DB_PATH


def _ensure_db_dir():
    parent = os.path.dirname(os.path.abspath(DB_PATH))
    if parent:
        os.makedirs(parent, exist_ok=True)


def create_connection() -> sqlite3.Connection:
    _ensure_db_dir()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    conn = create_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def rows_to_dicts(rows) -> list:
    return [dict(r) for r in rows]


def row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


def init_database():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tenants (
              id TEXT PRIMARY KEY,
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
              is_demo INTEGER NOT NULL DEFAULT 0,
              branding_json TEXT NOT NULL DEFAULT '{}',
              config_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS branches (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              code TEXT NOT NULL,
              name TEXT NOT NULL,
              address TEXT NOT NULL,
              city TEXT NOT NULL,
              state TEXT NOT NULL,
              state_code TEXT NOT NULL DEFAULT '27',
              gstin TEXT,
              phone TEXT,
              lat REAL NOT NULL DEFAULT 19.0760,
              lng REAL NOT NULL DEFAULT 72.8777,
              radius_meters INTEGER NOT NULL DEFAULT 250,
              is_headquarters INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'active',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
              email TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              full_name TEXT NOT NULL,
              role TEXT NOT NULL,
              pin_code TEXT,
              phone TEXT,
              address TEXT,
              salary_monthly REAL NOT NULL DEFAULT 0,
              joining_date TEXT,
              monthly_target REAL NOT NULL DEFAULT 0,
              commission_rate REAL NOT NULL DEFAULT 0,
              face_enrolled INTEGER NOT NULL DEFAULT 0,
              face_consent INTEGER NOT NULL DEFAULT 0,
              face_embedding_enc TEXT,
              status TEXT NOT NULL DEFAULT 'active',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS categories (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              slug TEXT NOT NULL,
              parent_id TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS products (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
              category_name TEXT NOT NULL,
              subcategory TEXT,
              sku TEXT NOT NULL,
              barcode TEXT,
              qr_code TEXT,
              name TEXT NOT NULL,
              brand TEXT,
              hsn_code TEXT NOT NULL DEFAULT '6907',
              gst_rate REAL NOT NULL DEFAULT 18,
              tax_inclusive INTEGER NOT NULL DEFAULT 0,
              unit TEXT NOT NULL DEFAULT 'Box',
              base_unit TEXT NOT NULL DEFAULT 'Sq Ft',
              conversion_factor REAL NOT NULL DEFAULT 1,
              box_coverage_sqft REAL,
              shade TEXT,
              batch_no TEXT,
              lot_no TEXT,
              color_code TEXT,
              mfg_date TEXT,
              exp_date TEXT,
              purchase_price REAL NOT NULL,
              mrp REAL NOT NULL,
              selling_price REAL NOT NULL,
              min_stock REAL NOT NULL DEFAULT 10,
              image_url TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              is_deleted INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS branch_stock (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
              product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              qty_available REAL NOT NULL DEFAULT 0,
              qty_damaged REAL NOT NULL DEFAULT 0,
              qty_dead REAL NOT NULL DEFAULT 0,
              last_updated TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(branch_id, product_id)
            );

            CREATE TABLE IF NOT EXISTS stock_movements (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
              product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              movement_type TEXT NOT NULL,
              qty_delta REAL NOT NULL,
              reference_type TEXT,
              reference_id TEXT,
              unit_cost REAL NOT NULL DEFAULT 0,
              notes TEXT,
              created_by TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS stock_transfers (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              transfer_no TEXT NOT NULL,
              from_branch_id TEXT NOT NULL REFERENCES branches(id),
              to_branch_id TEXT NOT NULL REFERENCES branches(id),
              status TEXT NOT NULL DEFAULT 'dispatched',
              notes TEXT,
              dispatched_by TEXT,
              received_by TEXT,
              dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
              received_at TEXT
            );

            CREATE TABLE IF NOT EXISTS stock_transfer_items (
              id TEXT PRIMARY KEY,
              transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
              product_id TEXT NOT NULL REFERENCES products(id),
              qty_sent REAL NOT NULL,
              qty_received REAL NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS suppliers (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              gstin TEXT,
              phone TEXT,
              email TEXT,
              address TEXT,
              balance_payable REAL NOT NULL DEFAULT 0,
              is_deleted INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS purchase_orders (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              supplier_id TEXT NOT NULL REFERENCES suppliers(id),
              po_no TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'ordered',
              subtotal REAL NOT NULL DEFAULT 0,
              gst_amount REAL NOT NULL DEFAULT 0,
              total_amount REAL NOT NULL DEFAULT 0,
              paid_amount REAL NOT NULL DEFAULT 0,
              notes TEXT,
              created_by TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS purchase_order_items (
              id TEXT PRIMARY KEY,
              po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
              product_id TEXT NOT NULL REFERENCES products(id),
              qty REAL NOT NULL,
              unit_cost REAL NOT NULL,
              gst_rate REAL NOT NULL DEFAULT 18,
              total_cost REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS customers (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT REFERENCES branches(id),
              name TEXT NOT NULL,
              phone TEXT NOT NULL,
              email TEXT,
              address TEXT,
              state_code TEXT NOT NULL DEFAULT '27',
              gstin TEXT,
              segment TEXT NOT NULL DEFAULT 'retail',
              credit_limit REAL NOT NULL DEFAULT 50000,
              outstanding_balance REAL NOT NULL DEFAULT 0,
              whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
              due_date TEXT,
              notes TEXT,
              is_deleted INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS invoices (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              invoice_no TEXT NOT NULL,
              doc_type TEXT NOT NULL DEFAULT 'invoice',
              customer_id TEXT REFERENCES customers(id),
              salesman_id TEXT REFERENCES users(id),
              cashier_id TEXT REFERENCES users(id),
              subtotal REAL NOT NULL,
              discount_amount REAL NOT NULL DEFAULT 0,
              taxable_amount REAL NOT NULL,
              cgst_amount REAL NOT NULL DEFAULT 0,
              sgst_amount REAL NOT NULL DEFAULT 0,
              igst_amount REAL NOT NULL DEFAULT 0,
              total_amount REAL NOT NULL,
              paid_amount REAL NOT NULL DEFAULT 0,
              due_amount REAL NOT NULL DEFAULT 0,
              payment_status TEXT NOT NULL DEFAULT 'paid',
              payment_breakdown_json TEXT NOT NULL DEFAULT '{}',
              due_date TEXT,
              notes TEXT,
              idempotency_key TEXT,
              is_cancelled INTEGER NOT NULL DEFAULT 0,
              cancel_reason TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS invoice_items (
              id TEXT PRIMARY KEY,
              invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
              product_id TEXT NOT NULL REFERENCES products(id),
              sku TEXT NOT NULL,
              product_name TEXT NOT NULL,
              hsn_code TEXT NOT NULL,
              qty REAL NOT NULL,
              unit TEXT NOT NULL,
              unit_price REAL NOT NULL,
              purchase_cost REAL NOT NULL,
              discount_pct REAL NOT NULL DEFAULT 0,
              gst_rate REAL NOT NULL,
              taxable_value REAL NOT NULL,
              cgst REAL NOT NULL DEFAULT 0,
              sgst REAL NOT NULL DEFAULT 0,
              igst REAL NOT NULL DEFAULT 0,
              total REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payments (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              party_type TEXT NOT NULL,
              party_id TEXT NOT NULL,
              invoice_id TEXT,
              amount REAL NOT NULL,
              mode TEXT NOT NULL,
              reference_no TEXT,
              status TEXT NOT NULL DEFAULT 'verified',
              notes TEXT,
              verified_by TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS expenses (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              category TEXT NOT NULL,
              description TEXT NOT NULL,
              amount REAL NOT NULL,
              payment_mode TEXT NOT NULL DEFAULT 'cash',
              vendor_name TEXT,
              expense_date TEXT NOT NULL,
              created_by TEXT,
              is_deleted INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS cash_closings (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              closing_date TEXT NOT NULL,
              opening_cash REAL NOT NULL,
              cash_sales REAL NOT NULL,
              cash_receipts REAL NOT NULL,
              cash_expenses REAL NOT NULL,
              expected_cash REAL NOT NULL,
              actual_cash REAL NOT NULL,
              discrepancy REAL NOT NULL,
              notes TEXT,
              closed_by TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS attendance_logs (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              user_id TEXT NOT NULL REFERENCES users(id),
              log_date TEXT NOT NULL,
              check_in_time TEXT,
              check_out_time TEXT,
              method TEXT NOT NULL,
              liveness_score REAL DEFAULT 0,
              face_match_score REAL DEFAULT 0,
              lat REAL,
              lng REAL,
              geofence_ok INTEGER NOT NULL DEFAULT 1,
              status TEXT NOT NULL DEFAULT 'present',
              overtime_mins INTEGER NOT NULL DEFAULT 0,
              approved_by TEXT,
              correction_reason TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS salary_adjustments (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT NOT NULL REFERENCES branches(id),
              user_id TEXT NOT NULL REFERENCES users(id),
              amount REAL NOT NULL,
              type TEXT NOT NULL,
              notes TEXT,
              adj_date TEXT NOT NULL,
              created_by TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS whatsapp_logs (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT,
              customer_id TEXT,
              phone TEXT NOT NULL,
              direction TEXT NOT NULL DEFAULT 'outbound',
              template_name TEXT,
              message_body TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'simulated',
              is_demo INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS ai_knowledge (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              category TEXT NOT NULL,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS integration_configs (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              provider TEXT NOT NULL,
              config_encrypted_json TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'not_configured',
              last_tested_at TEXT,
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(tenant_id, provider)
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL,
              branch_id TEXT,
              user_id TEXT,
              user_name TEXT,
              action TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT,
              details_json TEXT,
              ip_address TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS login_history (
              id TEXT PRIMARY KEY,
              tenant_id TEXT,
              user_id TEXT,
              email TEXT NOT NULL,
              role TEXT,
              success INTEGER NOT NULL,
              ip_address TEXT,
              user_agent TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS customer_complaints (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
              branch_id TEXT REFERENCES branches(id),
              customer_id TEXT NOT NULL REFERENCES customers(id),
              subject TEXT NOT NULL,
              description TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'open',
              assigned_to TEXT,
              follow_up_date TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id, is_deleted);
            CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date ON invoices(tenant_id, branch_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id, is_deleted);
            CREATE INDEX IF NOT EXISTS idx_stock_tenant_branch ON branch_stock(tenant_id, branch_id);
            CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON attendance_logs(tenant_id, log_date);
            """
        )

        row = conn.execute("SELECT COUNT(*) as c FROM tenants").fetchone()
        if row["c"] == 0:
            _seed_initial_demo_data(conn)


def _seed_initial_demo_data(conn: sqlite3.Connection):
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    two_days_ago = (now - timedelta(days=2)).strftime("%Y-%m-%d")
    next_week = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    conn.execute(
        """
        INSERT INTO tenants (id, slug, name, legal_name, gstin, address, phone, email, currency, currency_symbol, plan, status, is_demo, branding_json, config_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "ten_vanguard",
            "vanguard-ceramics",
            "Vanguard Ceramics & Hardware",
            "Vanguard Building Materials Pvt. Ltd.",
            "27AABCV4821F1Z5",
            "Plot 42, Marol Industrial Estate, Andheri East, Mumbai 400059",
            "+91 22 4890 2210",
            "billing@vanguardceramics.demo",
            "INR",
            "₹",
            "enterprise",
            "active",
            1,
            json.dumps({
                "accent": "#38BDF8",
                "invoiceFooter": "Thank you for building with Vanguard Ceramics & Hardware. Goods once sold are subject to batch verification.",
                "financialYear": "2026-27",
                "language": "en-IN",
            }),
            json.dumps({
                "reminderTime": "09:00",
                "allowNegativeStock": False,
                "maxCashierDiscountPct": 10,
                "stateCode": "27",
            }),
        ),
    )

    conn.execute(
        """
        INSERT INTO tenants (id, slug, name, legal_name, gstin, address, phone, email, currency, currency_symbol, plan, status, is_demo, branding_json, config_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "ten_apex",
            "apex-sanitary",
            "Apex Sanitary & Paints",
            "Apex Bathware & Coatings LLP",
            "29AAECA9102K1Z8",
            "100 Feet Road, Indiranagar, Bengaluru 560038",
            "+91 80 4120 7788",
            "accounts@apexsanitary.demo",
            "INR",
            "₹",
            "pro",
            "active",
            1,
            json.dumps({
                "accent": "#22C55E",
                "invoiceFooter": "Apex Sanitary & Paints — Authorized Bathware & Coatings Studio.",
                "financialYear": "2026-27",
                "language": "en-IN",
            }),
            json.dumps({
                "reminderTime": "09:00",
                "allowNegativeStock": False,
                "maxCashierDiscountPct": 8,
                "stateCode": "29",
            }),
        ),
    )

    branches = [
        ("br_vg_south", "ten_vanguard", "BR-STH", "South Flagship Showroom", "42 Linking Road, Bandra West", "Mumbai", "Maharashtra", "27", "27AABCV4821F1Z5", "+91 22 2640 1100", 19.0607, 72.8362, 300, 1),
        ("br_vg_west", "ten_vanguard", "BR-WST", "West Industrial Depot", "MIDC Phase II, Thane Belapur Rd", "Navi Mumbai", "Maharashtra", "27", "27AABCV4821F1Z5", "+91 22 2768 4420", 19.1136, 73.0125, 400, 0),
        ("br_vg_east", "ten_vanguard", "BR-EST", "East Express Hub", "Ring Road Ceramic Arcade, Surat", "Surat", "Gujarat", "24", "24AABCV4821F1Z2", "+91 261 234 9900", 21.1702, 72.8311, 350, 0),
        ("br_ax_blr", "ten_apex", "AX-BLR", "Indiranagar Studio", "100 Feet Road, Indiranagar", "Bengaluru", "Karnataka", "29", "29AAECA9102K1Z8", "+91 80 4120 7788", 12.9784, 77.6408, 300, 1),
    ]
    conn.executemany(
        """
        INSERT INTO branches (id, tenant_id, code, name, address, city, state, state_code, gstin, phone, lat, lng, radius_meters, is_headquarters)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        branches,
    )

    sample_vec = [round(math.sin(i + 1) * 0.5 + 0.5, 4) for i in range(32)]
    sample_vec_enc = encrypt_json({"vec": sample_vec})

    users = [
        ("usr_super", "ten_vanguard", None, "superadmin@titangrid.erp", hash_password("Admin@123"), "Arjun Mehta (Platform Admin)", "super_admin", "9999", "+91 98200 00001", "Mumbai HQ", 0, "2024-01-01", 0, 0, 0, 0, None),
        ("usr_vg_owner", "ten_vanguard", "br_vg_south", "owner@vanguard.demo", hash_password("Owner@123"), "Vikramaditya Rao", "owner", "1111", "+91 98201 11223", "Bandra West, Mumbai", 120000, "2024-02-01", 1500000, 0, 1, 1, sample_vec_enc),
        ("usr_vg_mgr1", "ten_vanguard", "br_vg_south", "manager@vanguard.demo", hash_password("Manager@123"), "Priya Nair", "branch_manager", "2244", "+91 98202 33445", "Andheri West, Mumbai", 48000, "2024-04-10", 800000, 1.5, 1, 1, sample_vec_enc),
        ("usr_vg_sales1", "ten_vanguard", "br_vg_south", "sales@vanguard.demo", hash_password("Sales@123"), "Rohan Kulkarni", "salesman", "4821", "+91 98203 55667", "Dadar East, Mumbai", 26000, "2025-01-15", 450000, 2.0, 1, 1, sample_vec_enc),
        ("usr_vg_sales2", "ten_vanguard", "br_vg_west", "west.sales@vanguard.demo", hash_password("Sales@123"), "Suresh Patil", "salesman", "3319", "+91 98204 77889", "Vashi, Navi Mumbai", 24000, "2025-03-01", 400000, 2.0, 0, 0, None),
        ("usr_vg_acc", "ten_vanguard", "br_vg_east", "accounts@vanguard.demo", hash_password("Account@123"), "Neha Desai", "accountant", "5501", "+91 98250 12345", "Adajan, Surat", 38000, "2024-08-01", 250000, 0.5, 1, 1, sample_vec_enc),
        ("usr_ax_owner", "ten_apex", "br_ax_blr", "owner@apex.demo", hash_password("Apex@123"), "Karthik Gowda", "owner", "7788", "+91 98450 99001", "Indiranagar, Bengaluru", 95000, "2024-06-01", 900000, 0, 1, 1, sample_vec_enc),
    ]
    conn.executemany(
        """
        INSERT INTO users (id, tenant_id, branch_id, email, password_hash, full_name, role, pin_code, phone, address, salary_monthly, joining_date, monthly_target, commission_rate, face_enrolled, face_consent, face_embedding_enc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        users,
    )

    cats = [
        ("cat_tiles", "ten_vanguard", "Tiles", "tiles"),
        ("cat_paint", "ten_vanguard", "Paint", "paint"),
        ("cat_sanitary", "ten_vanguard", "Sanitaryware", "sanitaryware"),
        ("cat_hardware", "ten_vanguard", "Hardware", "hardware"),
        ("cat_ax_sanitary", "ten_apex", "Sanitaryware", "sanitaryware"),
        ("cat_ax_paint", "ten_apex", "Paint", "paint"),
    ]
    conn.executemany("INSERT INTO categories (id, tenant_id, name, slug) VALUES (?, ?, ?, ?)", cats)

    tile_img = "/src/assets/images/tile_marble_slab_1794811964688.jpg"
    paint_img = "/src/assets/images/paint_bucket_studio_1794811965564.jpg"
    sanitary_img = "/src/assets/images/sanitary_faucet_brass_1794811965032.jpg"
    hardware_img = "/src/assets/images/hardware_lockset_steel_1794811966531.jpg"

    prods = [
        ("prd_t1", "ten_vanguard", "cat_tiles", "Tiles", "GVT Porcelain 600x1200mm", "TIL-STAT-1200", "890100100101", "QR-TIL-01", "Statuario Imperiale GVT Slab (600x1200mm)", "Kajaria Eternity", "69072100", 18, 0, "Box", "Sq Ft", 15.5, 15.5, "S-04 Ivory Vein", "B-2026-09", "LOT-99A", None, "2026-09-01", None, 1180, 1890, 1540, 25, tile_img),
        ("prd_t2", "ten_vanguard", "cat_tiles", "Tiles", "Vitrified Floor 800x800mm", "TIL-NERO-800", "890100100102", "QR-TIL-02", "Nero Marquina Matte Floor Tile (800x800mm)", "Somany Duragres", "69072100", 18, 0, "Box", "Sq Ft", 13.78, 13.78, "M-12 Charcoal", "B-2026-08", "LOT-42C", None, "2026-08-15", None, 980, 1550, 1290, 20, tile_img),
        ("prd_t3", "ten_vanguard", "cat_tiles", "Tiles", "Wall Ceramic 300x600mm", "TIL-TRAV-600", "890100100103", "QR-TIL-03", "Travertine Beige Glossy Wall Tile", "Nitco Studio", "69072200", 18, 0, "Box", "Sq Ft", 12.0, 12.0, "T-02 Warm Sand", "B-2026-10", "LOT-18B", None, "2026-10-05", None, 520, 880, 720, 30, tile_img),
        ("prd_p1", "ten_vanguard", "cat_paint", "Paint", "Luxury Interior Emulsion", "PNT-ROY-20L", "890200200201", "QR-PNT-01", "Royale Aspira Velvet Emulsion (20L)", "Asian Paints", "32091090", 18, 0, "Bucket", "Litre", 20, None, "Deep Nocturne", "AP-2610-A", None, "#1E242B", "2026-10-01", "2028-10-01", 6400, 9200, 7850, 12, paint_img),
        ("prd_p2", "ten_vanguard", "cat_paint", "Paint", "Exterior Weatherproof", "PNT-APEX-10L", "890200200202", "QR-PNT-02", "Apex Ultima Weatherguard Exterior (10L)", "Asian Paints", "32091090", 18, 0, "Bucket", "Litre", 10, None, "Pure Alabaster", "AP-2609-F", None, "#F4F3EF", "2026-09-12", "2028-09-12", 3100, 4450, 3820, 15, paint_img),
        ("prd_p3", "ten_vanguard", "cat_paint", "Paint", "Primer & Undercoat", "PNT-PRM-20L", "890200200203", "QR-PNT-03", "TruCare Interior Alkali Primer (20L)", "Berger", "32089090", 18, 0, "Bucket", "Litre", 20, None, "Base White", "BG-2608-K", None, "#FFFFFF", "2026-08-20", "2027-12-20", 2200, 3400, 2850, 18, paint_img),
        ("prd_s1", "ten_vanguard", "cat_sanitary", "Sanitaryware", "Faucets & Mixers", "SAN-BRS-MIX", "890300300301", "QR-SAN-01", "Aurelia Brushed Brass Single-Lever Basin Mixer", "Kohler Studio", "84818020", 18, 0, "Piece", "Piece", 1, None, "Brushed Brass", "KH-26-01", None, None, None, None, 4150, 6800, 5650, 8, sanitary_img),
        ("prd_s2", "ten_vanguard", "cat_sanitary", "Sanitaryware", "Ceramic Basins", "SAN-VES-OVL", "890300300302", "QR-SAN-02", "Carrara Oval Countertop Vessel Basin", "Jaquar Artize", "69101000", 18, 0, "Piece", "Piece", 1, None, "Gloss White", "JQ-26-14", None, None, None, None, 3400, 5400, 4490, 10, sanitary_img),
        ("prd_s3", "ten_vanguard", "cat_sanitary", "Sanitaryware", "Wall-Hung WC", "SAN-WC-RIM", "890300300303", "QR-SAN-03", "Rimless Tornado Wall-Hung EWC with Soft Seat", "Hindware Italian", "69101000", 18, 0, "Piece", "Piece", 1, None, "Alpine White", "HW-26-07", None, None, None, None, 7200, 11800, 9600, 6, sanitary_img),
        ("prd_h1", "ten_vanguard", "cat_hardware", "Hardware", "Mortise Locksets", "HDW-SUS-ML1", "890400400401", "QR-HDW-01", "SUS-304 Precision Mortise Lever Lockset", "Dorset Architect", "83014090", 18, 0, "Piece", "Piece", 1, None, "Brushed Satin", "DR-26-88", None, None, None, None, 1850, 3100, 2550, 15, hardware_img),
        ("prd_h2", "ten_vanguard", "cat_hardware", "Hardware", "Concealed Hinges", "HDW-CH500-PR", "890400400402", "QR-HDW-02", "Heavy-Duty 70kg Concealed 3D Door Hinge (Pair)", "Hettich Pro", "83021010", 18, 0, "Pair", "Piece", 2, None, "Satin Nickel", "HT-26-41", None, None, None, None, 920, 1600, 1340, 20, hardware_img),
        ("prd_h3", "ten_vanguard", "cat_hardware", "Hardware", "Tile Adhesives", "HDW-ADH-25K", "890400400403", "QR-HDW-03", "Polymer Modified Tile Adhesive Type-3 (25kg)", "MYK Laticrete", "38245090", 18, 0, "Bag", "Kg", 25, None, "Grey Cement", "LK-26-11", None, None, "2026-10-10", "2027-10-10", 480, 790, 660, 40, hardware_img),
        ("prd_ax_1", "ten_apex", "cat_ax_sanitary", "Sanitaryware", "Mixers", "AX-FAU-001", "890999000101", "QR-AX-01", "Apex Brass Waterfall Faucet", "Grohe", "84818020", 18, 0, "Piece", "Piece", 1, None, "Brass Matte", "GR-26", None, None, None, None, 5200, 8200, 6950, 8, sanitary_img),
        ("prd_ax_2", "ten_apex", "cat_ax_paint", "Paint", "Emulsion", "AX-PNT-002", "890999000102", "QR-AX-02", "Apex Silk Luxury Coat (10L)", "Dulux", "32091090", 18, 0, "Bucket", "Litre", 10, None, "Slate Mist", "DL-26", None, "#64748B", "2026-09-01", "2028-09-01", 3400, 5100, 4350, 10, paint_img),
    ]
    conn.executemany(
        """
        INSERT INTO products (id, tenant_id, category_id, category_name, subcategory, sku, barcode, qr_code, name, brand, hsn_code, gst_rate, tax_inclusive, unit, base_unit, conversion_factor, box_coverage_sqft, shade, batch_no, lot_no, color_code, mfg_date, exp_date, purchase_price, mrp, selling_price, min_stock, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        prods,
    )

    stock_seed = {
        "prd_t1": [140, 85, 62],
        "prd_t2": [18, 94, 45],
        "prd_t3": [110, 150, 74],
        "prd_p1": [24, 36, 10],
        "prd_p2": [32, 48, 22],
        "prd_p3": [40, 60, 35],
        "prd_s1": [6, 14, 11],
        "prd_s2": [18, 22, 12],
        "prd_s3": [9, 15, 4],
        "prd_h1": [42, 65, 28],
        "prd_h2": [54, 80, 30],
        "prd_h3": [120, 240, 95],
    }
    vg_branches = ["br_vg_south", "br_vg_west", "br_vg_east"]
    for prod_id, qtys in stock_seed.items():
        for idx, br_id in enumerate(vg_branches):
            conn.execute(
                "INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available, qty_damaged, qty_dead) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (f"stk_{br_id}_{prod_id}", "ten_vanguard", br_id, prod_id, qtys[idx], 2 if idx == 1 else 0, 1 if idx == 2 else 0),
            )
    conn.execute("INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available, qty_damaged, qty_dead) VALUES (?, ?, ?, ?, ?, ?, ?)", ("stk_ax_1", "ten_apex", "br_ax_blr", "prd_ax_1", 25, 0, 0))
    conn.execute("INSERT INTO branch_stock (id, tenant_id, branch_id, product_id, qty_available, qty_damaged, qty_dead) VALUES (?, ?, ?, ?, ?, ?, ?)", ("stk_ax_2", "ten_apex", "br_ax_blr", "prd_ax_2", 18, 1, 0))

    conn.executemany(
        "INSERT INTO suppliers (id, tenant_id, name, gstin, phone, email, address, balance_payable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("sup_kajaria", "ten_vanguard", "Kajaria Ceramics Ltd. (West Zone)", "27AAACK4410D1Z9", "+91 22 4001 9900", "dispatch@kajariaceramics.demo", "Bhiwandi Logistics Park, Thane", 145000),
            ("sup_asian", "ten_vanguard", "Asian Paints Distribution Hub", "27AAACA8821M1Z1", "+91 22 6218 1000", "orders@asianpaints.demo", "Taloja MIDC, Navi Mumbai", 82500),
            ("sup_kohler", "ten_vanguard", "Kohler & Dorset Architectural Supply", "24AAACK7712N1Z4", "+91 261 400 3210", "supply@kohlerdist.demo", "GIDC Ankleshwar, Gujarat", 64000),
        ],
    )
    conn.execute(
        "INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, po_no, status, subtotal, gst_amount, total_amount, paid_amount, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("po_1", "ten_vanguard", "br_vg_south", "sup_kajaria", "PO-2026-0104", "received", 118000, 21240, 139240, 75000, "Monthly Statuario Slab Replenishment", "usr_vg_owner"),
    )
    conn.execute(
        "INSERT INTO purchase_order_items (id, po_id, product_id, qty, unit_cost, gst_rate, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("poi_1", "po_1", "prd_t1", 100, 1180, 18, 139240),
    )

    conn.executemany(
        "INSERT INTO customers (id, tenant_id, branch_id, name, phone, email, address, state_code, gstin, segment, credit_limit, outstanding_balance, whatsapp_opt_in, due_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("cust_1", "ten_vanguard", "br_vg_south", "Oberoi Skyline Infra Pvt. Ltd.", "+91 98210 45001", "procurement@oberoiinfra.demo", "Worli Sea Face, Mumbai", "27", "27AABCO8821H1Z3", "builder", 500000, 118400, 1, yesterday, "Priority builder account — 30 day credit"),
            ("cust_2", "ten_vanguard", "br_vg_south", "Studio Forma Architects", "+91 98211 78900", "studio@formaarch.demo", "Pali Hill, Bandra West", "27", "27AAAFS2219L1Z8", "architect", 250000, 42500, 1, next_week, "Prefers matte brass & Statuario slabs"),
            ("cust_3", "ten_vanguard", "br_vg_west", "Maheshwar Interior Contractors", "+91 98192 33410", "mahesh.int@demo.in", "Sector 17, Vashi, Navi Mumbai", "27", None, "contractor", 150000, 28600, 1, two_days_ago, "Overdue reminder candidate"),
            ("cust_4", "ten_vanguard", "br_vg_east", "Patel Ceramic & Developers", "+91 98251 66712", "pateldev@surat.demo", "Vesu Canal Road, Surat", "24", "24AAACP1109F1Z1", "builder", 400000, 0, 1, None, "Interstate & Gujarat hub client"),
            ("cust_5", "ten_vanguard", "br_vg_south", "Walk-in Retail Customer", "+91 90000 00000", None, "Counter Cash Sale", "27", None, "retail", 0, 0, 0, None, "Default retail counter profile"),
            ("cust_ax_1", "ten_apex", "br_ax_blr", "Prestige Crest Interiors", "+91 98451 11223", "orders@prestigecrest.demo", "Koramangala, Bengaluru", "29", "29AAACP5541M1Z2", "architect", 300000, 32000, 1, next_week, "Apex tenant isolated customer"),
        ],
    )

    conn.executemany(
        "INSERT INTO invoices (id, tenant_id, branch_id, invoice_no, doc_type, customer_id, salesman_id, cashier_id, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, paid_amount, due_amount, payment_status, payment_breakdown_json, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("inv_1", "ten_vanguard", "br_vg_south", "INV-STH-2026-0891", "invoice", "cust_2", "usr_vg_sales1", "usr_vg_mgr1", 82400, 2400, 80000, 7200, 7200, 0, 94400, 94400, 0, "paid", json.dumps({"cash": 24400, "upi": 70000, "card": 0, "bank": 0}), None, f"{today}T10:25:00"),
            ("inv_2", "ten_vanguard", "br_vg_south", "INV-STH-2026-0892", "invoice", "cust_1", "usr_vg_sales1", "usr_vg_sales1", 157000, 7000, 150000, 13500, 13500, 0, 177000, 58600, 118400, "partial", json.dumps({"cash": 0, "upi": 28600, "card": 0, "bank": 30000}), yesterday, f"{today}T12:40:00"),
            ("inv_3", "ten_vanguard", "br_vg_west", "INV-WST-2026-0412", "invoice", "cust_3", "usr_vg_sales2", "usr_vg_sales2", 64500, 0, 64500, 5805, 5805, 0, 76110, 47510, 28600, "partial", json.dumps({"cash": 17510, "upi": 30000, "card": 0, "bank": 0}), two_days_ago, f"{yesterday}T16:15:00"),
            ("inv_4", "ten_vanguard", "br_vg_east", "INV-EST-2026-0218", "invoice", "cust_4", "usr_vg_acc", "usr_vg_acc", 96000, 0, 96000, 0, 0, 17280, 113280, 113280, 0, "paid", json.dumps({"cash": 13280, "upi": 40000, "card": 0, "bank": 60000}), None, f"{two_days_ago}T14:10:00"),
            ("inv_ax_1", "ten_apex", "br_ax_blr", "AX-BLR-2026-0041", "invoice", "cust_ax_1", "usr_ax_owner", "usr_ax_owner", 69500, 0, 69500, 6255, 6255, 0, 82010, 50010, 32000, "partial", json.dumps({"cash": 20010, "upi": 30000, "card": 0, "bank": 0}), next_week, f"{today}T11:00:00"),
        ],
    )
    conn.executemany(
        "INSERT INTO invoice_items (id, invoice_id, product_id, sku, product_name, hsn_code, qty, unit, unit_price, purchase_cost, discount_pct, gst_rate, taxable_value, cgst, sgst, igst, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("ii_1", "inv_1", "prd_t1", "TIL-STAT-1200", "Statuario Imperiale GVT Slab (600x1200mm)", "69072100", 40, "Box", 1540, 1180, 0, 18, 61600, 5544, 5544, 0, 72688),
            ("ii_2", "inv_1", "prd_s1", "SAN-BRS-MIX", "Aurelia Brushed Brass Single-Lever Basin Mixer", "84818020", 4, "Piece", 5650, 4150, 10.62, 18, 18400, 1656, 1656, 0, 21712),
            ("ii_3", "inv_2", "prd_p1", "PNT-ROY-20L", "Royale Aspira Velvet Emulsion (20L)", "32091090", 20, "Bucket", 7850, 6400, 4.46, 18, 150000, 13500, 13500, 0, 177000),
            ("ii_4", "inv_3", "prd_t2", "TIL-NERO-800", "Nero Marquina Matte Floor Tile (800x800mm)", "69072100", 50, "Box", 1290, 980, 0, 18, 64500, 5805, 5805, 0, 76110),
            ("ii_5", "inv_4", "prd_s3", "SAN-WC-RIM", "Rimless Tornado Wall-Hung EWC with Soft Seat", "69101000", 10, "Piece", 9600, 7200, 0, 18, 96000, 0, 0, 17280, 113280),
            ("ii_ax_1", "inv_ax_1", "prd_ax_1", "AX-FAU-001", "Apex Brass Waterfall Faucet", "84818020", 10, "Piece", 6950, 5200, 0, 18, 69500, 6255, 6255, 0, 82010),
        ],
    )

    conn.executemany(
        "INSERT INTO payments (id, tenant_id, branch_id, party_type, party_id, invoice_id, amount, mode, reference_no, status, notes, verified_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("pay_1", "ten_vanguard", "br_vg_south", "customer", "cust_2", "inv_1", 94400, "upi", "UPI-4109822311", "verified", "Split payment verified at counter", "usr_vg_mgr1", f"{today}T10:25:00"),
            ("pay_2", "ten_vanguard", "br_vg_south", "customer", "cust_1", "inv_2", 58600, "bank_transfer", "NEFT-OBR9921", "verified", "Booking advance for emulsion lot", "usr_vg_owner", f"{today}T12:40:00"),
            ("pay_3", "ten_vanguard", "br_vg_west", "customer", "cust_3", "inv_3", 47510, "cash", "CASH-WST-412", "verified", "Partial cash counter receipt", "usr_vg_sales2", f"{yesterday}T16:15:00"),
        ],
    )

    conn.executemany(
        "INSERT INTO expenses (id, tenant_id, branch_id, category, description, amount, payment_mode, vendor_name, expense_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("exp_1", "ten_vanguard", "br_vg_south", "Logistics & Freight", "Tempo unloading & ceramic crate handling", 3850, "cash", "Shree Ganesh Transport", today, "usr_vg_mgr1"),
            ("exp_2", "ten_vanguard", "br_vg_south", "Showroom Utilities", "Showroom HVAC & display lighting electricity", 14200, "upi", "Adani Electricity Mumbai", yesterday, "usr_vg_owner"),
            ("exp_3", "ten_vanguard", "br_vg_west", "Warehouse Maintenance", "Forklift hydraulic servicing", 6400, "bank_transfer", "Omega Industrial Services", two_days_ago, "usr_vg_sales2"),
        ],
    )

    conn.execute(
        "INSERT INTO stock_transfers (id, tenant_id, transfer_no, from_branch_id, to_branch_id, status, notes, dispatched_by, dispatched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("trf_1", "ten_vanguard", "TRF-2026-0019", "br_vg_west", "br_vg_south", "dispatched", "Urgent replenishment for Nero Marquina Matte 800x800mm", "usr_vg_sales2", f"{today}T09:15:00"),
    )
    conn.execute(
        "INSERT INTO stock_transfer_items (id, transfer_id, product_id, qty_sent, qty_received) VALUES (?, ?, ?, ?, ?)",
        ("trfi_1", "trf_1", "prd_t2", 25, 0),
    )

    conn.executemany(
        "INSERT INTO attendance_logs (id, tenant_id, branch_id, user_id, log_date, check_in_time, check_out_time, method, liveness_score, face_match_score, lat, lng, geofence_ok, status, overtime_mins) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("att_1", "ten_vanguard", "br_vg_south", "usr_vg_mgr1", today, "09:04", None, "face_liveness", 0.98, 0.94, 19.0608, 72.8361, 1, "present", 0),
            ("att_2", "ten_vanguard", "br_vg_south", "usr_vg_sales1", today, "09:22", None, "face_liveness", 0.96, 0.91, 19.0609, 72.8364, 1, "late", 0),
            ("att_3", "ten_vanguard", "br_vg_south", "usr_vg_sales1", yesterday, "09:00", "19:45", "face_liveness", 0.97, 0.93, 19.0607, 72.8362, 1, "present", 45),
            ("att_4", "ten_vanguard", "br_vg_east", "usr_vg_acc", today, "09:02", None, "pin_fallback", 0, 0, 21.1702, 72.8312, 1, "present", 0),
        ],
    )

    conn.executemany(
        "INSERT INTO ai_knowledge (id, tenant_id, category, title, content) VALUES (?, ?, ?, ?, ?)",
        [
            ("kb_1", "ten_vanguard", "business", "Company Profile & Showrooms", "Vanguard Ceramics & Hardware operates 3 branches: South Flagship Showroom (Bandra West, Mumbai), West Industrial Depot (MIDC Navi Mumbai), and East Express Hub (Surat, Gujarat). Open Mon-Sun 9:30 AM to 8:30 PM."),
            ("kb_2", "ten_vanguard", "policy", "Delivery & Breakage Replacement Policy", "Free local crane/tempo delivery on orders above ₹25,000 within 15 km. Transit tile breakage above 2% is replaced free of charge if reported within 24 hours with unboxing video."),
            ("kb_3", "ten_vanguard", "warranty", "Sanitaryware & Paint Warranty", "Kohler & Jaquar brass mixers carry 7-year cartridge warranty. Asian Paints Royale Aspira & Apex Ultima carry manufacturer performance warranty against flaking when applied with recommended primer."),
            ("kb_4", "ten_vanguard", "sales_script", "Contractor & Builder Quote Script", "For bulk tile orders (>50 boxes), highlight batch/lot consistency, 15.5 sq.ft/box coverage on 600x1200mm GVT slabs, and bundle MYK Laticrete Type-3 adhesive for 10% better bond strength."),
        ],
    )

    conn.executemany(
        "INSERT INTO whatsapp_logs (id, tenant_id, branch_id, customer_id, phone, direction, template_name, message_body, status, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("wa_1", "ten_vanguard", "br_vg_south", "cust_1", "+91 98210 45001", "outbound", "due_payment_reminder_v1", f"Dear Oberoi Skyline Infra Pvt. Ltd., gentle reminder for invoice INV-STH-2026-0892 balance of ₹1,18,400 due on {yesterday}. Reply PAID once transferred.", "simulated", 1, f"{today}T09:00:00"),
            ("wa_2", "ten_vanguard", "br_vg_south", "cust_2", "+91 98211 78900", "inbound", None, "Hi, do you have 40 boxes of Statuario Imperiale 600x1200mm in the same batch lot at Bandra showroom?", "read", 1, f"{today}T09:42:00"),
        ],
    )

    conn.execute(
        "INSERT INTO customer_complaints (id, tenant_id, branch_id, customer_id, subject, description, status, assigned_to, follow_up_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("cmp_1", "ten_vanguard", "br_vg_west", "cust_3", "2 Corner Chips in Crate #4", "Reported 2 chipped tiles upon site delivery at Vashi Sector 17.", "in_progress", "usr_vg_sales2", today),
    )

    ai_status = "configured" if (os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_API_KEY") != "MY_GEMINI_API_KEY") else "not_configured"
    conn.executemany(
        "INSERT INTO integration_configs (id, tenant_id, provider, config_encrypted_json, status) VALUES (?, ?, ?, ?, ?)",
        [
            ("int_vg_fb", "ten_vanguard", "firebase", encrypt_json({"projectId": "", "apiKey": "", "authDomain": "", "storageBucket": "", "messagingSenderId": "", "appId": ""}), "not_configured"),
            ("int_vg_wa", "ten_vanguard", "meta_whatsapp", encrypt_json({"phoneNumberId": "", "wabaId": "", "accessToken": "", "appId": "", "appSecret": "", "verifyToken": "", "webhookUrl": "", "apiVersion": "v21.0"}), "not_configured"),
            ("int_vg_ai", "ten_vanguard", "ai_provider", encrypt_json({"provider": "gemini", "model": "gemini-4-hydrogen", "systemInstruction": "You are TitanGrid AI Assistant. Ground every stock, price, and policy response strictly in verified tenant database records."}), ai_status),
            ("int_vg_db", "ten_vanguard", "database", encrypt_json({"engine": "sqlite-wal (FastAPI + Cloud SQL Postgres ready)", "host": "local-persistent", "backupSchedule": "Daily 02:00 UTC"}), "configured"),
        ],
    )
