import React, { useEffect, useState } from 'react';
import { Plus, ArrowLeftRight, Truck, Search, AlertCircle, Check, PackagePlus, History, Building2, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiDownloadFile, apiFetch } from '../lib/api';
import { Product } from '../types/erp';

type InvTab = 'catalog' | 'transfers' | 'purchases' | 'movements' | 'branches';

export const InventoryModule: React.FC = () => {
  const { tenant, branches, activeBranchId, refreshContext, notify } = useAuth();
  const [tab, setTab] = useState<InvTab>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');

  // Modals
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showPoModal, setShowPoModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [exportingStock, setExportingStock] = useState(false);

  const sym = tenant?.currency_symbol || '₹';

  const loadAll = async () => {
    const qs = new URLSearchParams();
    qs.set('branchId', activeBranchId);
    if (category !== 'All') qs.set('category', category);
    if (search) qs.set('search', search);

    const [p, t, s, po, m] = await Promise.all([
      apiFetch<Product[]>(`/api/inventory/products?${qs.toString()}`),
      apiFetch('/api/inventory/transfers'),
      apiFetch('/api/purchases/suppliers'),
      apiFetch('/api/purchases/orders'),
      apiFetch(`/api/inventory/movements?branchId=${activeBranchId}`),
    ]);
    setProducts(p);
    setTransfers(t);
    setSuppliers(s);
    setOrders(po);
    setMovements(m);
  };

  useEffect(() => {
    loadAll();
  }, [activeBranchId, category, search]);

  // Add product form
  const [newProd, setNewProd] = useState({
    categoryName: 'Tiles',
    subcategory: 'Porcelain GVT',
    sku: '',
    name: '',
    brand: '',
    hsnCode: '69072100',
    gstRate: 18,
    unit: 'Box',
    baseUnit: 'Sq Ft',
    conversionFactor: 15.5,
    boxCoverageSqft: 15.5,
    shade: '',
    batchNo: '',
    lotNo: '',
    expDate: '',
    purchasePrice: 900,
    mrp: 1500,
    sellingPrice: 1250,
    minStock: 15,
    openingBranchId: branches[0]?.id || '',
    openingStock: 40,
  });

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/inventory/products', {
        method: 'POST',
        body: JSON.stringify({ ...newProd, openingBranchId: newProd.openingBranchId || branches[0]?.id }),
      });
      notify('success', `SKU "${newProd.sku}" added across branches`);
      setShowAddProduct(false);
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  // Stock Adjustment
  const [adjForm, setAdjForm] = useState({ branchId: branches[0]?.id || '', movementType: 'adjustment', qtyDelta: 5, notes: '' });
  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    try {
      await apiFetch('/api/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({
          branchId: adjForm.branchId || branches[0]?.id,
          productId: adjustTarget.id,
          movementType: adjForm.movementType,
          qtyDelta: Number(adjForm.qtyDelta),
          notes: adjForm.notes,
        }),
      });
      notify('success', `Stock updated for ${adjustTarget.sku}`);
      setAdjustTarget(null);
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  // Stock Transfer
  const [trfForm, setTrfForm] = useState({
    fromBranchId: branches[0]?.id || '',
    toBranchId: branches[1]?.id || branches[0]?.id || '',
    productId: '',
    qty: 10,
    notes: '',
  });
  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromBranchId: trfForm.fromBranchId || branches[0]?.id,
          toBranchId: trfForm.toBranchId || branches[1]?.id,
          notes: trfForm.notes,
          items: [{ productId: trfForm.productId || products[0]?.id, qty: Number(trfForm.qty) }],
        }),
      });
      notify('success', 'Inter-branch transfer dispatched');
      setShowTransferModal(false);
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const handleReceiveTransfer = async (id: string) => {
    try {
      await apiFetch(`/api/inventory/transfers/${id}/receive`, { method: 'POST' });
      notify('success', 'Stock transfer received & destination inventory updated');
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  // Purchase Order
  const [poForm, setPoForm] = useState({
    branchId: branches[0]?.id || '',
    supplierId: '',
    productId: '',
    qty: 20,
    unitCost: 1000,
    paidAmount: 0,
    receiveImmediately: true,
    notes: '',
  });
  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/purchases/orders', {
        method: 'POST',
        body: JSON.stringify({
          branchId: poForm.branchId || branches[0]?.id,
          supplierId: poForm.supplierId || suppliers[0]?.id,
          paidAmount: Number(poForm.paidAmount),
          receiveImmediately: poForm.receiveImmediately,
          notes: poForm.notes,
          items: [{ productId: poForm.productId || products[0]?.id, qty: Number(poForm.qty), unitCost: Number(poForm.unitCost), gstRate: 18 }],
        }),
      });
      notify('success', 'Purchase order processed');
      setShowPoModal(false);
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  // New Branch
  const [branchForm, setBranchForm] = useState({ code: '', name: '', city: 'Ranchi', state: 'Jharkhand', stateCode: '20', address: '', phone: '' });
  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/branches', { method: 'POST', body: JSON.stringify(branchForm) });
      notify('success', `Branch "${branchForm.name}" created`);
      setShowBranchModal(false);
      await refreshContext();
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const totalCostVal = products.reduce((s, p) => s + p.qty_available * p.purchase_price, 0);
  const totalRetailVal = products.reduce((s, p) => s + p.qty_available * p.selling_price, 0);

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-[#171C28] p-1 rounded-lg">
          {[
            { id: 'catalog' as InvTab, label: 'Catalog & Stock / स्टॉक' },
            { id: 'transfers' as InvTab, label: `Transfers / ट्रांसफर (${transfers.filter((t) => t.status === 'dispatched').length})` },
            { id: 'purchases' as InvTab, label: 'Purchase Orders / खरीद' },
            { id: 'movements' as InvTab, label: 'Stock Ledger / लेजर' },
            { id: 'branches' as InvTab, label: `Shops / दुकानें (${branches.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-sky-500 text-slate-950 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={exportingStock}
            onClick={async () => {
              setExportingStock(true);
              try {
                await apiDownloadFile(
                  `/api/reports/export/excel?type=stock_valuation&branchId=${activeBranchId}`,
                  `stock_valuation_${activeBranchId}.xlsx`
                );
                notify('success', 'Stock Excel (.xlsx) downloaded / स्टॉक एक्सेल डाउनलोड हो गई');
              } catch (err: any) {
                notify('error', err.message || 'Stock Excel export failed');
              } finally {
                setExportingStock(false);
              }
            }}
            className="px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {exportingStock ? 'Exporting... / बन रहा है' : 'Stock Excel / स्टॉक एक्सेल'}
          </button>
          <button
            onClick={() => setShowTransferModal(true)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-medium hover:border-sky-500/40 flex items-center gap-1.5"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
            Transfer Stock / स्टॉक भेजें
          </button>
          <button
            onClick={() => setShowPoModal(true)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-medium hover:border-sky-500/40 flex items-center gap-1.5"
          >
            <Truck className="w-3.5 h-3.5 text-emerald-400" />
            New PO / नई खरीद
          </button>
          <button
            onClick={() => setShowAddProduct(true)}
            className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add SKU / नया प्रोडक्ट
          </button>
        </div>
      </div>

      {tab === 'catalog' && (
        <div className="space-y-4">
          {/* Valuation & Search Strip */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-5 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, barcode, shade, brand / प्रोडक्ट खोजें..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="md:col-span-4 flex items-center gap-1 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 p-1 rounded-lg overflow-x-auto">
              {[
                { id: 'All', label: 'All / सभी' },
                { id: 'Tiles', label: 'Tiles / टाइल्स' },
                { id: 'Paint', label: 'Paint / पेंट' },
                { id: 'Sanitaryware', label: 'Sanitary / सैनिटरी' },
                { id: 'Hardware', label: 'Hardware / हार्डवेयर' },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${
                    category === c.id ? 'bg-sky-500/15 text-sky-400' : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="md:col-span-3 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-lg px-4 py-2 flex items-center justify-between text-xs">
              <span className="text-slate-500">Stock Value / स्टॉक मूल्य:</span>
              <span className="font-mono font-bold text-emerald-400">{sym}{totalCostVal.toLocaleString()}</span>
            </div>
          </div>

          {/* Inventory Table */}
          <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-slate-200 dark:border-white/10 text-slate-500 text-left">
                  <tr>
                    <th className="p-3 font-medium">Product / प्रोडक्ट</th>
                    <th className="p-3 font-medium">Category / श्रेणी</th>
                    <th className="p-3 font-medium">Unit Conv. / इकाई</th>
                    <th className="p-3 font-medium text-right">Purchase / खरीद</th>
                    <th className="p-3 font-medium text-right">Selling / बिक्री (GST%)</th>
                    <th className="p-3 font-medium text-right">Available / उपलब्ध</th>
                    <th className="p-3 font-medium text-right">Dmg / खराब</th>
                    <th className="p-3 font-medium text-right">Action / कार्य</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {products.map((p) => {
                    const isLow = p.qty_available <= p.min_stock;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <img src={p.image_url} alt={p.name} className="w-10 h-10 rounded-lg object-cover border border-white/10 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-semibold truncate max-w-[240px]">{p.name}</div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {p.sku} · HSN {p.hsn_code} · {p.brand}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{p.category_name} · {p.subcategory}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {p.shade ? `Shade: ${p.shade}` : ''} {p.batch_no ? `· Batch: ${p.batch_no}` : ''} {p.exp_date ? `· Exp: ${p.exp_date}` : ''}
                          </div>
                        </td>
                        <td className="p-3 font-mono">
                          1 {p.unit} = {p.conversion_factor} {p.base_unit}
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums">{sym}{p.purchase_price.toLocaleString()}</td>
                        <td className="p-3 text-right font-mono tabular-nums">
                          <div>{sym}{p.selling_price.toLocaleString()}</div>
                          <div className="text-[10px] text-slate-500">GST {p.gst_rate}%</div>
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums">
                          <span className={`font-bold ${isLow ? 'text-red-400' : 'text-emerald-400'}`}>
                            {p.qty_available} {p.unit}
                          </span>
                          {isLow && (
                            <div className="text-[10px] text-red-400 flex items-center justify-end gap-1">
                              <AlertCircle className="w-3 h-3" /> Low (&le;{p.min_stock})
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-500">
                          {p.qty_damaged} / {p.qty_dead}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setAdjustTarget(p);
                              setAdjForm({ branchId: activeBranchId !== 'all' ? activeBranchId : branches[0]?.id || '', movementType: 'adjustment', qtyDelta: 5, notes: '' });
                            }}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-white/10 hover:border-sky-500/40 text-[11px] font-medium"
                          >
                            Adjust / सुधारें
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between text-xs text-slate-500">
              <span>Showing {products.length} active SKUs / सक्रिय प्रोडक्ट</span>
              <span className="font-mono">Retail Valuation / बिक्री मूल्य: {sym}{totalRetailVal.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'transfers' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-slate-200 dark:border-white/10 text-slate-500 text-left">
              <tr>
                <th className="p-3">Transfer No / नं.</th>
                <th className="p-3">Route / कहां से कहां</th>
                <th className="p-3">Items / सामान</th>
                <th className="p-3">Status / स्थिति</th>
                <th className="p-3">Dispatched / भेजा गया</th>
                <th className="p-3 text-right">Action / कार्य</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td className="p-3 font-mono font-semibold">{t.transfer_no}</td>
                  <td className="p-3">{t.from_branch_name} → {t.to_branch_name}</td>
                  <td className="p-3">
                    {(t.items || []).map((it: any) => (
                      <div key={it.id} className="font-mono">{it.product_name} ({it.qty_sent} {it.unit})</div>
                    ))}
                  </td>
                  <td className="p-3 font-mono">
                    <span className={t.status === 'received' ? 'text-emerald-400' : 'text-amber-400'}>{t.status.toUpperCase()}</span>
                  </td>
                  <td className="p-3 font-mono text-slate-500">{String(t.dispatched_at).slice(0, 16)}</td>
                  <td className="p-3 text-right">
                    {t.status !== 'received' ? (
                      <button
                        onClick={() => handleReceiveTransfer(t.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Confirm Receipt / प्राप्त करें
                      </button>
                    ) : (
                      <span className="text-slate-500 font-mono">Completed / प्राप्त</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'purchases' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
            <h3 className="font-display font-semibold text-sm">Suppliers & Payables / सप्लायर बकाया</h3>
            {suppliers.map((s) => (
              <div key={s.id} className="p-3 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{s.gstin} · {s.phone}</div>
                </div>
                <div className="font-mono font-bold text-red-400">{sym}{Number(s.balance_payable).toLocaleString()}</div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-8 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-slate-200 dark:border-white/10 text-slate-500 text-left">
                <tr>
                  <th className="p-3">PO Number / ऑर्डर नं.</th>
                  <th className="p-3">Supplier / सप्लायर</th>
                  <th className="p-3">Shop / दुकान</th>
                  <th className="p-3 text-right">Total / कुल (GST)</th>
                  <th className="p-3">Status / स्थिति</th>
                  <th className="p-3 text-right">Action / कार्य</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {orders.map((po) => (
                  <tr key={po.id}>
                    <td className="p-3 font-mono font-semibold">{po.po_no}</td>
                    <td className="p-3">{po.supplier_name}</td>
                    <td className="p-3">{po.branch_name}</td>
                    <td className="p-3 text-right font-mono">{sym}{Number(po.total_amount).toLocaleString()}</td>
                    <td className="p-3 font-mono">
                      <span className={po.status === 'received' ? 'text-emerald-400' : 'text-amber-400'}>{po.status.toUpperCase()}</span>
                    </td>
                    <td className="p-3 text-right">
                      {po.status !== 'received' && (
                        <button
                          onClick={async () => {
                            await apiFetch(`/api/purchases/orders/${po.id}/receive`, { method: 'POST' });
                            notify('success', `PO ${po.po_no} received into branch stock`);
                            loadAll();
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-500 text-slate-950 font-semibold text-xs"
                        >
                          Receive Stock / स्टॉक लें
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'movements' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center gap-2 text-sm font-semibold">
            <History className="w-4 h-4 text-sky-400" /> Stock Movement Audit Trail / स्टॉक आवाजाही लेजर
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-slate-200 dark:border-white/10 text-slate-500 text-left">
              <tr>
                <th className="p-3">Timestamp / समय</th>
                <th className="p-3">Shop / दुकान</th>
                <th className="p-3">Product / प्रोडक्ट</th>
                <th className="p-3">Type / प्रकार</th>
                <th className="p-3">Reference / विवरण</th>
                <th className="p-3 text-right">Qty Delta / बदलाव</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="p-3 font-mono text-slate-500">{String(m.created_at).slice(0, 16)}</td>
                  <td className="p-3">{m.branch_name}</td>
                  <td className="p-3">{m.product_name} ({m.sku})</td>
                  <td className="p-3 font-mono uppercase">{m.movement_type}</td>
                  <td className="p-3 font-mono text-slate-400">{m.reference_id || m.notes}</td>
                  <td className={`p-3 text-right font-mono font-bold ${m.qty_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {m.qty_delta > 0 ? `+${m.qty_delta}` : m.qty_delta} {m.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'branches' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowBranchModal(true)}
              className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
            >
              <Building2 className="w-3.5 h-3.5" /> Add Unlimited Shop / नई दुकान जोड़ें
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div key={b.id} className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-sky-400">{b.code}</span>
                  {b.is_headquarters === 1 && <span className="text-[11px] font-mono text-emerald-400">HEADQUARTERS / मुख्य</span>}
                </div>
                <div className="font-display font-bold text-base">{b.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{b.address}, {b.city}, {b.state}</div>
                <div className="text-xs font-mono text-slate-400 pt-2 border-t border-slate-100 dark:border-white/5">
                  GSTIN: {b.gstin || tenant?.gstin} · State Code: {b.state_code} · Geofence: {b.radius_meters}m
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateProduct} className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-lg flex items-center gap-2"><PackagePlus className="w-5 h-5 text-sky-400" /> Add New Product SKU / नया प्रोडक्ट जोड़ें</h3>
              <button type="button" onClick={() => setShowAddProduct(false)} className="text-xs text-slate-400">Close / बंद करें</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Category / श्रेणी</label>
                <select value={newProd.categoryName} onChange={(e) => setNewProd({ ...newProd, categoryName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  <option value="Tiles">Tiles / टाइल्स</option>
                  <option value="Paint">Paint / पेंट</option>
                  <option value="Sanitaryware">Sanitaryware / सैनिटरी</option>
                  <option value="Hardware">Hardware / हार्डवेयर</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">SKU Code / कोड *</label>
                <input required placeholder="e.g. TIL-001" value={newProd.sku} onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Brand / ब्रांड</label>
                <input placeholder="e.g. Kajaria / Asian" value={newProd.brand} onChange={(e) => setNewProd({ ...newProd, brand: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Product Name / प्रोडक्ट का नाम *</label>
                <input required placeholder="Full Product Name" value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">HSN Code / एचएसएन कोड</label>
                <input placeholder="69072100" value={newProd.hsnCode} onChange={(e) => setNewProd({ ...newProd, hsnCode: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">GST Rate (%) / जीएसटी %</label>
                <input type="number" placeholder="18" value={newProd.gstRate} onChange={(e) => setNewProd({ ...newProd, gstRate: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Selling Unit / इकाई (Box/Pc)</label>
                <input placeholder="Box / Bucket / Pc" value={newProd.unit} onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Base Unit / छोटी इकाई (Sq Ft/Ltr)</label>
                <input placeholder="Sq Ft / Litre" value={newProd.baseUnit} onChange={(e) => setNewProd({ ...newProd, baseUnit: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Conversion / प्रति बॉक्स माप</label>
                <input type="number" step="0.01" placeholder="15.5" value={newProd.conversionFactor} onChange={(e) => setNewProd({ ...newProd, conversionFactor: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Shade / रंग कोड</label>
                <input placeholder="Optional" value={newProd.shade} onChange={(e) => setNewProd({ ...newProd, shade: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Batch / Lot No / बैच नंबर</label>
                <input placeholder="Optional" value={newProd.batchNo} onChange={(e) => setNewProd({ ...newProd, batchNo: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Purchase Price (₹) / खरीद दर *</label>
                <input type="number" placeholder="900" value={newProd.purchasePrice} onChange={(e) => setNewProd({ ...newProd, purchasePrice: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">MRP (₹) / अधिकतम मूल्य</label>
                <input type="number" placeholder="1500" value={newProd.mrp} onChange={(e) => setNewProd({ ...newProd, mrp: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Selling Price (₹) / बिक्री दर *</label>
                <input type="number" placeholder="1250" value={newProd.sellingPrice} onChange={(e) => setNewProd({ ...newProd, sellingPrice: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Min Stock Alert / कम स्टॉक सीमा</label>
                <input type="number" placeholder="15" value={newProd.minStock} onChange={(e) => setNewProd({ ...newProd, minStock: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Opening Shop / शुरुआती दुकान</label>
                <select value={newProd.openingBranchId || branches[0]?.id || ''} onChange={(e) => setNewProd({ ...newProd, openingBranchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Opening Stock Qty / शुरुआती स्टॉक</label>
                <input type="number" placeholder="40" value={newProd.openingStock} onChange={(e) => setNewProd({ ...newProd, openingStock: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddProduct(false)} className="px-4 py-2 rounded-lg border border-white/10 text-xs">Cancel / रद्द</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs">Save SKU / सेव करें</button>
            </div>
          </form>
        </div>
      )}

      {/* ADJUST STOCK MODAL */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleAdjustStock} className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display font-bold">Adjust Stock / स्टॉक सुधारें — {adjustTarget.sku}</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Shop / दुकान</label>
                <select value={adjForm.branchId} onChange={(e) => setAdjForm({ ...adjForm, branchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Adjustment Type / प्रकार</label>
                <select value={adjForm.movementType} onChange={(e) => setAdjForm({ ...adjForm, movementType: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  <option value="adjustment">Stock Count Adjustment / गिनती सुधार (+/-)</option>
                  <option value="damage">Mark Damaged Stock / टूटा-खराब स्टॉक</option>
                  <option value="dead_stock">Mark Dead Stock / डेड स्टॉक</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Qty Change (+/-) / मात्रा बदलाव</label>
                <input type="number" required value={adjForm.qtyDelta} onChange={(e) => setAdjForm({ ...adjForm, qtyDelta: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Reason / Notes / कारण</label>
                <input placeholder="Reason / कारण व नोट्स" value={adjForm.notes} onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdjustTarget(null)} className="px-4 py-2 rounded-lg border border-white/10 text-xs">Cancel / रद्द</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs">Apply / लागू करें</button>
            </div>
          </form>
        </div>
      )}

      {/* STOCK TRANSFER MODAL */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateTransfer} className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display font-bold">Dispatch Transfer / दुकान से दुकान स्टॉक भेजें</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">From Shop / किस दुकान से</label>
                <select value={trfForm.fromBranchId} onChange={(e) => setTrfForm({ ...trfForm, fromBranchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">To Shop / किस दुकान को</label>
                <select value={trfForm.toBranchId} onChange={(e) => setTrfForm({ ...trfForm, toBranchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Product SKU / प्रोडक्ट चुनें</label>
                <select value={trfForm.productId || products[0]?.id} onChange={(e) => setTrfForm({ ...trfForm, productId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Transfer Qty / भेजने की मात्रा</label>
                <input type="number" min={1} value={trfForm.qty} onChange={(e) => setTrfForm({ ...trfForm, qty: Number(e.target.value) })} placeholder="Qty / मात्रा" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Vehicle / Challan Notes / चालान विवरण</label>
                <input value={trfForm.notes} onChange={(e) => setTrfForm({ ...trfForm, notes: e.target.value })} placeholder="Vehicle / Challan Notes / गाड़ी या चालान विवरण" className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowTransferModal(false)} className="px-4 py-2 rounded-lg border border-white/10 text-xs">Cancel / रद्द</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-amber-400 text-slate-950 font-semibold text-xs">Dispatch / भेजें</button>
            </div>
          </form>
        </div>
      )}

      {/* PO MODAL */}
      {showPoModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreatePo} className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display font-bold">Create Purchase Order / नया खरीद ऑर्डर (PO)</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Receiving Shop / किस दुकान के लिए</label>
                <select value={poForm.branchId} onChange={(e) => setPoForm({ ...poForm, branchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Supplier / सप्लायर</label>
                <select value={poForm.supplierId || suppliers[0]?.id} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Product / प्रोडक्ट चुनें</label>
                <select value={poForm.productId || products[0]?.id} onChange={(e) => setPoForm({ ...poForm, productId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Order Qty / ऑर्डर मात्रा</label>
                  <input type="number" min={1} placeholder="Qty / मात्रा" value={poForm.qty} onChange={(e) => setPoForm({ ...poForm, qty: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Unit Cost (₹) / खरीद दर</label>
                  <input type="number" placeholder="Unit Cost / खरीद दर" value={poForm.unitCost} onChange={(e) => setPoForm({ ...poForm, unitCost: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={poForm.receiveImmediately} onChange={(e) => setPoForm({ ...poForm, receiveImmediately: e.target.checked })} />
                <span>Receive directly into shop stock / तुरंत स्टॉक में जोड़ें</span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowPoModal(false)} className="px-4 py-2 rounded-lg border border-white/10 text-xs">Cancel / रद्द</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-semibold text-xs">Submit PO / ऑर्डर सेव करें</button>
            </div>
          </form>
        </div>
      )}

      {/* NEW BRANCH MODAL */}
      {showBranchModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateBranch} className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-3 text-xs">
            <h3 className="font-display font-bold text-base">Add New Shop / नई दुकान जोड़ें</h3>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Shop Name / दुकान का नाम *</label>
              <input required placeholder="e.g. Rinku 4" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Shop Code / कोड</label>
                <input placeholder="e.g. BR-4" value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">City / शहर *</label>
                <input required placeholder="Ranchi / Dhanbad" value={branchForm.city} onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">State / राज्य</label>
                <input placeholder="Jharkhand" value={branchForm.state} onChange={(e) => setBranchForm({ ...branchForm, state: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">GST State Code / राज्य कोड</label>
                <input placeholder="20" value={branchForm.stateCode} onChange={(e) => setBranchForm({ ...branchForm, stateCode: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone / फोन नंबर</label>
              <input placeholder="+91 ..." value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Full Address / पूरा पता</label>
              <input placeholder="Main Road, Jharkhand" value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowBranchModal(false)} className="px-4 py-2 rounded-lg border border-white/10">Cancel / रद्द</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Create Shop / दुकान बनाएं</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
