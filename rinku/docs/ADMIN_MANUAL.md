# Admin & Operations Manual — TitanGrid Retail ERP

1. **White-Label Onboarding**: Sign in as Super Admin (`superadmin@titangrid.erp`) to provision new businesses or use the Initial Setup Wizard from the login page. Each tenant gets isolated stock, branches, staff, and credentials.
2. **Branch & GST Billing**: Set state codes per branch (`27` Maharashtra, `24` Gujarat, etc.). POS automatically switches between CGST+SGST (intrastate) and IGST (interstate). Use the Tile Sq.Ft Helper to convert floor area directly into required boxes.
3. **Face Attendance & Payroll**: Employees enroll face descriptors only after checking biometric consent. Every check-in verifies multi-frame motion/luminance liveness and branch GPS radius before recording IN/OUT. Monthly payroll auto-calculates overtime (1.5x) and deducts advances.
4. **9 AM Collection Automation**: Configure customer credit limits and due dates in CRM. Click "Run 9 AM Overdue Reminders" (or schedule via Cloud Scheduler). When payment is confirmed, reminders stop automatically and a thank-you receipt is dispatched.
5. **AI Brain**: Update delivery policies, warranties, and sales scripts in AI Brain Knowledge Base. Both Customer WhatsApp AI and Owner CFO Assistant refuse to invent stock or pricing not present in the database.
