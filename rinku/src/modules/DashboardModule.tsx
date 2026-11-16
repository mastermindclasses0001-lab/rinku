import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  Wallet,
  AlertTriangle,
  ArrowUpRight,
  Package,
  Users,
  CheckCircle2,
  Clock,
  Filter,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

interface DashboardData {
  kpis: {
    totalSales: number;
    todaySales: number;
    todayInvoices: number;
    totalPurchases: number;
    grossProfit: number;
    netProfit: number;
    totalExpenses: number;
    customerOutstanding: number;
    supplierPayable: number;
    cashBalance: number;
    upiBalance: number;
    cardBankBalance: number;
    invoiceCount: number;
  };
  branchBreakdown: Array<{ id: string; name: string; code: string; city: string; sales: number; dues: number; orders: number }>;
  topProducts: Array<{ product_id: string; product_name: string; sku: string; qty_sold: number; revenue: number; gross_profit: number }>;
  lowStock: Array<{ id: string; name: string; sku: string; min_stock: number; unit: string; branch_name: string; qty_available: number }>;
  customerDues: Array<{ id: string; name: string; phone: string; segment: string; outstanding_balance: number; due_date: string | null }>;
  attendanceToday: Array<{ id: string; full_name: string; role: string; branch_name: string; check_in_time: string; status: string; method: string }>;
  pendingApprovals: { pendingTransfers: number; openComplaints: number; lowStockCount: number };
}

