# Known limitations and decisions needing PRC approval

## Not implemented / partial
- Bulk import is implemented for **external personnel (CSV/XLSX)** only. Importing volunteer accounts, historical assignments, attendance or payments needs a service-role Edge Function (not included, to avoid shipping privileged keys).
- Email/SMS delivery (see EMAIL.md); reporting reminders are not scheduled jobs.
- Data retention/deletion jobs; column-level encryption of TIN/bank values.
- The recommendation engine runs in the browser over `candidate_pool`; weights come from `recommendation.weights` (editable in Settings).
- Assignment notice is a printable page (browser print/save as PDF), not a generated PDF file; CPD certificates are references only.
- Calendar shows examination dates; no drag-and-drop planning.
- Not verified here: a live Supabase deployment, hosting, Supabase Storage policies on a real project (tested only with stubs), email delivery, large-data performance. DB tests run on PGlite, not the hosted platform.
- No demo seed data is shipped. Create fictional data in a development project only.

## Decisions for PRC management
1. Allowance amounts, eligibility per position, and approval authority.
2. CPD rule: validate "1 verified service day = 2 units" with PRC/PRBs; qualifying-day definition; whether late/partial days count; which positions/professions qualify.
3. Whether volunteer acceptance needs approval (`assignment.confirmation_requires_approval`) and whether releases need approval (`assignment.requires_approval`).
4. Document requirements and which are needed before assignment vs allowance.
5. Retention periods, DPO review, privacy notice wording, official logo.
6. Whether supervisors may record attendance for events they supervise (enabled) and who may verify.
