import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Invoice, TenantInfo } from '../types/erp';
import { triggerBlobDownload } from './api';

export function generateInvoicePdf(invoice: Invoice, tenant: TenantInfo, format: 'a4' | 'thermal' = 'a4') {
  const doc =
    format === 'thermal'
      ? new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 220] })
      : new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const sym = tenant.currency === 'INR' ? 'Rs.' : tenant.currency_symbol;

  if (format === 'thermal') {
    let y = 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(tenant.name.slice(0, 32), 40, y, { align: 'center' });
    y += 4.5;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.branch_name || '', 40, y, { align: 'center' });
    y += 4;
    doc.text(`GSTIN: ${invoice.branch_gstin || tenant.gstin || 'N/A'}`, 40, y, { align: 'center' });
    y += 4;
    doc.text('------------------------------------------', 40, y, { align: 'center' });
    y += 4;
    doc.text(`${invoice.doc_type.toUpperCase()}: ${invoice.invoice_no}`, 4, y);
    y += 3.8;
    doc.text(`Date: ${invoice.created_at.slice(0, 16).replace('T', ' ')}`, 4, y);
    y += 3.8;
    doc.text(`Customer: ${invoice.customer_name || 'Walk-in'}`, 4, y);
    y += 4;
    doc.text('------------------------------------------', 40, y, { align: 'center' });
    y += 4;

    for (const item of invoice.items || []) {
      doc.setFont('helvetica', 'bold');
      doc.text(item.product_name.slice(0, 34), 4, y);
      y += 3.6;
      doc.setFont('helvetica', 'normal');
      doc.text(`${item.qty} ${item.unit} x ${sym}${item.unit_price} (GST ${item.gst_rate}%)`, 4, y);
      doc.text(`${sym}${item.total.toFixed(2)}`, 76, y, { align: 'right' });
      y += 4.2;
    }

    doc.text('------------------------------------------', 40, y, { align: 'center' });
    y += 4;
    doc.text(`Taxable: ${sym}${invoice.taxable_amount.toFixed(2)}`, 4, y);
    y += 3.8;
    if (invoice.igst_amount > 0) {
      doc.text(`IGST: ${sym}${invoice.igst_amount.toFixed(2)}`, 4, y);
    } else {
      doc.text(`CGST: ${sym}${invoice.cgst_amount.toFixed(2)}  SGST: ${sym}${invoice.sgst_amount.toFixed(2)}`, 4, y);
    }
    y += 4.5;
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL: ${sym}${invoice.total_amount.toFixed(2)}`, 4, y);
    y += 4.5;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Paid: ${sym}${invoice.paid_amount.toFixed(2)} | Due: ${sym}${invoice.due_amount.toFixed(2)}`, 4, y);
    y += 6;
    doc.text('Thank you for your business!', 40, y, { align: 'center' });
    triggerBlobDownload(doc.output('blob'), `${invoice.invoice_no}_thermal.pdf`);
    return;
  }

  // A4 Tax Invoice PDF
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(tenant.legal_name || tenant.name, 14, 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`${invoice.branch_name} · ${invoice.branch_address || tenant.address}`, 14, 21);
  doc.text(`GSTIN: ${invoice.branch_gstin || tenant.gstin || 'N/A'} | Tel: ${tenant.phone}`, 14, 27);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(invoice.doc_type.toUpperCase(), 196, 14, { align: 'right' });
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.invoice_no, 196, 21, { align: 'right' });
  doc.text(`Date: ${invoice.created_at.slice(0, 10)}`, 196, 27, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Bill To:', 14, 44);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.customer_name || 'Walk-in Retail Customer', 14, 50);
  doc.text(`Phone: ${invoice.customer_phone || '-'} | GSTIN: ${invoice.customer_gstin || 'Unregistered'}`, 14, 56);
  doc.text(`Salesperson: ${invoice.salesman_name || 'Counter'} | Status: ${invoice.payment_status.toUpperCase()}`, 14, 62);

  autoTable(doc, {
    startY: 68,
    head: [['SKU', 'Item Description', 'HSN', 'Qty', 'Rate', 'Disc%', 'Taxable', 'GST', 'Total']],
    body: (invoice.items || []).map((it) => [
      it.sku,
      it.product_name,
      it.hsn_code,
      `${it.qty} ${it.unit}`,
      `${sym}${it.unit_price.toFixed(2)}`,
      `${it.discount_pct}%`,
      `${sym}${it.taxable_value.toFixed(2)}`,
      `${sym}${(it.cgst + it.sgst + it.igst).toFixed(2)} (${it.gst_rate}%)`,
      `${sym}${it.total.toFixed(2)}`,
    ]),
    styles: { fontSize: 8.2, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  const finalY = (doc as any).lastAutoTable?.finalY + 8 || 140;
  doc.setFontSize(9.5);
  doc.text(`Subtotal: ${sym}${invoice.subtotal.toFixed(2)}`, 140, finalY);
  doc.text(`Discount: -${sym}${invoice.discount_amount.toFixed(2)}`, 140, finalY + 5.5);
  doc.text(`Taxable Value: ${sym}${invoice.taxable_amount.toFixed(2)}`, 140, finalY + 11);
  if (invoice.igst_amount > 0) {
    doc.text(`IGST: ${sym}${invoice.igst_amount.toFixed(2)}`, 140, finalY + 16.5);
  } else {
    doc.text(`CGST: ${sym}${invoice.cgst_amount.toFixed(2)} | SGST: ${sym}${invoice.sgst_amount.toFixed(2)}`, 140, finalY + 16.5);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Grand Total: ${sym}${invoice.total_amount.toFixed(2)}`, 140, finalY + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Paid: ${sym}${invoice.paid_amount.toFixed(2)} | Balance Due: ${sym}${invoice.due_amount.toFixed(2)}`, 140, finalY + 30);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(tenant.branding?.invoiceFooter || 'Authorized Computer Generated Tax Invoice', 14, 282);

  triggerBlobDownload(doc.output('blob'), `${invoice.invoice_no}.pdf`);
}

export function generateSalarySlipPdf(
  emp: {
    full_name: string;
    role: string;
    branch_name: string;
    salary_monthly: number;
    present_days: number;
    late_days: number;
    overtime_mins: number;
    overtime_pay: number;
    advances_deductions: number;
    bonuses: number;
    net_salary: number;
  },
  tenant: TenantInfo
) {
  const doc = new jsPDF();
  const sym = tenant.currency === 'INR' ? 'Rs.' : tenant.currency_symbol;
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`${tenant.name} — Employee Salary Slip`, 14, 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Pay Period: ${new Date().toISOString().slice(0, 7)} | Branch: ${emp.branch_name || 'HQ'}`, 14, 21);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.text(`Employee: ${emp.full_name} (${emp.role.replace('_', ' ').toUpperCase()})`, 14, 40);
  doc.text(`Present Days: ${emp.present_days} | Late Marks: ${emp.late_days} | Overtime: ${emp.overtime_mins} mins`, 14, 47);

  autoTable(doc, {
    startY: 55,
    head: [['Component', 'Type', 'Amount']],
    body: [
      ['Basic Monthly Salary', 'Earning', `${sym}${emp.salary_monthly.toLocaleString()}`],
      ['Overtime Compensation (1.5x)', 'Earning', `${sym}${emp.overtime_pay.toLocaleString()}`],
      ['Performance Bonus', 'Earning', `${sym}${emp.bonuses.toLocaleString()}`],
      ['Advances / Loans / Deductions', 'Deduction', `-${sym}${emp.advances_deductions.toLocaleString()}`],
      ['NET PAYABLE SALARY', 'Total', `${sym}${emp.net_salary.toLocaleString()}`],
    ],
    headStyles: { fillColor: [15, 23, 42] },
  });

  triggerBlobDownload(doc.output('blob'), `SalarySlip_${emp.full_name.replace(/\s+/g, '_')}.pdf`);
}
