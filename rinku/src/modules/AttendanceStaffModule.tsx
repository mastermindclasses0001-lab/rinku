import React, { useEffect, useRef, useState } from 'react';
import { Camera, MapPin, ShieldCheck, KeyRound, UserPlus, FileDown, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { generateSalarySlipPdf } from '../lib/pdfExport';

export const AttendanceStaffModule: React.FC = () => {
  const { tenant, branches, session, notify } = useAuth();
  const [tab, setTab] = useState<'camera' | 'logs' | 'employees' | 'payroll'>('camera');
  const [employees, setEmployees] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);

  const [selectedUserId, setSelectedUserId] = useState(session?.userId || '');
  const [selectedBranchId, setSelectedBranchId] = useState(session?.branchId || branches[0]?.id || '');
  const [pinCode, setPinCode] = useState('');
  const [consent, setConsent] = useState(false);

  // Camera & GPS states
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [processing, setProcessing] = useState(false);

  // Add Employee modal
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [empForm, setEmpForm] = useState({
    fullName: '',
    email: '',
    password: 'Staff@123',
    role: 'salesman',
    branchId: branches[0]?.id || '',
    phone: '',
    salaryMonthly: 24000,
    monthlyTarget: 400000,
    commissionRate: 2.0,
    pinCode: '1234',
  });

  // Salary adjustment modal
  const [adjUser, setAdjUser] = useState<any | null>(null);
  const [adjForm, setAdjForm] = useState({ amount: 2000, type: 'advance', notes: '' });

  const sym = tenant?.currency_symbol || '₹';

  const loadAll = async () => {
    const [e, l, p] = await Promise.all([
      apiFetch<any[]>('/api/staff/employees'),
      apiFetch<any[]>('/api/staff/attendance'),
      apiFetch<any[]>('/api/staff/payroll'),
    ]);
    setEmployees(e);
    setLogs(l);
    setPayroll(p);
    if (!selectedUserId && e[0]) setSelectedUserId(e[0].id);
    if (!selectedBranchId && branches[0]) setSelectedBranchId(branches[0].id);
  };

  useEffect(() => {
    loadAll();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 360 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraError('Browser camera unavailable or permission denied. Use PIN fallback or allow camera access.');
    }
  };

  const fetchGeolocation = () => {
    if (!navigator.geolocation) {
      notify('error', 'Geolocation not supported by browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: Number(pos.coords.latitude.toFixed(5)), lng: Number(pos.coords.longitude.toFixed(5)) });
        notify('success', 'GPS coordinates locked for branch geofence verification');
      },
      () => {
        const br = branches.find((b) => b.id === selectedBranchId) || branches[0];
        if (br) {
          setCoords({ lat: br.lat, lng: br.lng });
          notify('info', 'GPS permission unavailable in iframe; using branch terminal coordinates');
        }
      }
    );
  };

  // Extract 32-dim normalized spatial luminance descriptor + multi-frame liveness delta
  const captureBiometricFrames = async (): Promise<{
    descriptor: number[];
    livenessChecks: { motionDelta: number; luminanceVariance: number; frameCount: number };
  }> => {
    const video = videoRef.current;
    if (!video || !cameraActive) {
      throw new Error('Start camera feed before capturing biometric frames');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;

    const frames: Uint8ClampedArray[] = [];
    for (let f = 0; f < 4; f++) {
      ctx.drawImage(video, 0, 0, 64, 48);
      frames.push(ctx.getImageData(0, 0, 64, 48).data);
      await new Promise((r) => setTimeout(r, 180));
    }

    // Compute motion delta between first and last frame
    let diffSum = 0;
    const f0 = frames[0];
    const fLast = frames[frames.length - 1];
    for (let i = 0; i < f0.length; i += 4) {
      diffSum += Math.abs(f0[i] - fLast[i]) + Math.abs(f0[i + 1] - fLast[i + 1]) + Math.abs(f0[i + 2] - fLast[i + 2]);
    }
    const motionDelta = Number((diffSum / (64 * 48 * 3 * 255)).toFixed(4));

    // Compute 32-bin spatial descriptor & luminance variance
    const descriptor: number[] = [];
    let meanLum = 0;
    const blockLums: number[] = [];
    for (let by = 0; by < 4; by++) {
      for (let bx = 0; bx < 8; bx++) {
        let sum = 0;
        let count = 0;
        for (let y = by * 12; y < (by + 1) * 12; y++) {
          for (let x = bx * 8; x < (bx + 1) * 8; x++) {
            const idx = (y * 64 + x) * 4;
            const lum = 0.299 * fLast[idx] + 0.587 * fLast[idx + 1] + 0.114 * fLast[idx + 2];
            sum += lum;
            count++;
          }
        }
        const avg = sum / count / 255;
        blockLums.push(avg * 100);
        meanLum += avg * 100;
        descriptor.push(Number(avg.toFixed(4)));
      }
    }
    meanLum /= 32;
    const variance = blockLums.reduce((s, v) => s + (v - meanLum) ** 2, 0) / 32;

    return {
      descriptor,
      livenessChecks: { motionDelta, luminanceVariance: Number(variance.toFixed(2)), frameCount: frames.length },
    };
  };

  const handleEnrollFace = async () => {
    if (!consent) {
      notify('error', 'Employee must check biometric consent box before enrolling');
      return;
    }
    setProcessing(true);
    try {
      const { descriptor } = await captureBiometricFrames();
      await apiFetch('/api/staff/attendance/enroll-face', {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, consent: true, descriptor }),
      });
      notify('success', 'Face embedding enrolled securely (no raw photo stored publicly)');
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleAttendanceCheck = async (action: 'IN' | 'OUT', method: 'face_liveness' | 'pin_fallback') => {
    setProcessing(true);
    try {
      let bio: { descriptor?: number[]; livenessChecks?: any } = {};
      if (method === 'face_liveness') {
        bio = await captureBiometricFrames();
      }
      const res = await apiFetch<any>('/api/staff/attendance/check', {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedUserId,
          branchId: selectedBranchId,
          action,
          method,
          pinCode,
          lat: coords?.lat,
          lng: coords?.lng,
          ...bio,
        }),
      });
      notify('success', `Checked ${action} at ${res.time} (${method === 'face_liveness' ? `Liveness ${(res.livenessScore * 100).toFixed(0)}%` : 'PIN verified'})`);
      setPinCode('');
      loadAll();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-4">
        <div className="flex flex-wrap gap-1.5 bg-slate-100 dark:bg-[#171C28] p-1 rounded-lg">
          {[
            { id: 'camera' as const, label: 'Mobile Face Terminal' },
            { id: 'logs' as const, label: `Attendance Log (${logs.length})` },
            { id: 'employees' as const, label: `Staff Directory (${employees.length})` },
            { id: 'payroll' as const, label: 'Payroll & Salary Slips' },
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
        {['super_admin', 'owner', 'branch_manager'].includes(session?.role || '') && (
          <button
            onClick={() => setShowAddEmp(true)}
            className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" /> Register Employee
          </button>
        )}
      </div>

      {tab === 'camera' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Camera Liveness Viewport */}
          <div className="lg:col-span-6 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base">Biometric Face + Liveness Terminal</h2>
                <p className="text-xs text-slate-500">Multi-frame motion & luminance check verified server-side against encrypted embedding.</p>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>

            <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-white/10 aspect-[4/3] flex items-center justify-center">
              <video ref={videoRef} muted playsInline className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`} />
              {!cameraActive && (
                <div className="text-center p-6 space-y-3">
                  <Camera className="w-10 h-10 text-slate-500 mx-auto" />
                  <div className="text-xs text-slate-400 max-w-xs mx-auto">
                    {cameraError || 'Activate front camera to verify live presence or enroll employee face vector.'}
                  </div>
                  <button onClick={startCamera} className="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs">
                    Start Camera Feed
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={fetchGeolocation}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 hover:border-sky-500/40 flex items-center gap-1.5"
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                {coords ? `GPS: ${coords.lat}, ${coords.lng}` : 'Verify Branch GPS Geofence'}
              </button>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>Employee Biometric Consent</span>
              </label>
            </div>
          </div>

          {/* Check-In / Out & PIN Fallback Controls */}
          <div className="lg:col-span-6 bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Employee</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name} ({e.face_enrolled ? 'Face Enrolled' : 'PIN Only'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Branch Location</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={!cameraActive || processing}
                onClick={() => handleAttendanceCheck('IN', 'face_liveness')}
                className="min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm disabled:opacity-40 transition-colors"
              >
                Face Check IN
              </button>
              <button
                disabled={!cameraActive || processing}
                onClick={() => handleAttendanceCheck('OUT', 'face_liveness')}
                className="min-h-[48px] rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm disabled:opacity-40 transition-colors"
              >
                Face Check OUT
              </button>
            </div>

            <button
              disabled={!cameraActive || !consent || processing}
              onClick={handleEnrollFace}
              className="w-full py-2.5 rounded-lg border border-sky-500/40 text-sky-400 hover:bg-sky-500/10 text-xs font-semibold disabled:opacity-40"
            >
              Enroll / Update Face Biometric Vector (Requires Consent)
            </button>

            <div className="pt-4 border-t border-slate-200 dark:border-white/10 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <KeyRound className="w-4 h-4 text-purple-400" />
                <span>PIN Fallback (When Camera Unavailable)</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  maxLength={6}
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  placeholder="Enter 4-digit PIN (e.g. 4821)"
                  className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 text-xs font-mono"
                />
                <button
                  disabled={!pinCode || processing}
                  onClick={() => handleAttendanceCheck('IN', 'pin_fallback')}
                  className="px-4 py-2.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 font-semibold text-xs disabled:opacity-40"
                >
                  PIN IN
                </button>
                <button
                  disabled={!pinCode || processing}
                  onClick={() => handleAttendanceCheck('OUT', 'pin_fallback')}
                  className="px-4 py-2.5 rounded-lg border border-purple-500/40 text-purple-400 font-semibold text-xs disabled:opacity-40"
                >
                  PIN OUT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-white/10 text-slate-500 text-left">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Employee</th>
                <th className="p-3">Branch</th>
                <th className="p-3">IN / OUT</th>
                <th className="p-3">Method & Liveness</th>
                <th className="p-3">Geofence</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Correction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="p-3 font-mono">{l.log_date}</td>
                  <td className="p-3 font-medium">{l.full_name}</td>
                  <td className="p-3">{l.branch_name}</td>
                  <td className="p-3 font-mono">{l.check_in_time || '-'} / {l.check_out_time || '-'}</td>
                  <td className="p-3 font-mono">
                    {l.method} {l.liveness_score > 0 ? `(Live ${(l.liveness_score * 100).toFixed(0)}%)` : ''}
                  </td>
                  <td className="p-3">
                    {l.geofence_ok ? <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Inside</span> : <span className="text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Outside</span>}
                  </td>
                  <td className="p-3 font-mono uppercase">{l.status}</td>
                  <td className="p-3 text-right">
                    {['super_admin', 'owner', 'branch_manager'].includes(session?.role || '') && (
                      <button
                        onClick={async () => {
                          await apiFetch('/api/staff/attendance/correct', {
                            method: 'POST',
                            body: JSON.stringify({ attendanceId: l.id, status: 'present', checkOutTime: l.check_out_time || '19:00', reason: 'Manager approved shift completion' }),
                          });
                          notify('success', 'Attendance corrected & audit logged');
                          loadAll();
                        }}
                        className="px-2 py-1 rounded border border-white/10 hover:border-sky-500/40 text-[11px]"
                      >
                        Approve / Fix
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'employees' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-white/10 text-slate-500 text-left">
              <tr>
                <th className="p-3">Employee</th>
                <th className="p-3">Role & Branch</th>
                <th className="p-3">Phone</th>
                <th className="p-3 text-right">Monthly Salary</th>
                <th className="p-3 text-right">Sales Target</th>
                <th className="p-3">Face Biometric</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="p-3">
                    <div className="font-semibold">{e.full_name}</div>
                    <div className="text-[11px] font-mono text-slate-500">{e.email}</div>
                  </td>
                  <td className="p-3">{e.role.replace('_', ' ')} · {e.branch_name || 'HQ'}</td>
                  <td className="p-3 font-mono">{e.phone}</td>
                  <td className="p-3 text-right font-mono">{sym}{Number(e.salary_monthly).toLocaleString()}</td>
                  <td className="p-3 text-right font-mono">{sym}{Number(e.monthly_target).toLocaleString()}</td>
                  <td className="p-3 font-mono">{e.face_enrolled ? <span className="text-emerald-400">ENROLLED</span> : <span className="text-amber-400">PENDING</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'payroll' && (
        <div className="bg-white dark:bg-[#11151E] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-[#171C28] border-b border-white/10 text-slate-500 text-left">
              <tr>
                <th className="p-3">Employee</th>
                <th className="p-3 text-right">Base Salary</th>
                <th className="p-3 text-right">Present / Late</th>
                <th className="p-3 text-right">Overtime Pay</th>
                <th className="p-3 text-right">Advances / Ded.</th>
                <th className="p-3 text-right">Net Payable</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {payroll.map((p) => (
                <tr key={p.id}>
                  <td className="p-3">
                    <div className="font-semibold">{p.full_name}</div>
                    <div className="text-[11px] text-slate-500">{p.branch_name || 'HQ'}</div>
                  </td>
                  <td className="p-3 text-right font-mono">{sym}{p.salary_monthly.toLocaleString()}</td>
                  <td className="p-3 text-right font-mono">{p.present_days}d / {p.late_days} late</td>
                  <td className="p-3 text-right font-mono text-emerald-400">+{sym}{p.overtime_pay.toLocaleString()}</td>
                  <td className="p-3 text-right font-mono text-red-400">-{sym}{p.advances_deductions.toLocaleString()}</td>
                  <td className="p-3 text-right font-mono font-bold text-sky-400">{sym}{p.net_salary.toLocaleString()}</td>
                  <td className="p-3 text-right space-x-1.5">
                    <button onClick={() => setAdjUser(p)} className="px-2 py-1 rounded border border-white/10 hover:border-sky-500/40">
                      + Advance/Bonus
                    </button>
                    <button
                      onClick={() => tenant && generateSalarySlipPdf(p, tenant)}
                      className="px-2 py-1 rounded bg-sky-500/15 text-sky-400 inline-flex items-center gap-1"
                    >
                      <FileDown className="w-3.5 h-3.5" /> Slip PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Register Employee Modal */}
      {showAddEmp && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/staff/employees', { method: 'POST', body: JSON.stringify(empForm) });
              notify('success', `Employee ${empForm.fullName} registered`);
              setShowAddEmp(false);
              loadAll();
            }}
            className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold text-base">Register Staff Member</h3>
            <input required placeholder="Full Name *" value={empForm.fullName} onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <input required type="email" placeholder="Work Email *" value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="grid grid-cols-2 gap-2">
              <select value={empForm.role} onChange={(e) => setEmpForm({ ...empForm, role: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                <option value="salesman">Salesman</option>
                <option value="cashier">Cashier</option>
                <option value="branch_manager">Branch Manager</option>
                <option value="accountant">Accountant</option>
              </select>
              <select value={empForm.branchId} onChange={(e) => setEmpForm({ ...empForm, branchId: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input placeholder="Mobile" value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
              <input placeholder="4-digit PIN" value={empForm.pinCode} onChange={(e) => setEmpForm({ ...empForm, pinCode: e.target.value })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              <input type="number" placeholder="Monthly Salary" value={empForm.salaryMonthly} onChange={(e) => setEmpForm({ ...empForm, salaryMonthly: Number(e.target.value) })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
              <input type="number" placeholder="Sales Target" value={empForm.monthlyTarget} onChange={(e) => setEmpForm({ ...empForm, monthlyTarget: Number(e.target.value) })} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddEmp(false)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Save Employee</button>
            </div>
          </form>
        </div>
      )}

      {/* Salary Adjustment Modal */}
      {adjUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/api/staff/salary-adjustments', {
                method: 'POST',
                body: JSON.stringify({ userId: adjUser.id, ...adjForm }),
              });
              notify('success', 'Payroll adjustment recorded');
              setAdjUser(null);
              loadAll();
            }}
            className="bg-white dark:bg-[#11151E] border border-white/10 rounded-xl max-w-sm w-full p-5 space-y-3 text-xs"
          >
            <h3 className="font-display font-bold">Salary Adjustment — {adjUser.full_name}</h3>
            <select value={adjForm.type} onChange={(e) => setAdjForm({ ...adjForm, type: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10">
              <option value="advance">Salary Advance (Deduct)</option>
              <option value="loan">Staff Loan Installment (Deduct)</option>
              <option value="deduction">Absence / Penalty Deduction</option>
              <option value="bonus">Incentive / Bonus (Add)</option>
            </select>
            <input type="number" required value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10 font-mono" />
            <input placeholder="Notes" value={adjForm.notes} onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#171C28] border border-white/10" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdjUser(null)} className="px-3 py-2 rounded-lg border border-white/10">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold">Record</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
