# Troubleshooting
- **"Portal is not configured"** – `.env` missing/incorrect; restart `npm run dev` or rebuild.
- **Sign-in says email not confirmed** – confirm via the email link; check Supabase email provider/SMTP and spam. Built-in Supabase SMTP is rate-limited; configure custom SMTP for production.
- **Staff user sees "Access denied"** – role not granted or account not `active`. Suspended/pending accounts hold no staff permissions.
- **"Not authorized (…)"** errors – the database refused the action (RLS/permission). Check the matrix in docs/SECURITY.md.
- **Cannot publish an event** – the message lists what is missing (dates, venue, staffing requirements, recruitment period, deadline).
- **Volunteer cannot be released** – the error lists blockers (unverified profile, missing document verification, no verified licence, schedule conflict).
- **Allowance stays "Requirements incomplete"** – missing TIN, unverified bank account/documents, or no active allowance rule. Use *Re-evaluate eligibility*.
- **Upload fails** – file must be PDF/JPEG/PNG ≤ 5 MB; bucket `volunteer-documents` must exist (migration 0008).
- **Routes 404 on refresh in production** – host needs an SPA rewrite (see DEPLOYMENT.md).
