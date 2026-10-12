# Andy's Beechwood Car Care

A mobile-first React / Vite / Tailwind application with Supabase authentication and database storage. Deploy the frontend and vehicle lookup function together on Vercel.

## Included

- `/` and `/book`: public booking requests, debounced vehicle lookup, manual vehicle entry, and confirmation.
- `/admin`: password login and an owner-only workshop dashboard.
- Pending requests with approval and reschedule/contact actions.
- Seven-day agenda, arbitrary date navigation, and name/registration search.
- Job record dialog with autosaved diagnosis, parts, date, status, fees, and payment state.
- Cross-date outstanding payments and completed-job history.
- Atomic customer/vehicle/job creation, duplicate request checks, row-level security, and explicit owner allowlisting.

There are no fabricated bookings or demo records. An empty dashboard means no confirmed bookings exist for that date.

## 1. Supabase setup (required)

The supplied project URL and publishable key are configured in the local, git-ignored `.env.local`. A publishable key is intended for frontend use; it is **not** an admin/service-role key.

1. Open your project in Supabase and run [`supabase/setup.sql`](supabase/setup.sql) in **SQL Editor**. It supports the three existing tables from the project brief and retains their rows. It adds `app_admins`, the booking RPC, indexes, constraints, an update timestamp trigger, and owner-only policies.
2. The script deliberately **replaces existing access policies and role grants on these four application tables**. Review it first if other applications use these tables. The transaction rolls back on failure. Existing rows must have supported status/payment values, non-negative amounts, and registrations unique after removing spaces and uppercasing. Resolve any conflicting existing data if the script reports a constraint/index error.
3. In **Authentication > Users**, create Andy's email/password user (or use an existing one), and confirm the account. Disable public sign-ups in Supabase Auth settings; the app provides no sign-up screen.
4. Run this separately, replacing the example email:

   ```sql
   insert into public.app_admins(user_id)
   select id from auth.users where email = 'andy@example.com'
   on conflict (user_id) do nothing;
   ```

   Verify that exactly the intended owner appears in `app_admins`. Only allowlisted accounts can read records or update jobs; being authenticated alone is not enough.
5. Set the Auth **Site URL** to your deployed site. Add localhost if needed for development.

**Public booking safety:** anonymous visitors cannot select any customer, vehicle, or job rows. They only call `request_booking`, which validates input and writes all records in one transaction with `Pending Confirmation`. Existing vehicles are reused only with a matching contact phone; a changed phone/vehicle ownership requires contacting the workshop. Names/phones on existing records are never overwritten by public intake. Admin intake uses the same RPC with `Booked`, which is owner-gated.

## 2. Run locally

Use Node.js 22 or newer.

```powershell
npm install
npm run dev
```

Open the localhost URL printed by Vite. The local Vite middleware serves `/api/vehicle`, so no separate backend process is needed.

```powershell
npm test
npm run build
```

`npm run preview` previews the static production frontend only; it does not run Vercel API functions. Use `npm run dev` for local vehicle lookup.

## 3. Configure the vehicle provider

The supplied hostname does not identify the actual endpoint, request parameters, or response schema. Until the request example is supplied, the application explicitly offers manual make/model entry rather than calling a guessed endpoint.

In `.env.local` for local development, or Vercel environment settings for production:

```dotenv
RAPIDAPI_KEY=your-new-rapidapi-key
RAPIDAPI_HOST=uk-vehicle-data1.p.rapidapi.com
VEHICLE_API_URL=https://uk-vehicle-data1.p.rapidapi.com/EXACT_ENDPOINT?EXACT_PARAMETER={registration}
VEHICLE_API_METHOD=GET
```

For a POST endpoint:

```dotenv
VEHICLE_API_METHOD=POST
VEHICLE_API_BODY={"EXACT_PARAMETER":"{registration}"}
```

Copy the exact URL and parameter names from RapidAPI's **Code Snippets** tab. These examples are templates, not a verified provider contract. Restart Vite after changing environment variables. The parser in [`server/vehicle.js`](server/vehicle.js) covers common flat and nested make/model/year/engine-capacity shapes; adapt it if the actual provider response differs.

The RapidAPI key stays on the server. **Never** put it in a `VITE_` variable or browser request. The server restricts upstream requests to the configured HTTPS RapidAPI host, prevents redirects, has a 10-second timeout, and returns only the vehicle fields needed by the app.

The key supplied in chat has been placed only in the ignored local environment file. **Rotate it before production**, and set the replacement as a server-only Vercel variable. Do not publish the local environment file.

## 4. Deploy on Vercel

1. Put the project in a private Git repository, excluding `.env.local`, `node_modules`, and `dist`.
2. Import it into Vercel and select **Vite**: build `npm run build`, output `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel's environment settings.
4. Add server-only provider variables if enabling lookup. Redeploy when environment settings change.
5. Set your Supabase Auth Site URL to the deployment URL.
6. Verify `/book`, `/admin`, and `/api/vehicle` on the deployed domain.

`vercel.json` preserves the API route and maps app routes to the SPA entry point. No Supabase service-role key is required.

**Hosting terms:** Vercel Hobby is intended for personal/non-commercial projects. Check current Vercel terms before using it to run a commercial workshop; Vercel Pro or an alternative host may be necessary.

## Before opening to real customers

- Complete the SQL setup and owner allowlist; test using an anonymous session and a non-owner authenticated account.
- Make a test request, approve it, move its date, add diagnosis/parts, and verify its amount and payment status survive a reload.
- Test a duplicate registration/date and an existing vehicle with a different phone.
- Confirm vehicle lookup using the actual provider endpoint and subscription.
- Enable provider spending limits and appropriate abuse controls (WAF/rate limiting and, if needed, CAPTCHA verified by a server function). The public booking RPC and lookup endpoint are intentionally public and do not yet include a distributed per-IP rate limiter or CAPTCHA.
- Review backups, retention, and privacy obligations for customer contact information.

The local build and unit tests do not certify a remote Supabase configuration. Database and owner login verification require completing the setup in your Supabase project.
