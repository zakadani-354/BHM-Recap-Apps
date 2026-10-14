# Shared data setup

The app stores data in each browser by default. To share member and attendance
data between devices, configure the Supabase database and deploy the `/api`
serverless function alongside the static app.

1. In the Supabase SQL Editor, run [`schema.sql`](./schema.sql).
2. Set these environment variables in the hosting provider, then redeploy:
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
