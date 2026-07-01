← [SPEC.md](../SPEC.md)

## Local Development Setup

### Prerequisites
- Node.js 22 LTS (see `.nvmrc`)
- pnpm 9+
- Docker runtime (OrbStack recommended on macOS, or Docker Desktop) — required by `supabase start`
- Supabase CLI
- Latest release version of Xcode

### Web
```bash
pnpm create next-app@latest storylane-web --typescript --tailwind --app
cd storylane-web
pnpm add @supabase/supabase-js @supabase/ssr
```

### iOS
- Add `supabase-swift` as a Swift Package in Xcode
  - URL: `https://github.com/supabase/supabase-swift`

### Supabase
```bash
supabase init
supabase start    # start local DB
supabase db push  # apply migrations
```

### Skipping login locally
`supabase db reset` (or `supabase start` on a fresh DB) seeds a fixed dev
account via `supabase/seed.sql`. Run `pnpm dev` and open `/auth/login` — a
"Continue as dev user" button appears below the OAuth options (local builds
only, `NODE_ENV !== "production"`) and signs in with a real Supabase session
via `signInWithPassword`, so RLS behaves exactly as it would for a real user.
