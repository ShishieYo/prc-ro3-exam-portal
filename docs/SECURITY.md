# Security, RLS and privacy

## Principles
Deny by default: RLS is enabled on every table; default privileges for `anon`/`authenticated` are revoked and grants are explicit (column-level where users edit their own rows). State changes go through guard triggers or `SECURITY DEFINER` functions that check `has_permission()`; UI hiding is only a convenience.

## Roles → permissions (`role_permissions` table, migration 0001)
| Role | Notable permissions |
|---|---|
| volunteer | own data only (policies by ownership) |
| system_admin | users.manage, settings.manage, audit.view, reports.view |
| admin | volunteers/documents/credentials review, events, positions, venues, assignments (manage+approve), attendance (verify/correct), allowance.approve, cpd review/approve/adjust, rules, imports, reports+export, audit |
| coordinator | events, assignments.manage, external personnel, imports, view volunteers/preferences; **no financial data** |
| attendance_officer | roster view, record/submit attendance |
| finance_officer | allowance process, payments, masked + (with purpose, logged) full TIN/bank, allowance rules |
| cpd_officer | CPD review/approve/adjust, CPD rules |
| supervisor | assignments/attendance **only for events they supervise** |
| auditor | read-only dashboards, audit log |

## Sensitive financial data
`volunteer_financial` has no table privileges for API roles. Volunteers use `save_my_financial` / `get_my_financial` (masked). Staff use `get_financial_masked` or `get_financial_full(volunteer, purpose)` (finance only; writes an audit event). Audit payloads redact `tin` and `bank_account_no`. Exports never include them. Encryption at rest is provided by Supabase storage; add column encryption (pgsodium/Vault) if PRC policy requires.

## Integrity
Audit log is append-only (no grants + trigger). Assignment, attendance, allowance and CPD transitions are validated in the database; verified attendance, paid payments and approved CPD can change only through documented corrections with a reason. Rules (allowance/CPD) are versioned and immutable.

## Tested
`tests/db/*.test.ts` covers: anonymous access, role escalation, cross-volunteer access, TIN/bank protection, document upload constraints, coordinator/finance/auditor separation, supervisor scoping, audit immutability, attendance/allowance/CPD workflows and calculations.

## Not claimed
Technical safeguards do not establish compliance with RA 10173 (Data Privacy Act). Obtain DPO/legal review; define retention/deletion procedures (settings `retention.*` are informational; deletion jobs are not implemented). Storage RLS and email/auth rate limits rely on Supabase configuration; verify them in the live project. Consider enabling CAPTCHA/MFA for staff.
