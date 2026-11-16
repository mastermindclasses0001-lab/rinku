import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, Trophy, Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiDownloadFile, apiFetch } from '../lib/api';

const EXCEL_REPORTS = [
  { id: 'stock_valuation', label: 'Branch Stock & Valuation / स्टॉक मूल्यांकन' },
  { id: 'product_sales_profit', label: 'Product Sales & Gross Profit / बिक्री व लाभ' },
  { id: 'gst_gstr1', label: 'GST & GSTR-1 Invoice Register / जीएसटी रजिस्टर' },
  { id: 'customer_outstanding', label: 'Customer Dues & Outstanding / ग्राहक बकाया' },
  { id: 'staff_attendance', label: 'Staff Attendance Summary / हाजिरी रिपोर्ट' },
  { id: 'monthly_salary', label: 'Monthly Salary & Deductions / सैलरी रिपोर्ट' },
  { id: 'salesman_performance', label: 'Salesman Targets & Commission / सेल्समैन कमीशन' },
  { id: 'daily_sales_expenses', label: 'Cash/UPI Collections & Expenses / नकद व खर्च' },
  { id: 'stock_movements', label: 'Stock Movement & Transfers / स्टॉक ट्रांसफर' },
  { id: 'combined_branches', label: 'Combined All-Shop Report / सभी दुकानों की रिपोर्ट' },
];

export const TargetsReportsModule: React.FC = () => {
  const { tenant, activeBranchId, notify } = useAuth();
  const [tab, setTab] = useState<'targets' | 'reports'>('targets');
  const [employees, setEmployees] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const sym = tenant?.currency_symbol || '₹';

  const loadData = async () => {
    const qs = new URLSearchParams();
    qs.set('branchId', activeBranchId);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);

    const [emp, rep] = await Promise.all([
      apiFetch<any[]>('/api/staff/employees'),
      apiFetch(`/api/reports/summary?${qs.toString()}`),
    ]);
    setEmployees(emp);
    setSummary(rep);
  };

  useEffect(() => {
    loadData();
  }, [activeBranchId, dateFrom, dateTo]);

  const handleExcelDownload = async (reportId: string) => {
    setDownloading(reportId);
    try {
      const qs = new URLSearchParams({ type: reportId, branchId: activeBranchId });
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      await apiDownloadFile(`/api/reports/export/excel?${qs.toString()}`, `${reportId}.xlsx`);
      notify('success', `Downloaded ${reportId}.xlsx`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setDownloading(null);
    }
  };

  const rankedStaff = [...employees]
    .filter((e) => e.monthly_target > 0)
    .sort((a, b) => Number(b.achieved_sales) - Number(a.achieved_sales));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div className="flex bg-slate-100 dark:bg-[#171C28] p-1 rounded-lg">
          <button
            onClick={() => setTab('targets')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'targets' ? 'bg-sky-500 text-slate-950' : 'text-slate-500'}`}
          >
            Staff Targets & Leaderboard / स्टाफ टारगेट
          </button>
          <button
            onClick={() => setTab('reports')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'reports' ? 'bg-sky-500 text-slate-950' : 'text-slate-500'}`}
          >
            Reports & Excel Center / रिपोर्ट व एक्सेल डाउनलोड
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span className="text-slate-500">From / से:</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
          <span className="text-slate-500">To / तक:</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
        </div>
      </div>

      {tab === 'targets' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center gap-2 font-display font-semibold text-sm">
            <Trophy className="w-4 h-4 text-amber-400" /> Monthly Salesman Performance & Commission / मासिक सेल्समैन प्रदर्शन व कमीशन
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
              <tr>
                <th className="p-3">Rank / रैंक</th>
                <th className="p-3">Staff Member / कर्मचारी</th>
                <th className="p-3">Shop / दुकान</th>
                <th className="p-3 text-right">Monthly Target / लक्ष्य</th>
                <th className="p-3 text-right">Achieved / बिक्री</th>
                <th className="p-3 text-right">Achievement %</th>
                <th className="p-3 text-right">Commission / कमीशन</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {rankedStaff.map((s, idx) => {
                const pct = s.monthly_target > 0 ? (Number(s.achieved_sales) / Number(s.monthly_target)) * 100 : 0;
                const comm = Math.round((Number(s.achieved_sales) * Number(s.commission_rate || 0)) / 100);
                return (
                  <tr key={s.id}>
                    <td className="p-3 font-mono font-bold text-amber-400">#{idx + 1}</td>
                    <td className="p-3 font-semibold">{s.full_name}</td>
                    <td className="p-3">{s.branch_name || 'All'}</td>
                    <td className="p-3 text-right font-mono">{sym}{Number(s.monthly_target).toLocaleString()}</td>
                    <td className="p-3 text-right font-mono text-sky-400 font-semibold">{sym}{Number(s.achieved_sales).toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{pct.toFixed(1)}%</td>
                    <td className="p-3 text-right font-mono text-emerald-400 font-semibold">
                      {sym}{comm.toLocaleString()} ({s.commission_rate}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-6">
          {/* Excel Export Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {EXCEL_REPORTS.map((r) => (
              <button
                key={r.id}
                disabled={downloading === r.id}
                onClick={() => handleExcelDownload(r.id)}
                className="text-left bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 hover:border-emerald-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="text-xs font-semibold">{r.label}</div>
                <div className="text-[10px] font-mono text-emerald-400">
                  {downloading === r.id ? 'GENERATING .XLSX... / बन रहा है' : 'EXPORT EXCEL (.XLSX) / डाउनलोड'}
                </div>
              </button>
            ))}
          </div>

          {/* Live GSTR-1 Preview Table */}
          {summary && (
            <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-white/10 font-display font-semibold text-sm">
                Live GST / GSTR-1 Invoice Register / लाइव जीएसटी बिल ({summary.gstr1.length} Invoices)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
                    <tr>
                      <th className="p-3">Invoice No / बिल सं.</th>
                      <th className="p-3">Date / तारीख</th>
                      <th className="p-3">Customer / ग्राहक व GSTIN</th>
                      <th className="p-3 text-right">Taxable / कर योग्य</th>
                      <th className="p-3 text-right">CGST</th>
                      <th className="p-3 text-right">SGST</th>
                      <th className="p-3 text-right">IGST</th>
                      <th className="p-3 text-right">Total / कुल</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {summary.gstr1.map((g: any) => (
                      <tr key={g.invoice_no}>
                        <td className="p-3 font-mono font-semibold">{g.invoice_no}</td>
                        <td className="p-3 font-mono">{g.inv_date}</td>
                        <td className="p-3">{g.customer_name} · <span className="font-mono text-slate-500">{g.customer_gstin}</span></td>
                        <td className="p-3 text-right font-mono">{sym}{Number(g.taxable_amount).toLocaleString()}</td>
                        <td className="p-3 text-right font-mono">{sym}{Number(g.cgst_amount).toLocaleString()}</td>
                        <td className="p-3 text-right font-mono">{sym}{Number(g.sgst_amount).toLocaleString()}</td>
                        <td className="p-3 text-right font-mono">{sym}{Number(g.igst_amount).toLocaleString()}</td>
                        <td className="p-3 text-right font-mono font-bold">{sym}{Number(g.total_amount).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
