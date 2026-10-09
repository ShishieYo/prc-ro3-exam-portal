# Setup

## 1. Supabase project
Create a Supabase project. In **Authentication → Providers → Email** enable *Confirm email*. Under **Authentication → URL Configuration** set the Site URL to your deployed URL and add `<site>/sign-in` and `<site>/reset-password` as redirect URLs. PKCE flow is used.

## 2. Apply migrations
Run `supabase/migrations/0001…0009*.sql` **in order** (Supabase SQL editor, or `supabase db push` with the CLI). They create the schema, RLS policies, workflow guards, audit triggers, the private `volunteer-documents` bucket and its policies, and seed reference data (professions, positions, document requirements, a proposed CPD rule v1 = 2 units/day, an *inactive placeholder* allowance rule).

Rollback: migrations are forward-only. For development, reset the database and re-apply. In production take a backup first and write a compensating migration.

## 3. Environment
`.env` (never commit): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key). **Never** put the service-role key in the frontend.

## 4. Allowance amounts
No allowance amount is assumed. A Finance officer must create the approved rule under *System Settings → Allowance rules* before allowances can be approved.

## 5. Tests
`npm test` runs the SQL migrations on PGlite with Supabase stubs and exercises RLS as different users. `npm run test:e2e` needs Chromium (`/opt/pw-browsers`).
