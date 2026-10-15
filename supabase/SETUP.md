# Shared data setup

The app stores data in each browser by default. To share member and attendance
data between devices, configure the Supabase database and deploy the `/api`
serverless function alongside the static app.

1. In the Supabase SQL Editor for the project matching `SUPABASE_URL`, run the
   entire [`schema.sql`](./schema.sql) script. The final result row must show
   `true` for all six `*_ready` columns. If not, check the SQL Editor output
   for the first error and fix it before retrying the login.
2. In Vercel, add these environment variables under **Project > Settings >
   Environment Variables**. Select every environment where the app is deployed
   (Production, and Preview/Development if you use them), then redeploy:
   - `SUPABASE_URL`: the bare Project URL from Supabase Project Settings > API,
     for example `https://<project-ref>.supabase.co`. Do not append `/rest/v1`,
     `/auth/v1`, or any other path.
   - `SUPABASE_SERVICE_ROLE_KEY`: the server-only service role key from the same
     page. Never add this key to HTML, JavaScript, or a `NEXT_PUBLIC_` variable.
   - `BHM_SESSION_SECRET`: a long random secret used to sign login sessions.
   - `BHM_ATTENDANCE_LINK_TOKEN`: a random token of at least 32 characters for
     the attendance-only sign-in link. Generate one locally with
     `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
     Keep it only in the hosting environment variables; never commit it or put
     it in application source.
3. For local development, put those values in `.env.local`. Do not commit that
   file.
4. Sign in with the initial `admin` account (`admin123`) and change its password
   in Menu Admin immediately. Change the `pengurus` initial password as well.

The first admin login must be made from the device that currently contains the
data to preserve. It uploads that browser's existing local data if the shared
database is still empty. Once shared data exists, each login loads the shared
copy instead of that device's local copy. Admin accounts can edit member data;
admin and pengurus accounts can add attendance. Password changes are stored centrally.

To create the attendance-only link after deployment, set
`BHM_ATTENDANCE_LINK_TOKEN` and redeploy, then send the attendee this URL:
`https://<your-app-domain>/#presensi=<the-token>`. The browser fragment is not
sent in the page request or referrer; the app exchanges it by POST with its own
API. The resulting session receives only the member fields needed to choose
attendees and aggregate Terobosan counts, and can only add new attendance
records; it cannot read attendance history, replace/delete attendance, or edit
member data. Input Massal is disabled for this link. Rotate the token in Vercel
and redeploy to invalidate the link.
This link requires the hosted API and shared Supabase database; it does not
work when opening `index.html` directly from disk.

`Terobosan Pusat` is limited to one event date per calendar year across all
groups. Its attendance form and dashboard show present men and women separately.

If the API or Supabase is not configured, the app will clearly report that
shared sync is unavailable instead of suggesting that local-only data is shared.

## Troubleshooting Vercel login

If login reports that the shared database could not process the request, open
the failed deployment's **Functions** logs in Vercel and inspect the `/api`
function. The log includes the Supabase HTTP status and Postgres/PostgREST error
code, but never logs the API key or login password.

- `PGRST202` or `42883`: the RPC named in the Vercel Function log is missing or
  not in the PostgREST schema cache. Run the entire `schema.sql` in the correct
  project's SQL Editor. The script requests a schema-cache reload and shows a
  verification row; retry the login after confirming all six values are
  `true`.
- `PGRST205` or `42P01`: the shared-state table is missing. Run `schema.sql`
  against that project.
- `401`, `403`, or `42501`: verify the Vercel variable names and values, especially
  that `SUPABASE_SERVICE_ROLE_KEY` is the server-side service-role key rather
  than the anon/publishable key. Confirm the variables are enabled for the
  deployment's environment and redeploy after changing them.
- Any other status or code: check that `SUPABASE_URL` is the Project URL for the
  same Supabase project where `schema.sql` was run.
- A plain HTTP 404 without a Supabase error code usually means `SUPABASE_URL`
  points at the wrong address or includes an API path. Set it to the bare
  Project URL, save the Vercel variable, and redeploy.
