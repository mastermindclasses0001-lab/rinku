import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, MessageSquare, Send, AlertCircle, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { Customer } from '../types/erp';

export const CrmWhatsappModule: React.FC = () => {
  const { tenant, branches, notify } = useAuth();
  const [tab, setTab] = useState<'customers' | 'whatsapp' | 'complaints'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [waData, setWaData] = useState<{ status: string; webhookUrl: string; logs: any[] }>({ status: 'not_configured', webhookUrl: '', logs: [] });
  const [complaints, setComplaints] = useState<any[]>([]);
  const [segmentFilter, setSegmentFilter] = useState('all');

  // Payment confirmation modal
  const [payTarget, setPayTarget] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMode, setPayMode] = useState('upi');

  // Bulk campaign composer
  const [templateName, setTemplateName] = useState('due_payment_reminder_v1');
  const [messageBody, setMessageBody] = useState('Hello {{name}}, new architectural porcelain tile & matte brass collections have arrived at our showroom. Reply to book a sample.');
  const [selectedCustIds, setSelectedCustIds] = useState<string[]>([]);

  // Complaint modal
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [compForm, setCompForm] = useState({ customerId: '', subject: '', description: '' });

  const sym = tenant?.currency_symbol || '₹';

  const loadAll = async () => {
    const [c, w, cmp] = await Promise.all([
      apiFetch<Customer[]>('/api/crm/customers'),
      apiFetch<{ status: string; webhookUrl: string; logs: any[] }>('/api/whatsapp/logs'),
      apiFetch<any[]>('/api/crm/complaints'),
    ]);
    setCustomers(c);
    setWaData(w);
    setComplaints(cmp);
    if (selectedCustIds.length === 0) {
      setSelectedCustIds(c.filter((x) => x.whatsapp_opt_in === 1).map((x) => x.id));
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredCustomers = customers.filter((c) => segmentFilter === 'all' || c.segment === segmentFilter);

  const handleRun9amReminders = async () => {
    const res = await apiFetch<{ sentCount: number }>('/api/crm/run-reminders', { method: 'POST' });
    notify('success', `9 AM Overdue Scheduler ran: ${res.sentCount} opted-in overdue reminders queued/simulated.`);
    loadAll();
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    await apiFetch('/api/accounts/payments', {
      method: 'POST',
      body: JSON.stringify({
        branchId: payTarget.branch_id || branches[0]?.id,
        partyType: 'customer',
        partyId: payTarget.id,
        amount: payAmount,
        mode: payMode,
        notes: '1-Click CRM Payment Confirmation',
      }),
    });
    notify('success', `Payment verified & thank-you receipt triggered for ${payTarget.name}. Future overdue reminders stopped.`);
    setPayTarget(null);
    loadAll();
  };

  const handleSendCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ sent: number; skippedOptOut: number; mode: string }>('/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({
        customerIds: selectedCustIds,
        templateName,
        messageBody,
        branchId: branches[0]?.id,
      }),
    });
    notify('success', `Campaign processed (${res.mode}): ${res.sent} sent, ${res.skippedOptOut} opted-out skipped.`);
    loadAll();
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div className="flex bg-slate-100 dark:bg-[#171C28] p-1 rounded-lg">
          {[
            { id: 'customers' as const, label: `Customer CRM (${customers.length})` },
            { id: 'whatsapp' as const, label: 'Meta WhatsApp Automation' },
            { id: 'complaints' as const, label: `Complaints (${complaints.filter((c) => c.status !== 'resolved').length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === t.id ? 'bg-sky-500 text-slate-950' : 'text-slate-500'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleRun9amReminders}
          className="px-3.5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
        >
          <BellRing className="w-3.5 h-3.5" /> Run 9 AM Overdue Reminders Now
        </button>
      </div>

      {/* Meta Status Banner */}
      {waData.status !== 'configured' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              <strong>Meta WhatsApp Cloud API: NOT CONFIGURED.</strong> Messages below operate in transparent Demo Simulator mode until Phone Number ID & Access Token are saved in Settings.
            </span>
          </div>
          <span className="font-mono text-amber-400">DEMO SIMULATOR ACTIVE</span>
        </div>
      )}

      {tab === 'customers' && (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {['all', 'builder', 'contractor', 'architect', 'retail'].map((seg) => (
              <button
                key={seg}
                onClick={() => setSegmentFilter(seg)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border ${
                  segmentFilter === seg ? 'bg-sky-500/15 border-sky-500/40 text-sky-400' : 'border-slate-200 dark:border-white/10 text-slate-500'
                }`}
              >
                {seg}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-white/10 text-slate-500 text-left">
                <tr>
                  <th className="p-3">Customer / Segment</th>
                  <th className="p-3">Phone & GSTIN</th>
                  <th className="p-3 text-right">Credit Limit</th>
                  <th className="p-3 text-right">Lifetime Sales</th>
                  <th className="p-3 text-right">Outstanding Due</th>
                  <th className="p-3">WA Opt-In</th>
                  <th className="p-3 text-right">1-Click Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredCustomers.map((c) => (
                  <tr key={c.id}>
                    <td className="p-3">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-[11px] font-mono text-slate-500 uppercase">{c.segment} · Due: {c.due_date || 'None'}</div>
                    </td>
                    <td className="p-3 font-mono">
                      <div>{c.phone}</div>
                      <div className="text-[11px] text-slate-500">{c.gstin || 'Unregistered'}</div>
                    </td>
                    <td className="p-3 text-right font-mono">{sym}{Number(c.credit_limit).toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{sym}{Number(c.lifetime_value || 0).toLocaleString()}</td>
                    <td className={`p-3 text-right font-mono font-bold ${c.outstanding_balance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {sym}{Number(c.outstanding_balance).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={async () => {
                          await apiFetch(`/api/crm/customers/${c.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ whatsappOptIn: c.whatsapp_opt_in === 0 }),
                          });
                          loadAll();
                        }}
                        className={`px-2 py-1 rounded text-[11px] font-mono border ${
                          c.whatsapp_opt_in ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/30 text-red-400'
                        }`}
                      >
                        {c.whatsapp_opt_in ? 'OPTED IN' : 'OPTED OUT'}
                      </button>
                    </td>
                    <td className="p-3 text-right">
                      {c.outstanding_balance > 0 ? (
                        <button
                          onClick={() => {
                            setPayTarget(c);
                            setPayAmount(c.outstanding_balance);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Payment
                        </button>
                      ) : (
                        <span className="text-slate-500 font-mono">Settled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'whatsapp' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleSendCampaign} className="lg:col-span-5 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4 text-xs">
            <h3 className="font-display font-bold text-base flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" /> Approved Template Campaign
            </h3>
            <div>
              <label className="block text-slate-400 mb-1">Meta Approved Template Name</label>
              <select value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono">
                <option value="due_payment_reminder_v1">due_payment_reminder_v1 (Utility)</option>
                <option value="payment_thank_you_v1">payment_thank_you_v1 (Utility)</option>
                <option value="invoice_pdf_dispatch_v1">invoice_pdf_dispatch_v1 (Utility)</option>
                <option value="new_arrival_catalog_v1">new_arrival_catalog_v1 (Marketing - Opt-In Only)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Message Body (supports {"{{name}}"})</label>
              <textarea rows={4} value={messageBody} onChange={(e) => setMessageBody(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Recipients ({selectedCustIds.length} Opted-In Selected)</label>
              <div className="max-h-36 overflow-y-auto space-y-1 border border-white/10 rounded-lg p-2 bg-slate-50 dark:bg-[#171C28]">
                {customers.map((c) => (
                  <label key={c.id} className="flex items-center justify-between text-xs py-0.5">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!c.whatsapp_opt_in}
                        checked={selectedCustIds.includes(c.id)}
                        onChange={(e) => {
                          setSelectedCustIds((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)));
                        }}
                      />
                      <span>{c.name}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{c.whatsapp_opt_in ? c.phone : 'OPT-OUT'}</span>
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center justify-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> Dispatch Campaign
            </button>
          </form>

          <div className="lg:col-span-7 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between text-xs">
              <span className="font-display font-semibold text-sm">WhatsApp Conversation & Delivery Log</span>
              <span className="font-mono text-slate-500 truncate max-w-xs">Webhook: {waData.webhookUrl}</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/5 max-h-[440px] overflow-y-auto">
              {waData.logs.map((w) => (
                <div key={w.id} className="p-4 text-xs space-y-1">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className={w.direction === 'inbound' ? 'text-sky-400' : 'text-emerald-400'}>
                      {w.direction.toUpperCase()} · {w.customer_name || w.phone}
                    </span>
                    <span className="text-slate-500">{w.status.toUpperCase()} · {String(w.created_at).slice(0, 16)}</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{w.message_body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'complaints' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => {
                setCompForm({ customerId: customers[0]?.id || '', subject: '', description: '' });
                setShowComplaintModal(true);
              }}
              className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" /> Log Customer Complaint
            </button>
          </div>
          <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-[#171C28] text-slate-500 text-left">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Subject & Details</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {complaints.map((c) => (
                  <tr key={c.id}>
                    <td className="p-3 font-medium">{c.customer_name}<div className="text-[11px] font-mono text-slate-500">{c.customer_phone}</div></td>
                    <td className="p-3">
                      <div className="font-semibold">{c.subject}</div>
                      <div className="text-slate-500">{c.description}</div>
                    </td>
                    <td className="p-3 font-mono uppercase">{c.status}</td>
                    <td className="p-3 text-right">
                      {c.status !== 'resolved' && (
                        <button
                          onClick={async () => {
                            await apiFetch(`/api/crm/complaints/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
                            notify('success', 'Complaint marked resolved');
                            loadAll();
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-500 text-slate-950 font-semibold"
                        >
                          Resolve
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

      {/* 1-Click Payment Confirmation Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleConfirmPayment} className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-sm w-full p-6 space-y-3 text-xs">
            <h3 className="font-display font-bold text-base">Confirm Payment & Send Receipt</h3>
            <p className="text-slate-400">Customer: <strong>{payTarget.name}</strong> (Current Due: {sym}{payTarget.outstanding_balance.toLocaleString()})</p>
            <input type="number" required min={1} value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            <select value={payMode} onChange={(e) => setPayMode(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer / NEFT</option>
              <option value="card">Card</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPayTarget(null)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 font-semibold">Verify & Send Thank-You</button>
            </div>
          </form>
        </div>
      )}

      {/* Complaint Modal */}
      {showComplaintModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/crm/complaints', { method: 'POST', body: JSON.stringify(compForm) });
              notify('success', 'Complaint logged');
              setShowComplaintModal(false);
              loadAll();
            }}
            className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base">Log Customer Complaint</h3>
            <select value={compForm.customerId} onChange={(e) => setCompForm({ ...compForm, customerId: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input required placeholder="Subject" value={compForm.subject} onChange={(e) => setCompForm({ ...compForm, subject: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <textarea required rows={3} placeholder="Issue details..." value={compForm.description} onChange={(e) => setCompForm({ ...compForm, description: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowComplaintModal(false)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Save Case</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
