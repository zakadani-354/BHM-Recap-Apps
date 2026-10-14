# Shared data setup

The app stores data in each browser by default. To share member and attendance
data between devices, configure the Supabase database and deploy the `/api`
serverless function alongside the static app.

1. In the Supabase SQL Editor, run [`schema.sql`](./schema.sql).
2. In Vercel, add these environment variables under **Project > Settings >
   Environment Variables**. Select every environment where the app is deployed
   (Production, and Preview/Development if you use them), then redeploy:
   - `SUPABASE_URL`: the project URL from Supabase Project Settings > API.
   - `SUPABASE_SERVICE_ROLE_KEY`: the server-only service role key from the same
     page. Never add this key to HTML, JavaScript, or a `NEXT_PUBLIC_` variable.
   - `BHM_SESSION_SECRET`: a long random secret used to sign login sessions.
3. For local development, put those values in `.env.local`. Do not commit that
   file.
4. Sign in with the initial `admin` account (`admin123`) and change its password
   in Menu Admin immediately. Change the `pengurus` initial password as well.

The first admin login must be made from the device that currently contains the
data to preserve. It uploads that browser's existing local data if the shared
database is still empty. Once shared data exists, each login loads the shared
copy instead of that device's local copy. Admin accounts can edit member data;
both roles can add attendance. Password changes are stored centrally.

If the API or Supabase is not configured, the app will clearly report that
shared sync is unavailable instead of suggesting that local-only data is shared.

## Troubleshooting Vercel login

If login reports that the shared database could not process the request, open
the failed deployment's **Functions** logs in Vercel and inspect the `/api`
function. The log includes the Supabase HTTP status and Postgres/PostgREST error
code, but never logs the API key or login password.

- `PGRST202` or `42883`: the authentication RPC is missing or not in the schema
  cache. Run `schema.sql` in the correct Supabase project's SQL Editor, then
  retry after a short delay.
- `PGRST205` or `42P01`: the shared-state table is missing. Run `schema.sql`
  against that project.
- `401`, `403`, or `42501`: verify the Vercel variable names and values, especially
  that `SUPABASE_SERVICE_ROLE_KEY` is the server-side service-role key rather
  than the anon/publishable key. Confirm the variables are enabled for the
  deployment's environment and redeploy after changing them.
- Any other status or code: check that `SUPABASE_URL` is the Project URL for the
  same Supabase project where `schema.sql` was run.
