import React, { useEffect, useState } from 'react';
import { Plus, AlertTriangle, CheckCircle2, DollarSign } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

export const AccountsModule: React.FC = () => {
  const { tenant, branches, activeBranchId, notify } = useAuth();
  const [data, setData] = useState<any>(null);
  const [showExpModal, setShowExpModal] = useState(false);
  const [showClosingModal, setShowClosingModal] = useState(false);

  const [expForm, setExpForm] = useState({
    branchId: branches[0]?.id || '',
    category: 'Logistics & Freight',
    description: '',
    amount: 0,
    paymentMode: 'cash',
    vendorName: '',
  });

  const [closeForm, setCloseForm] = useState({
    branchId: branches[0]?.id || '',
    openingCash: 10000,
    actualCash: 10000,
    notes: '',
  });

  const sym = tenant?.currency_symbol || '₹';

  const loadAccounts = async () => {
    const res = await apiFetch(`/api/accounts/overview?branchId=${activeBranchId}`);
    setData(res);
  };

  useEffect(() => {
    loadAccounts();
  }, [activeBranchId]);

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Financial Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div>
          <h1 className="font-display text-xl font-bold">Transactional Accounts & Branch P&L</h1>
          <p className="text-xs text-slate-500">Cash book, UPI/Bank ledgers, operating expenses, and branch-wise cash closing audit.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setCloseForm({ ...closeForm, branchId: activeBranchId !== 'all' ? activeBranchId : branches[0]?.id || '' });
              setShowClosingModal(true);
            }}
            className="px-3 py-2 rounded-lg border border-white/10 hover:border-sky-500/40 text-xs font-medium"
          >
            Record Branch Cash Closing
          </button>
          <button
            onClick={() => {
              setExpForm({ ...expForm, branchId: activeBranchId !== 'all' ? activeBranchId : branches[0]?.id || '' });
              setShowExpModal(true);
            }}
            className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Log Expense
          </button>
        </div>
      </div>

      {/* Mode Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-500">Cash Inflow Ledger</div>
          <div className="font-mono text-xl font-bold text-emerald-400 mt-1">{sym}{Number(data.totals.cashInflow).toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-500">UPI Collections</div>
          <div className="font-mono text-xl font-bold text-sky-400 mt-1">{sym}{Number(data.totals.upiInflow).toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-500">Bank / Card Transfers</div>
          <div className="font-mono text-xl font-bold text-purple-400 mt-1">{sym}{Number(data.totals.bankCardInflow).toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="text-xs text-slate-500">Operating Expenses</div>
          <div className="font-mono text-xl font-bold text-red-400 mt-1">{sym}{Number(data.totals.totalExpenses).toLocaleString()}</div>
        </div>
      </div>

      {/* Branch-wise Profit & Loss */}
      <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/10 font-display font-semibold text-sm flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-400" /> Branch-Wise Profit & Loss Statement (Excl. Tax, Net of Discounts & COGS)
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-white/10 text-slate-500 text-left">
            <tr>
              <th className="p-3">Branch</th>
              <th className="p-3 text-right">Taxable Revenue</th>
              <th className="p-3 text-right">COGS (Purchase Cost)</th>
              <th className="p-3 text-right">Gross Profit</th>
              <th className="p-3 text-right">Operating Expenses</th>
              <th className="p-3 text-right">Net Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {data.branchPnl.map((r: any) => (
              <tr key={r.branch_id}>
                <td className="p-3 font-semibold">{r.branch_name}</td>
                <td className="p-3 text-right font-mono">{sym}{Number(r.revenue_ex_tax).toLocaleString()}</td>
                <td className="p-3 text-right font-mono">{sym}{Number(r.cogs).toLocaleString()}</td>
                <td className="p-3 text-right font-mono text-sky-400">{sym}{Number(r.grossProfit).toLocaleString()}</td>
                <td className="p-3 text-right font-mono text-red-400">{sym}{Number(r.expenses).toLocaleString()}</td>
                <td className={`p-3 text-right font-mono font-bold ${r.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {sym}{Number(r.netProfit).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cash Closings & Expenses Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-white/10 font-display font-semibold text-sm">Branch Cash Closings & Mismatch Alerts</div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
              <tr>
                <th className="p-3">Date / Branch</th>
                <th className="p-3 text-right">Expected</th>
                <th className="p-3 text-right">Actual</th>
                <th className="p-3 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {data.closings.map((c: any) => (
                <tr key={c.id}>
                  <td className="p-3">
                    <div className="font-mono">{c.closing_date}</div>
                    <div className="text-[11px] text-slate-500">{c.branch_name}</div>
                  </td>
                  <td className="p-3 text-right font-mono">{sym}{Number(c.expected_cash).toLocaleString()}</td>
                  <td className="p-3 text-right font-mono">{sym}{Number(c.actual_cash).toLocaleString()}</td>
                  <td className="p-3 text-right font-mono">
                    {c.discrepancy === 0 ? (
                      <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Match</span>
                    ) : (
                      <span className="text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {sym}{c.discrepancy}</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.closings.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-slate-500">No cash closings recorded yet. Click "Record Branch Cash Closing" above.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-white/10 font-display font-semibold text-sm">Recent Expenses Ledger</div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
              <tr>
                <th className="p-3">Date / Category</th>
                <th className="p-3">Branch / Vendor</th>
                <th className="p-3">Mode</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {data.expenses.map((e: any) => (
                <tr key={e.id}>
                  <td className="p-3">
                    <div className="font-medium">{e.category}</div>
                    <div className="text-[11px] font-mono text-slate-500">{e.expense_date}</div>
                  </td>
                  <td className="p-3">
                    <div>{e.branch_name}</div>
                    <div className="text-[11px] text-slate-500">{e.vendor_name || e.description}</div>
                  </td>
                  <td className="p-3 font-mono uppercase">{e.payment_mode}</td>
                  <td className="p-3 text-right font-mono text-red-400 font-semibold">{sym}{Number(e.amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expense Modal */}
      {showExpModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/accounts/expenses', { method: 'POST', body: JSON.stringify(expForm) });
              notify('success', 'Expense recorded in ledger');
              setShowExpModal(false);
              loadAccounts();
            }}
            className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base">Record Business Expense</h3>
            <select value={expForm.branchId} onChange={(e) => setExpForm({ ...expForm, branchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input required placeholder="Category (e.g. Freight, Electricity, Rent)" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required placeholder="Description" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" required min={1} placeholder="Amount" value={expForm.amount || ''} onChange={(e) => setExpForm({ ...expForm, amount: Number(e.target.value) })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              <select value={expForm.paymentMode} onChange={(e) => setExpForm({ ...expForm, paymentMode: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <input placeholder="Vendor Name" value={expForm.vendorName} onChange={(e) => setExpForm({ ...expForm, vendorName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowExpModal(false)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Save Expense</button>
            </div>
          </form>
        </div>
      )}

      {/* Cash Closing Modal */}
      {showClosingModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await apiFetch<{ expectedCash: number; discrepancy: number }>('/api/accounts/cash-closing', {
                method: 'POST',
                body: JSON.stringify(closeForm),
              });
              if (res.discrepancy !== 0) {
                notify('error', `Cash mismatch alert: Expected ${sym}${res.expectedCash}, Variance ${sym}${res.discrepancy}`);
              } else {
                notify('success', 'Branch cash drawer balanced & closed');
              }
              setShowClosingModal(false);
              loadAccounts();
            }}
            className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-sm w-full p-6 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base">Daily Branch Cash Closing</h3>
            <select value={closeForm.branchId} onChange={(e) => setCloseForm({ ...closeForm, branchId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div>
              <label className="block text-slate-400 mb-1">Opening Drawer Cash</label>
              <input type="number" value={closeForm.openingCash} onChange={(e) => setCloseForm({ ...closeForm, openingCash: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Physical Counted Cash</label>
              <input type="number" value={closeForm.actualCash} onChange={(e) => setCloseForm({ ...closeForm, actualCash: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <input placeholder="Closing Notes" value={closeForm.notes} onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowClosingModal(false)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 font-semibold">Close Drawer</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
