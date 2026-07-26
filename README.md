# Contractor CRM

Production build of the contractor CRM, modeled after the prototype in
[`reference/contractor-crm.jsx`](reference/contractor-crm.jsx) and
[`crm-production-spec_1.md.docx`](crm-production-spec_1.md.docx). Next.js +
TypeScript + Tailwind on the frontend, Supabase (Postgres + Auth) on the
backend, deployed on Vercel.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase project URL + keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

Schema + Row Level Security policies live in
[`supabase/schema.sql`](supabase/schema.sql). To apply:

1. Open the Supabase project dashboard -> **SQL Editor**.
2. Paste the contents of `supabase/schema.sql` and run it.

This creates all core tables (leads, jobs, documents, events, contracts,
profiles, companies, company_profile), enums, indexes, an
`auth.users` -> `profiles` sync trigger, and RLS policies enforcing the
Office/Field role split server-side.

## Roles

Two roles: `Office` (full access) and `Field` (read everything, write only
jobs + calendar/schedule). The first user ever created is auto-promoted to
`Office`; every user after that starts with no role until an Office user
assigns one from Admin Settings -> Users & Roles.

## Deployment

Deployed on Vercel, connected to this repo's `main` branch. Environment
variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) are configured in the Vercel project settings,
not committed.
