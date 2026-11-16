import React, { useEffect, useState } from 'react';
import { Barcode, Plus, Trash2, Printer, Share2, Receipt, Calculator, RotateCcw, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { generateInvoicePdf } from '../lib/pdfExport';
import { Customer, Invoice, Product } from '../types/erp';

interface CartLine {
  product: Product;
  qty: number;
  unitPrice: number;
  discountPct: number;
  taxInclusive: boolean;
}

export const PosModule: React.FC = () => {
  const { tenant, branches, activeBranchId, session, notify } = useAuth();
  const [view, setView] = useState<'terminal' | 'history'>('terminal');
  const [branchId, setBranchId] = useState(activeBranchId !== 'all' ? activeBranchId : branches[0]?.id || '');
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; full_name: string }>>([]);

  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [salesmanId, setSalesmanId] = useState(session?.userId || '');
  const [docType, setDocType] = useState<'invoice' | 'quotation' | 'challan'>('invoice');
  const [overallDiscount, setOverallDiscount] = useState(0);
  const [payCash, setPayCash] = useState(0);
  const [payUpi, setPayUpi] = useState(0);
  const [payCard, setPayCard] = useState(0);
  const [payBank, setPayBank] = useState(0);
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Tile SqFt calculator helper
  const [calcSqft, setCalcSqft] = useState<number>(0);
  const [showNewCust, setShowNewCust] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', phone: '', segment: 'retail', stateCode: '27', gstin: '' });

  const sym = tenant?.currency_symbol || '₹';

  useEffect(() => {
    if (activeBranchId !== 'all') setBranchId(activeBranchId);
    else if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [activeBranchId, branches]);

  const loadPosData = async () => {
    const b = branchId || branches[0]?.id || 'all';
    const [p, c, inv, emp] = await Promise.all([
      apiFetch<Product[]>(`/api/inventory/products?branchId=${b}`),
      apiFetch<Customer[]>('/api/crm/customers'),
      apiFetch<Invoice[]>(`/api/pos/invoices?branchId=${b}`),
      apiFetch<Array<{ id: string; full_name: string }>>('/api/staff/employees'),
    ]);
    setProducts(p);
    setCustomers(c);
    setInvoices(inv);
    setEmployees(emp);
    if (!customerId && c[0]) setCustomerId(c.find((x) => x.segment === 'retail')?.id || c[0].id);
  };

  useEffect(() => {
    loadPosData();
  }, [branchId]);

  const addToCart = (p: Product, customQty?: number) => {
    if (p.qty_available <= 0 && docType !== 'quotation') {
      notify('error', `Zero stock at selected branch for ${p.sku}`);
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + (customQty || 1) };
        return next;
      }
      return [...prev, { product: p, qty: customQty || 1, unitPrice: p.selling_price, discountPct: 0, taxInclusive: Boolean(p.tax_inclusive) }];
    });
  };

  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      const exact = products.find(
        (p) => p.barcode?.toLowerCase() === search.trim().toLowerCase() || p.sku.toLowerCase() === search.trim().toLowerCase()
      );
      if (exact) {
        addToCart(exact);
        setSearch('');
      }
    }
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const selectedBranch = branches.find((b) => b.id === branchId);
  const isInterstate = Boolean(selectedCustomer && selectedBranch && selectedCustomer.state_code !== selectedBranch.state_code);

  // Live GST Calculation
  let subtotal = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0;
  for (const line of cart) {
    const gross = line.qty * line.unitPrice;
    const afterDisc = gross * (1 - line.discountPct / 100);
    let lineTaxable = afterDisc;
    let tax = 0;
    if (line.taxInclusive) {
      lineTaxable = afterDisc / (1 + line.product.gst_rate / 100);
      tax = afterDisc - lineTaxable;
    } else {
      tax = (afterDisc * line.product.gst_rate) / 100;
    }
    subtotal += gross;
    taxable += lineTaxable;
    if (isInterstate) igst += tax;
    else {
      cgst += tax / 2;
      sgst += tax / 2;
    }
  }
  const ratio = taxable > 0 ? Math.max(0, (taxable - overallDiscount) / taxable) : 1;
  const finalTaxable = taxable * ratio;
  const finalCgst = cgst * ratio;
  const finalSgst = sgst * ratio;
  const finalIgst = igst * ratio;
  const grandTotal = Math.round(finalTaxable + finalCgst + finalSgst + finalIgst);
  const totalPaid = payCash + payUpi + payCard + payBank;
  const dueBalance = Math.max(0, grandTotal - totalPaid);

  const handleSubmitBill = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<{ id: string; invoiceNo: string; totalAmount: number }>('/api/pos/invoices', {
        method: 'POST',
        body: JSON.stringify({
          branchId,
          docType,
          customerId,
          salesmanId,
          overallDiscountAmount: overallDiscount,
          paymentBreakdown: { cash: payCash, upi: payUpi, card: payCard, bank: payBank },
          dueDate: dueBalance > 0 ? dueDate || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10) : null,
          idempotencyKey: `pos_${Date.now()}_${cart.length}`,
          items: cart.map((l) => ({
            productId: l.product.id,
            qty: l.qty,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            taxInclusive: l.taxInclusive,
          })),
        }),
      });
      notify('success', `${docType.toUpperCase()} ${res.invoiceNo} created (${sym}${res.totalAmount.toLocaleString()})`);
      setCart([]);
      setPayCash(0);
      setPayUpi(0);
      setPayCard(0);
      setPayBank(0);
      setOverallDiscount(0);
      await loadPosData();
      setView('history');
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const shareWhatsApp = (inv: Invoice) => {
    const text = encodeURIComponent(
      `Invoice ${inv.invoice_no} from ${tenant?.name}\nBranch: ${inv.branch_name}\nTotal: ${sym}${inv.total_amount.toLocaleString()}\nPaid: ${sym}${inv.paid_amount.toLocaleString()}\nBalance Due: ${sym}${inv.due_amount.toLocaleString()}\nThank you for your business!`
    );
    const phone = (inv.customer_phone || '').replace(/[^0-9]/g, '');
    const url = phone.length >= 10 ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const filteredProducts = products.filter((p) => {
    const catOk = category === 'All' || p.category_name.toLowerCase() === category.toLowerCase();
    const q = search.toLowerCase();
    const searchOk = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q);
    return catOk && searchOk;
  });

  return (
    <div className="space-y-5">
      {/* Top Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 dark:bg-[#171C28] p-1 rounded-lg">
            <button
              onClick={() => setView('terminal')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${view === 'terminal' ? 'bg-sky-500 text-slate-950' : 'text-slate-500'}`}
            >
              POS Billing Terminal
            </button>
            <button
              onClick={() => setView('history')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${view === 'history' ? 'bg-sky-500 text-slate-950' : 'text-slate-500'}`}
            >
              Invoices & Credit Notes ({invoices.length})
            </button>
          </div>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 text-xs font-medium"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.state_code})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className={isInterstate ? 'text-purple-400' : 'text-emerald-400'}>
            {isInterstate ? 'INTERSTATE IGST MODE' : 'INTRASTATE CGST+SGST MODE'}
          </span>
        </div>
      </div>

      {view === 'terminal' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Product Grid */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[220px] relative">
                <Barcode className="w-4 h-4 text-sky-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleBarcodeEnter}
                  placeholder="Scan barcode or search SKU / product name (Enter to add)..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 text-xs focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="flex items-center gap-1 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 p-1 rounded-lg">
                {['All', 'Tiles', 'Paint', 'Sanitaryware', 'Hardware'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium ${category === c ? 'bg-sky-500/15 text-sky-400' : 'text-slate-500'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Tile Area Calculator Strip */}
            <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <Calculator className="w-4 h-4 text-sky-400" />
                <span>Tile Area Helper: Enter Sq.Ft required to preview boxes needed</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={calcSqft || ''}
                  onChange={(e) => setCalcSqft(Number(e.target.value))}
                  placeholder="Sq. Ft (e.g. 450)"
                  className="w-28 px-2.5 py-1 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono"
                />
                {calcSqft > 0 && <span className="font-mono text-sky-400">Click any Tile card to add exact boxes</span>}
              </div>
            </div>

            {/* Product Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredProducts.map((p) => {
                const neededBoxes =
                  calcSqft > 0 && p.box_coverage_sqft ? Math.ceil(calcSqft / p.box_coverage_sqft) : 1;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p, neededBoxes)}
                    className="text-left bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 hover:border-sky-500/50 rounded-xl p-3 transition-all flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold line-clamp-2">{p.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{p.sku}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-white/5 text-xs">
                      <span className="font-mono font-bold text-sky-400">
                        {sym}{p.selling_price.toLocaleString()}/{p.unit}
                      </span>
                      <span className={`font-mono text-[11px] ${p.qty_available > p.min_stock ? 'text-emerald-400' : 'text-red-400'}`}>
                        {p.qty_available} left
                      </span>
                    </div>
                    {calcSqft > 0 && p.box_coverage_sqft && (
                      <div className="text-[11px] font-mono text-amber-400">
                        + Add {neededBoxes} {p.unit}s ({(neededBoxes * p.box_coverage_sqft).toFixed(1)} sq.ft)
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Cart & Payment Checkout */}
          <div className="lg:col-span-5 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4 sticky top-20">
            <div className="flex items-center justify-between">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 text-xs font-semibold"
              >
                <option value="invoice">Tax Invoice (GST)</option>
                <option value="quotation">Quotation / Estimate</option>
                <option value="challan">Delivery Challan</option>
              </select>
              <button onClick={() => setCart([])} className="text-xs text-red-400 hover:underline">
                Clear Cart
              </button>
            </div>

            {/* Customer & Salesman */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex gap-1">
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="flex-1 px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 truncate"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.segment})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewCust(true)}
                  className="px-2.5 rounded-lg border border-white/10 hover:border-sky-500/40"
                  title="Quick Register Customer"
                >
                  <UserPlus className="w-4 h-4 text-sky-400" />
                </button>
              </div>
              <select
                value={salesmanId}
                onChange={(e) => setSalesmanId(e.target.value)}
                className="px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    Sales: {e.full_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Cart Lines */}
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5 border-y border-slate-200 dark:border-white/10">
              {cart.map((line, idx) => (
                <div key={line.product.id} className="py-2.5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{line.product.name}</span>
                    <button
                      onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-300 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 items-center font-mono">
                    <input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(e) => {
                        const next = [...cart];
                        next[idx].qty = Math.max(1, Number(e.target.value));
                        setCart(next);
                      }}
                      className="px-2 py-1 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10"
                      title="Quantity"
                    />
                    <input
                      type="number"
                      value={line.unitPrice}
                      onChange={(e) => {
                        const next = [...cart];
                        next[idx].unitPrice = Number(e.target.value);
                        setCart(next);
                      }}
                      className="px-2 py-1 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10"
                      title="Rate"
                    />
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={line.discountPct}
                      onChange={(e) => {
                        const next = [...cart];
                        next[idx].discountPct = Number(e.target.value);
                        setCart(next);
                      }}
                      placeholder="Disc%"
                      className="px-2 py-1 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10"
                      title="Line Discount %"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...cart];
                        next[idx].taxInclusive = !next[idx].taxInclusive;
                        setCart(next);
                      }}
                      className="px-1.5 py-1 rounded border border-white/10 text-[10px]"
                    >
                      {line.taxInclusive ? 'Incl.' : `+${line.product.gst_rate}%`}
                    </button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && <div className="py-8 text-center text-xs text-slate-500">Click products or scan barcode to start billing.</div>}
            </div>

            {/* Totals Breakdown */}
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Taxable Amount</span>
                <span>{sym}{finalTaxable.toFixed(2)}</span>
              </div>
              {isInterstate ? (
                <div className="flex justify-between text-slate-400">
                  <span>IGST</span>
                  <span>{sym}{finalIgst.toFixed(2)}</span>
                </div>
              ) : (
                <div className="flex justify-between text-slate-400">
                  <span>CGST + SGST</span>
                  <span>{sym}{(finalCgst + finalSgst).toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-slate-400">
                <span>Extra Discount ({sym})</span>
                <input
                  type="number"
                  min={0}
                  value={overallDiscount || ''}
                  onChange={(e) => setOverallDiscount(Number(e.target.value))}
                  className="w-24 text-right px-2 py-1 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10"
                />
              </div>
              <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-200 dark:border-white/10">
                <span>Grand Total</span>
                <span className="text-sky-400">{sym}{grandTotal.toLocaleString()}</span>
              </div>
            </div>

            {/* Split Payments */}
            {docType === 'invoice' && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/10 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Split Payment</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPayUpi(grandTotal);
                      setPayCash(0);
                      setPayCard(0);
                      setPayBank(0);
                    }}
                    className="text-sky-400 hover:underline font-mono"
                  >
                    Full UPI ({sym}{grandTotal})
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <label className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10">
                    <span className="text-slate-400">Cash</span>
                    <input type="number" min={0} value={payCash || ''} onChange={(e) => setPayCash(Number(e.target.value))} className="w-20 text-right bg-transparent focus:outline-none" />
                  </label>
                  <label className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10">
                    <span className="text-slate-400">UPI</span>
                    <input type="number" min={0} value={payUpi || ''} onChange={(e) => setPayUpi(Number(e.target.value))} className="w-20 text-right bg-transparent focus:outline-none" />
                  </label>
                  <label className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10">
                    <span className="text-slate-400">Card</span>
                    <input type="number" min={0} value={payCard || ''} onChange={(e) => setPayCard(Number(e.target.value))} className="w-20 text-right bg-transparent focus:outline-none" />
                  </label>
                  <label className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10">
                    <span className="text-slate-400">Bank</span>
                    <input type="number" min={0} value={payBank || ''} onChange={(e) => setPayBank(Number(e.target.value))} className="w-20 text-right bg-transparent focus:outline-none" />
                  </label>
                </div>
                {dueBalance > 0 && (
                  <div className="flex items-center justify-between text-amber-400 font-mono">
                    <span>Credit Due: {sym}{dueBalance.toLocaleString()}</span>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="px-2 py-1 rounded bg-slate-50 dark:bg-[#171C28] border border-white/10 text-xs" />
                  </div>
                )}
              </div>
            )}

            <button
              disabled={cart.length === 0 || submitting}
              onClick={handleSubmitBill}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-colors disabled:opacity-40"
            >
              {submitting ? 'Processing...' : `Finalize ${docType.toUpperCase()} (${sym}${grandTotal.toLocaleString()})`}
            </button>
          </div>
        </div>
      ) : (
        /* Invoice History & Print / Return / WhatsApp */
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-slate-200 dark:border-white/10 text-slate-500 text-left">
                <tr>
                  <th className="p-3">Invoice / Doc No</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3 text-right">Taxable</th>
                  <th className="p-3 text-right">GST</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-right">Due</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {invoices.map((inv) => (
                  <tr key={inv.id} className={inv.is_cancelled ? 'opacity-50' : ''}>
                    <td className="p-3">
                      <div className="font-mono font-semibold">{inv.invoice_no}</div>
                      <div className="text-[11px] text-slate-500">{inv.created_at.slice(0, 16).replace('T', ' ')}</div>
                    </td>
                    <td className="p-3">{inv.customer_name || 'Walk-in'}</td>
                    <td className="p-3">{inv.branch_name}</td>
                    <td className="p-3 text-right font-mono">{sym}{inv.taxable_amount.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{sym}{(inv.cgst_amount + inv.sgst_amount + inv.igst_amount).toLocaleString()}</td>
                    <td className="p-3 text-right font-mono font-bold">{sym}{inv.total_amount.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono text-amber-400">{sym}{inv.due_amount.toLocaleString()}</td>
                    <td className="p-3 font-mono">
                      <span className={inv.payment_status === 'paid' ? 'text-emerald-400' : inv.payment_status === 'cancelled' ? 'text-red-400' : 'text-amber-400'}>
                        {inv.payment_status.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => tenant && generateInvoicePdf(inv, tenant, 'a4')}
                          className="px-2 py-1 rounded border border-white/10 hover:border-sky-500/40 inline-flex items-center gap-1"
                          title="Download A4 Tax Invoice PDF"
                        >
                          <Printer className="w-3.5 h-3.5 text-sky-400" /> A4
                        </button>
                        <button
                          onClick={() => tenant && generateInvoicePdf(inv, tenant, 'thermal')}
                          className="px-2 py-1 rounded border border-white/10 hover:border-sky-500/40 inline-flex items-center gap-1"
                          title="Download 80mm Thermal Receipt"
                        >
                          <Receipt className="w-3.5 h-3.5 text-emerald-400" /> 80mm
                        </button>
                        <button
                          onClick={() => shareWhatsApp(inv)}
                          className="px-2 py-1 rounded border border-white/10 hover:border-emerald-500/40 inline-flex items-center gap-1"
                          title="Share via WhatsApp (no Meta API required)"
                        >
                          <Share2 className="w-3.5 h-3.5 text-emerald-400" /> WA
                        </button>
                        {!inv.is_cancelled && ['super_admin', 'owner', 'branch_manager'].includes(session?.role || '') && (
                          <button
                            onClick={async () => {
                              await apiFetch(`/api/pos/invoices/${inv.id}/cancel`, {
                                method: 'POST',
                                body: JSON.stringify({ reason: 'Sales Return / Credit Note' }),
                              });
                              notify('info', `${inv.invoice_no} cancelled & stock restored`);
                              loadPosData();
                            }}
                            className="px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1"
                            title="Sales Return / Cancel Bill"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Return
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Register Customer Modal */}
      {showNewCust && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await apiFetch<{ id: string }>('/api/crm/customers', {
                method: 'POST',
                body: JSON.stringify({ ...newCust, branchId }),
              });
              notify('success', 'Customer registered');
              setShowNewCust(false);
              await loadPosData();
              setCustomerId(res.id);
            }}
            className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-sm w-full p-5 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base">Quick Customer Registration</h3>
            <input required placeholder="Full Name *" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required placeholder="WhatsApp Mobile *" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <select value={newCust.segment} onChange={(e) => setNewCust({ ...newCust, segment: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                <option value="retail">Retail</option>
                <option value="contractor">Contractor</option>
                <option value="builder">Builder</option>
                <option value="architect">Architect</option>
              </select>
              <input placeholder="State Code (27)" value={newCust.stateCode} onChange={(e) => setNewCust({ ...newCust, stateCode: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <input placeholder="Customer GSTIN (Optional)" value={newCust.gstin} onChange={(e) => setNewCust({ ...newCust, gstin: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewCust(false)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Save Customer</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
