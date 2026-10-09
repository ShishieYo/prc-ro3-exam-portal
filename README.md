# PRC Region III — Licensure Examination Personnel Portal

*One Portal. Organized Examination Operations.*

Database-backed web portal for PRC Regional Office III to manage volunteer examination personnel:
**Registration → Verification → Preference → Assignment → Confirmation → Deployment → Attendance → Allowance → CPD → Reporting**, with an audit trail at every step.

Stack: React 19 + TypeScript + Vite + Tailwind 4 · Supabase (PostgreSQL, Auth, Storage) · React Query · React Hook Form + Zod · Recharts.

## Quick start

```bash
npm install
cp .env.example .env        # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public values only)
# apply supabase/migrations/*.sql in order (see docs/SETUP.md)
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build (+ SPA fallback for static hosts) |
| `npm test` | Unit tests + database tests (RLS, workflows, calculations) on an in-memory Postgres (PGlite) |
| `npm run test:e2e` | Browser smoke tests against the built app with a mocked API |

## Documentation
- [Setup & database initialisation](docs/SETUP.md) · [First administrator](docs/ADMIN_SETUP.md)
- [Deployment](docs/DEPLOYMENT.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security, RLS & privacy](docs/SECURITY.md) · [Schema & business rules](docs/SCHEMA.md)
- [Email/notifications](docs/EMAIL.md) · [Known limitations & decisions needing PRC approval](docs/KNOWN_LIMITATIONS.md)

> This is an internal operational system. It must undergo privacy, legal, records-management and information-security review before production use. No official PRC seal is bundled (logo placeholder only).
