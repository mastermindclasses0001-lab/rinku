import React, { useEffect, useState } from 'react';
import { BrainCircuit, Plus, Trash2, Send, Bot, UserCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { Customer } from '../types/erp';

export const AiBrainModule: React.FC = () => {
  const { notify } = useAuth();
  const [tab, setTab] = useState<'knowledge' | 'customer_sim' | 'owner_ai'>('knowledge');
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Knowledge form
  const [kbForm, setKbForm] = useState({ id: '', category: 'policy', title: '', content: '' });

  // Customer chat simulator
  const [verifiedCustId, setVerifiedCustId] = useState('');
  const [custInput, setCustInput] = useState('Do you have Statuario tiles in stock and what is the box coverage & price?');
  const [custChat, setCustChat] = useState<Array<{ role: 'user' | 'ai'; text: string; escalated?: boolean; source?: string }>>([]);
  const [custLoading, setCustLoading] = useState(false);

  // Owner AI Assistant
  const [ownerInput, setOwnerInput] = useState('Which branch has the highest sales and which items are critically low in stock?');
  const [ownerChat, setOwnerChat] = useState<Array<{ role: 'user' | 'ai'; text: string; requiresConfirmation?: boolean }>>([]);
  const [ownerLoading, setOwnerLoading] = useState(false);

  const loadData = async () => {
    const [k, c] = await Promise.all([apiFetch<any[]>('/api/ai/knowledge'), apiFetch<Customer[]>('/api/crm/customers')]);
    setKnowledge(k);
    setCustomers(c);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveKb = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/ai/knowledge', { method: 'POST', body: JSON.stringify(kbForm) });
    notify('success', 'AI Brain knowledge entry saved');
    setKbForm({ id: '', category: 'policy', title: '', content: '' });
    loadData();
  };

  const handleCustomerAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custInput.trim()) return;
    const msg = custInput;
    setCustChat((prev) => [...prev, { role: 'user', text: msg }]);
    setCustInput('');
    setCustLoading(true);
    try {
      const res = await apiFetch<{ reply: string; escalated: boolean; source: string }>('/api/ai/customer-chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg, customerId: verifiedCustId || null }),
      });
      setCustChat((prev) => [...prev, { role: 'ai', text: res.reply, escalated: res.escalated, source: res.source }]);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setCustLoading(false);
    }
  };

  const handleOwnerAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerInput.trim()) return;
    const q = ownerInput;
    setOwnerChat((prev) => [...prev, { role: 'user', text: q }]);
    setOwnerInput('');
    setOwnerLoading(true);
    try {
      const res = await apiFetch<{ answer: string; requiresConfirmation: boolean }>('/api/ai/owner-assistant', {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      setOwnerChat((prev) => [...prev, { role: 'ai', text: res.answer, requiresConfirmation: res.requiresConfirmation }]);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setOwnerLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2.5">
          <BrainCircuit className="w-5 h-5 text-purple-400" />
          <div>
            <h1 className="font-display text-lg font-bold">AI Brain / एआई बिजनेस असिस्टेंट</h1>
            <p className="text-xs text-slate-500">Strictly grounded in tenant inventory, pricing & ledgers. / स्टॉक, कीमत और खातों पर आधारित स्मार्ट मदद।</p>
          </div>
        </div>
        <div className="flex bg-slate-100 dark:bg-[#171C28] p-1 rounded-lg">
          {[
            { id: 'knowledge' as const, label: `Knowledge Base / जानकारी (${knowledge.length})` },
            { id: 'customer_sim' as const, label: 'Customer WhatsApp AI / ग्राहक चैट' },
            { id: 'owner_ai' as const, label: 'Owner CFO Assistant / मालिक एआई' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === t.id ? 'bg-purple-500 text-slate-950' : 'text-slate-500'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'knowledge' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleSaveKb} className="lg:col-span-5 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3 text-xs">
            <h3 className="font-display font-bold text-base">{kbForm.id ? 'Edit Knowledge Entry / जानकारी बदलें' : 'Add Business Knowledge / नई जानकारी जोड़ें'}</h3>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Category / श्रेणी</label>
              <select value={kbForm.category} onChange={(e) => setKbForm({ ...kbForm, category: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                <option value="business">Business & Shop Info / दुकान जानकारी</option>
                <option value="product">Product Offer & Specs / प्रोडक्ट ऑफर</option>
                <option value="policy">Delivery & Return Policy / डिलीवरी नियम</option>
                <option value="warranty">Warranty Terms / गारंटी शर्तें</option>
                <option value="faq">Customer FAQ / सामान्य प्रश्न</option>
                <option value="sales_script">Sales Script / सेल्स स्क्रिप्ट</option>
                <option value="cs_instruction">Customer Service Instruction / ग्राहक सेवा निर्देश</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Title / शीर्षक *</label>
              <input required placeholder="Short Title" value={kbForm.title} onChange={(e) => setKbForm({ ...kbForm, title: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Details / सही जानकारी *</label>
              <textarea required rows={5} placeholder="Exact factual details, terms, or script..." value={kbForm.content} onChange={(e) => setKbForm({ ...kbForm, content: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            </div>
            <div className="flex justify-end gap-2">
              {kbForm.id && (
                <button type="button" onClick={() => setKbForm({ id: '', category: 'policy', title: '', content: '' })} className="px-3 py-2 rounded-lg border border-white/10">
                  Clear / साफ़ करें
                </button>
              )}
              <button type="submit" className="px-4 py-2 rounded-lg bg-purple-500 text-slate-950 font-semibold flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Save to AI Brain / सेव करें
              </button>
            </div>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {knowledge.map((k) => (
              <div key={k.id} className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono text-purple-400 uppercase">{k.category}</span>
                    <h4 className="font-semibold text-sm">{k.title}</h4>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={() => setKbForm({ id: k.id, category: k.category, title: k.title, content: k.content })} className="text-sky-400 hover:underline">
                      Edit / बदलें
                    </button>
                    <button
                      onClick={async () => {
                        await apiFetch(`/api/ai/knowledge/${k.id}`, { method: 'DELETE' });
                        notify('info', 'Removed entry');
                        loadData();
                      }}
                      className="text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{k.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'customer_sim' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10 text-xs">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span>Identity Verification / ग्राहक पहचान:</span>
              <select value={verifiedCustId} onChange={(e) => setVerifiedCustId(e.target.value)} className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                <option value="">Unverified Guest / नया ग्राहक (No private dues exposed)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>Verified: {c.name} ({c.phone})</option>
                ))}
              </select>
            </div>
            <span className="font-mono text-slate-500">Live Inventory & Policy / लाइव स्टॉक आधारित</span>
          </div>

          <div className="h-80 overflow-y-auto space-y-3 p-3 rounded-lg bg-slate-50 dark:bg-[#0D1017] border border-white/5">
            {custChat.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xl rounded-xl px-4 py-2.5 text-xs whitespace-pre-wrap ${m.role === 'user' ? 'bg-sky-500 text-slate-950 font-medium' : 'bg-white dark:bg-[#171C28] border border-white/10'}`}>
                  {m.text}
                  {m.escalated && (
                    <div className="mt-2 pt-2 border-t border-red-500/30 text-red-400 font-mono flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Escalated to Human Staff / स्टाफ को भेजा गया
                    </div>
                  )}
                </div>
              </div>
            ))}
            {custChat.length === 0 && <div className="text-xs text-slate-500 text-center py-12">Ask a customer question about tiles, paint, stock, or dues. / टाइल्स, पेंट, स्टॉक या बकाया के बारे में सवाल पूछें।</div>}
          </div>

          <form onSubmit={handleCustomerAsk} className="flex gap-2">
            <input value={custInput} onChange={(e) => setCustInput(e.target.value)} placeholder="Type customer WhatsApp message / ग्राहक का संदेश लिखें..." className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 text-xs" />
            <button disabled={custLoading} type="submit" className="px-4 py-2.5 rounded-lg bg-emerald-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> {custLoading ? 'Thinking... / सोच रहा है' : 'Test Reply / जवाब टेस्ट करें'}
            </button>
          </form>
        </div>
      )}

      {tab === 'owner_ai' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="w-4 h-4 text-purple-400" /> Owner Executive Assistant / मालिक बिजनेस सहायक
          </div>

          <div className="h-80 overflow-y-auto space-y-3 p-3 rounded-lg bg-slate-50 dark:bg-[#0D1017] border border-white/5">
            {ownerChat.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xl rounded-xl px-4 py-2.5 text-xs whitespace-pre-wrap ${m.role === 'user' ? 'bg-purple-500 text-slate-950 font-medium' : 'bg-white dark:bg-[#171C28] border border-white/10'}`}>
                  {m.text}
                  {m.requiresConfirmation && (
                    <div className="mt-2 pt-2 border-t border-amber-500/30 text-amber-400 font-mono">
                      Action Confirmation Guard: Financial edits must be done in target module. / वित्तीय बदलाव संबंधित पेज से ही करें।
                    </div>
                  )}
                </div>
              </div>
            ))}
            {ownerChat.length === 0 && <div className="text-xs text-slate-500 text-center py-12">Ask about shop sales, overdue receivables, low stock, or expenses. / सभी दुकानों की बिक्री, उधार या कम स्टॉक के बारे में पूछें।</div>}
          </div>

          <form onSubmit={handleOwnerAsk} className="flex gap-2">
            <input value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} placeholder="Ask question across all shops / सभी दुकानों के बारे में पूछें..." className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 text-xs" />
            <button disabled={ownerLoading} type="submit" className="px-4 py-2.5 rounded-lg bg-purple-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> {ownerLoading ? 'Analyzing... / जांच रहा है' : 'Ask AI / एआई से पूछें'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
