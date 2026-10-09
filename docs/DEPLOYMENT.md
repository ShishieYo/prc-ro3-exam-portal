# Deployment

The app is a static SPA; Supabase is the backend. No existing deployment target was present, so the recommendation is any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

- Set build env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `npm run build` outputs `dist/` including `404.html` (copy of `index.html`) so client-side routes work on GitHub Pages. For a sub-path host set `VITE_BASE=/repo-name/`.
- Netlify/Vercel/Cloudflare: configure an SPA rewrite of all paths to `/index.html`.
- `.github/workflows/ci.yml` runs typecheck, tests and build on every push/PR. **Deployment has not been performed or verified from this repository**; add your host's deploy step after review.
- Add the deployed origin to Supabase redirect URLs.