export const DashboardModule: React.FC = () => {
  const { tenant, activeBranchId, setActiveSection } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; full_name: string }>>([]);
  const [salesmanId, setSalesmanId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);

  const sym = tenant?.currency_symbol || '₹';

  const loadData = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (activeBranchId) qs.set('branchId', activeBranchId);
      if (salesmanId !== 'all') qs.set('salesmanId', salesmanId);
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);

      const [dash, staff] = await Promise.all([
        apiFetch<DashboardData>(`/api/dashboard?${qs.toString()}`),
        apiFetch<Array<{ id: string; full_name: string }>>('/api/staff/employees'),
      ]);
      setData(dash);
      setEmployees(staff);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeBranchId, salesmanId, dateFrom, dateTo]);

  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const maxBranchSale = Math.max(1, ...data.branchBreakdown.map((b) => Number(b.sales || 0)));

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div>
          <h1 className="font-display text-xl font-bold">Executive Operations Overview</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live multi-branch financials, stock alerts, and staff metrics · {tenant?.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>
          <select
            value={salesmanId}
            onChange={(e) => setSalesmanId(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs"
          >
            <option value="all">All Staff</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs font-mono"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-slate-200 dark:border-white/10 text-xs font-mono"
          />
          {(dateFrom || dateTo || salesmanId !== 'all') && (
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setSalesmanId('all');
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs text-sky-400 hover:bg-sky-500/10"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>Total Sales ({data.kpis.invoiceCount} Bills)</span>
            <TrendingUp className="w-4 h-4 text-sky-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums">{sym}{data.kpis.totalSales.toLocaleString()}</div>
          <div className="mt-2 text-xs text-emerald-400 font-mono">
            Today: {sym}{data.kpis.todaySales.toLocaleString()} ({data.kpis.todayInvoices} bills)
          </div>
        </div>

        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>Net Profit (After Expenses)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className={`font-mono text-2xl font-bold tabular-nums ${data.kpis.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {sym}{data.kpis.netProfit.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
            Gross: {sym}{data.kpis.grossProfit.toLocaleString()} · Exp: {sym}{data.kpis.totalExpenses.toLocaleString()}
          </div>
        </div>

        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>Cash / UPI / Bank Collections</span>
            <Wallet className="w-4 h-4 text-purple-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums">
            {sym}{(data.kpis.cashBalance + data.kpis.upiBalance + data.kpis.cardBankBalance).toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
            Cash {sym}{data.kpis.cashBalance.toLocaleString()} · UPI {sym}{data.kpis.upiBalance.toLocaleString()}
          </div>
        </div>

        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>Receivables & Payables</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-amber-400">
            {sym}{data.kpis.customerOutstanding.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
            Supplier Due: {sym}{data.kpis.supplierPayable.toLocaleString()} · POs: {sym}{data.kpis.totalPurchases.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Pending Approvals & Critical Notifications Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => setActiveSection('inventory')}
          className="text-left bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 hover:border-sky-500/40 rounded-xl p-4 flex items-center justify-between transition-colors"
        >
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Low-Stock Branch Alerts</div>
            <div className="font-mono text-lg font-bold text-red-400 mt-0.5">{data.pendingApprovals.lowStockCount} SKUs Below Minimum</div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400" />
        </button>

        <button
          onClick={() => setActiveSection('inventory')}
          className="text-left bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 hover:border-sky-500/40 rounded-xl p-4 flex items-center justify-between transition-colors"
        >
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Pending Stock Transfers</div>
            <div className="font-mono text-lg font-bold text-amber-400 mt-0.5">{data.pendingApprovals.pendingTransfers} In Transit</div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400" />
        </button>

        <button
          onClick={() => setActiveSection('crm')}
          className="text-left bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 hover:border-sky-500/40 rounded-xl p-4 flex items-center justify-between transition-colors"
        >
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Open Customer Complaints</div>
            <div className="font-mono text-lg font-bold text-purple-400 mt-0.5">{data.pendingApprovals.openComplaints} Active Cases</div>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Middle Analytical Split: Branch Comparison & Best-Selling Products */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-base">Branch-Wise Sales & Dues</h2>
            <span className="text-xs font-mono text-slate-500">{data.branchBreakdown.length} Branches</span>
          </div>
          <div className="space-y-4">
            {data.branchBreakdown.map((b) => {
              const pct = Math.round((Number(b.sales) / maxBranchSale) * 100);
              return (
                <div key={b.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold">{b.name}</span>
                      <span className="text-slate-500 ml-2 font-mono">{b.city} · {b.orders} bills</span>
                    </div>
                    <div className="font-mono font-semibold tabular-nums">
                      {sym}{Number(b.sales).toLocaleString()}
                      {Number(b.dues) > 0 && <span className="text-amber-400 ml-2">(Due {sym}{Number(b.dues).toLocaleString()})</span>}
                    </div>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-[#171C28] overflow-hidden">
                    <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-base">Best-Selling SKUs & Margin</h2>
            <Package className="w-4 h-4 text-sky-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500 text-left">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Qty</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.topProducts.map((p) => (
                  <tr key={p.product_id} className="h-10">
                    <td className="pr-3">
                      <div className="font-medium truncate max-w-[220px]">{p.product_name}</div>
                      <div className="text-[11px] font-mono text-slate-500">{p.sku}</div>
                    </td>
                    <td className="text-right font-mono tabular-nums">{p.qty_sold}</td>
                    <td className="text-right font-mono tabular-nums">{sym}{Number(p.revenue).toLocaleString()}</td>
                    <td className="text-right font-mono tabular-nums text-emerald-400">{sym}{Number(p.gross_profit).toLocaleString()}</td>
                  </tr>
                ))}
                {data.topProducts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">No sales recorded in selected filter range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom 3-Column Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Low Stock Table */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <h3 className="font-display font-semibold text-sm mb-3">Low Stock Watchlist</h3>
          <div className="space-y-2.5">
            {data.lowStock.slice(0, 5).map((ls) => (
              <div key={ls.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-white/5 last:border-0">
                <div className="min-w-0 pr-2">
                  <div className="font-medium truncate">{ls.name}</div>
                  <div className="text-[11px] text-slate-500">{ls.branch_name} · Min {ls.min_stock}</div>
                </div>
                <span className="font-mono font-semibold text-red-400 shrink-0">
                  {ls.qty_available} {ls.unit}
                </span>
              </div>
            ))}
            {data.lowStock.length === 0 && <div className="text-xs text-slate-500">All SKUs above minimum threshold.</div>}
          </div>
        </div>

        {/* Customer Dues */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm">Top Customer Receivables</h3>
            <Users className="w-4 h-4 text-amber-400" />
          </div>
          <div className="space-y-2.5">
            {data.customerDues.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-white/5 last:border-0">
                <div className="min-w-0 pr-2">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {c.segment} · Due {c.due_date || 'Immediate'}
                  </div>
                </div>
                <span className="font-mono font-semibold text-amber-400 shrink-0">
                  {sym}{Number(c.outstanding_balance).toLocaleString()}
                </span>
              </div>
            ))}
            {data.customerDues.length === 0 && <div className="text-xs text-slate-500">Zero pending receivables.</div>}
          </div>
        </div>

        {/* Today's Attendance */}
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm">Today's Branch Attendance</h3>
            <Clock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="space-y-2.5">
            {data.attendanceToday.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-white/5 last:border-0">
                <div className="min-w-0 pr-2">
                  <div className="font-medium truncate">{a.full_name}</div>
                  <div className="text-[11px] text-slate-500">
                    {a.branch_name} · {a.method === 'face_liveness' ? 'Face Biometric' : 'PIN'}
                  </div>
                </div>
                <span className={`font-mono text-xs font-semibold shrink-0 ${a.status === 'late' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  IN {a.check_in_time}
                </span>
              </div>
            ))}
            {data.attendanceToday.length === 0 && <div className="text-xs text-slate-500">No check-ins recorded today yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
