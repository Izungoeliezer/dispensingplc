# Dispensing Unit (Next.js + Supabase + Vercel)

## Setup
1. **Supabase**: create a project → SQL Editor → run `supabase/schema.sql`, then `supabase/seed_medicines.sql` (618 medicines from the NEML, price 0).
2. Supabase → Authentication → Providers → Email: turn **off** "Allow new users to sign up" (admin creates staff) ; optionally turn off "Confirm email".
3. Authentication → Users → **Add user** for yourself, then in SQL Editor make yourself admin:
   `update public.profiles set role='admin' where email='YOU@example.com';`
4. Push this folder to GitHub → Vercel → Import repo → add env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → API) → Deploy.
5. Log in → Admin: assign roles (prescriber / dispenser) to other users, set prices.

Local run: copy `.env.example` to `.env.local`, `npm install`, `npm run dev`.
