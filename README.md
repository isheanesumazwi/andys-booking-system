# Andy's Beechwood Car Care

A mobile-first React / Vite / Tailwind application with Supabase authentication and database storage. Deploy the frontend and vehicle lookup function together on Netlify or Vercel.

## Live app and repository

- Customer booking page: https://andys-beechwood-car-care.netlify.app
- Owner dashboard: https://andys-beechwood-car-care.netlify.app/admin
- Private repository: https://github.com/isheanesumazwi/andys-booking-system

Netlify is connected to the repository's `main` branch. A push or merge to `main` normally triggers a new production build and publishes the changes if the build succeeds. The GitHub repository remains private even though the booking website is public.

## Mac quick start

### Install once

1. Install [Visual Studio Code](https://code.visualstudio.com/) or your preferred editor.
2. Install Git through Apple's Command Line Tools. Open **Terminal**, run the following, and complete Apple's installation dialog:

   ```bash
   xcode-select --install
   ```

   If Terminal says the tools are already installed, continue. Full Xcode is not required.
3. Install **Node.js 22 LTS** from [Node.js downloads](https://nodejs.org/en/download). Choose the macOS installer appropriate for your Mac. npm is included; do not install React, Vite, or Tailwind globally.
4. For easy private-repository authentication, install [GitHub CLI](https://cli.github.com/). If you already use [Homebrew](https://brew.sh/), run `brew install gh`; otherwise use the installation options linked on the GitHub CLI site. Homebrew is optional.
5. Restart Terminal, then check:

   ```bash
   git --version
   node --version
   npm --version
   gh --version
   ```

   Use Node 22 to match the Netlify build environment. The Node installer and Git tools work on both Apple Silicon and Intel Macs.

### Sign in and clone

Authenticate directly with GitHub, not by putting passwords or tokens in source files:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
```

Follow the browser/device-code instructions and sign in as **isheanesumazwi**, or an account explicitly granted access to this private repository. If GitHub CLI already has a different account active, use `gh auth switch --hostname github.com --user isheanesumazwi` after signing in to the intended account.

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/isheanesumazwi/andys-booking-system.git
cd andys-booking-system
npm ci
cp .env.example .env.local
```

`npm ci` installs the exact dependencies recorded in `package-lock.json`. It requires no global framework installs. If you prefer not to install GitHub CLI, authenticate using GitHub Desktop or a GitHub SSH key instead; the remaining project commands are the same.

### Configure your Mac's environment

Open the cloned folder in VS Code with **File > Open Folder**, then edit `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-key
```

Replace both placeholders using your Supabase project's connection settings or the existing Netlify project's environment settings. The real `.env.local` is **not in GitHub**, so each computer needs its own copy. Never use a Supabase service-role/secret key in a `VITE_` variable.

Configure the server-only DVSA variables from `.env.example` to enable registration lookup; manual vehicle entry works without lookup. See the provider section below. Local files do not inherit Netlify environment variables automatically.

**Important: local frontend does not mean local database.** If you use the production Supabase URL, bookings, approvals, notes, and payments changed on your Mac affect the live business database. Prefer a separate Supabase development project for experiments. For an existing configured project, do not rerun `setup.sql` just because you cloned the code. For a new development project, complete the Supabase setup section below and create a separate test owner account.

### Start and check the app

```bash
npm run dev
```

Open the URL printed in Terminal (normally http://127.0.0.1:5173). `/book` opens customer intake; `/admin` opens owner login. Leave Terminal running and use **Control+C** to stop the server. Vite refreshes the browser when you save frontend edits; restart the server after editing `.env.local`.

Before pushing changes, stop the dev server or open a second Terminal in the project folder and run:

```bash
npm test
npm run build
```

To inspect the built frontend, run `npm run preview` and open its printed URL (normally http://127.0.0.1:4173). Preview does not run the Netlify/Vercel API functions; use `npm run dev` for normal local development and vehicle lookup. No separate Express server, local PostgreSQL install, Supabase CLI, or Netlify CLI is required for this workflow.

## How the app is constructed

| File or folder | Purpose / where to make changes |
| --- | --- |
| [`src/main.jsx`](src/main.jsx) | React entry point; mounts the app and loads its stylesheet. |
| [`src/App.jsx`](src/App.jsx) | Public booking form, Supabase login, owner dashboard, approval queue, agenda, payment/history views, and autosaving job dialog. Routing currently uses the browser pathname, not a routing library. |
| [`src/styles.css`](src/styles.css) | Tailwind import and custom responsive styling. Edit here for colours, spacing, layout, and mobile breakpoints. |
| [`src/supabaseClient.js`](src/supabaseClient.js) | Creates the Supabase browser client from the two `VITE_SUPABASE_` environment variables. |
| [`src/utils.js`](src/utils.js) | Booking validation, registration normalization, dates, currency, and supported statuses. |
| [`server/vehicle.js`](server/vehicle.js) | Server-only DVSA OAuth/token caching and vehicle lookup, plus optional legacy RapidAPI support. |
| [`src/HelpPage.jsx`](src/HelpPage.jsx) | Contact details, maps/directions, searchable FAQs, and service selection. |
| [`src/MonthCalendar.jsx`](src/MonthCalendar.jsx) | Monday-first whole-month agenda calendar with booking and pending-request counts. |
| [`vite.config.js`](vite.config.js) | React/Tailwind build plugins and the local `/api/vehicle` development middleware. |
| [`netlify/functions/vehicle.mjs`](netlify/functions/vehicle.mjs) | Production Netlify function exposing `/api/vehicle`; delegates to the shared server handler. |
| [`netlify.toml`](netlify.toml) | Netlify build command, Node version, published `dist` directory, functions bundling, and SPA fallback. |
| [`api/vehicle.js`](api/vehicle.js) / [`vercel.json`](vercel.json) | Alternative Vercel API adapter and routing configuration; not used for Netlify deployment. |
| [`supabase/setup.sql`](supabase/setup.sql) | Database tables, owner access policies, transactional booking RPCs, indexes, update timestamp trigger, and owner-only booking deletion. |
| [`supabase/booking-updates.sql`](supabase/booking-updates.sql) | Apply after setup: requested services, atomic owner amendments, and owner-only deletion RPC for upgraded installations. |
| [`supabase/job-cards.sql`](supabase/job-cards.sql) | Apply after booking-updates: adds the `job_card` column and the owner-only `save_job_card` RPC. |
| [`supabase/service-requests.sql`](supabase/service-requests.sql) | Apply after job-cards: lets customers describe any work in up to 200 characters instead of only the preset services. |
| [`supabase/booking-slots.sql`](supabase/booking-slots.sql) | Apply after service-requests: addresses, hourly slots, Wednesday/Thursday online booking and automatic confirmation of interim, full and major services. Withdraws the older intake functions, so deploy the matching frontend straight after. |
| [`supabase/job-photos.sql`](supabase/job-photos.sql) | Private storage for before and after inspection photos. |
| [`src/BookingFields.jsx`](src/BookingFields.jsx) / [`server/address.js`](server/address.js) | Booking address lookup, day and time slot picker, and the `/api/address` lookup. |
| [`supabase/staff-access.sql`](supabase/staff-access.sql) | Apply last: per-person permissions for the admin centre. Withdraws direct table access, so deploy the matching frontend straight after. Rerun after any other migration. |
| [`supabase/booking-contacts.sql`](supabase/booking-contacts.sql) | Apply after staff-access: matches phones on their last 10 digits, asks about changing an active booking when a known car is booked with a different phone, and saves a permanent copy of completed jobs. |
| [`src/AdminCentre.jsx`](src/AdminCentre.jsx) / [`src/permissions.js`](src/permissions.js) / [`server/staff.js`](server/staff.js) | Admin centre, permission and role definitions, and the `/api/staff` login function. |
| [`src/PhotoCarousel.jsx`](src/PhotoCarousel.jsx) / [`public/images/`](public/images/) | Home page workshop photo carousel. |
| [`src/JobCard.jsx`](src/JobCard.jsx) / [`src/jobCard.js`](src/jobCard.js) | Job card form, digital vehicle inspection diagram, printable receipt, checklist data and cost totals. |
| [`tests/`](tests/) | Node tests for validation, calendar, providers and API adapters; isolated PGlite PostgreSQL migration/permission tests. No live database is used. |
| [`package.json`](package.json) / [`package-lock.json`](package-lock.json) | npm commands, dependency declarations, and reproducible dependency versions. |
| [`.env.example`](.env.example) / [`.gitignore`](.gitignore) | Safe environment template and exclusions for secrets, dependencies, and generated builds. |
| [`index.html`](index.html) | Browser document, title, description, and React mount point. |

**Data flow:** the public form calls Supabase's `request_booking` RPC, which creates/reuses a customer and vehicle and inserts a pending job, including its requested service, in one database transaction. Customers cannot read workshop records. Owner login uses Supabase Auth; `app_admins` and row-level security enforce access. The dashboard uses owner-only RPCs for booking edits and deletion. The authenticated **Run a plate** dashboard tool calls `/api/vehicle`, never DVSA or DVLA directly from the browser.

**Booking steps:** the public form runs one step at a time: service, registration (with vehicle lookup), name, phone and email, address, day and time, then a summary where any section can be changed before booking. Email is required online and optional for workshop bookings; it is saved on the job by `booking-contacts.sql`.

**Booking rules:** customers book Wednesdays and Thursdays in one-hour slots from 10:30am, with the last start at 4:30pm. Booked slots show red and pending slots amber; deleting a booking frees its slot. Interim, full and major services are confirmed automatically when chosen unchanged. The owner can move any job to any day, including Sunday, from the job record. An address is mandatory. Set `IDEAL_POSTCODES_API_KEY` as a server-only variable to list addresses by postcode; without it the postcode is checked and the customer types the address.

**Admin centre:** people with the Admin centre permission can add team members, tick what each can do and deactivate or remove them. Rules are enforced in the database, and prices are not sent to anyone without the Prices & payments permission. The site must keep one active administrator. Creating logins and resetting passwords need the server-only `SUPABASE_SERVICE_ROLE_KEY`; without it, logins can be created in Supabase and added by email. Staff change their own password from the key icon in the sidebar.

**Job cards and receipts:** the **Job cards** section lists approved jobs with their progress through checked, priced, work done, QC passed and paid, and the next step for each. Open a card, or open a job and choose the **Job card** tab, to work through five steps: diagnosis & inspection (the 50-point service checklist marked OK / Advisory / Repair reqd, plus tyre, brake and emissions reports), the digital vehicle inspection (tap a panel on the car diagram to record scratches, dents and other damage), estimated parts & labour (labour cost can be typed directly or worked out from hours and rate), work carried out notes, and quality control & testing. The card autosaves. The **Receipt** tab shows customer and vehicle details, service dates, labour and parts with costs and the total; **Print receipt** prints only the receipt, and **Set amount due** copies the receipt total onto the booking. Requires `job-cards.sql`.

**Booking changes:** open a job or choose **Edit / delete booking** on a pending request. Edits autosave; changing a pending request does not approve it. Customer details are shared across that customer's bookings, and vehicle corrections apply to all visits for that vehicle. Changing to a registration already assigned to another vehicle is rejected rather than merging records. Deletion permanently removes only the selected job, including its notes and payment record; customer/vehicle records and other bookings remain. Deletion is owner-gated; existing deployments must apply `booking-updates.sql` to install its RPC.

**Calendar and help:** choose **Whole month** in the workshop agenda, navigate months and select a day to see its confirmed jobs below. Calendar counts include pending and completed bookings; pending requests remain in the review queue. `/help` and `/about` provide workshop contact details, an embedded location map, directions and searchable starter FAQs. **Go now** opens Apple Maps on Apple devices or Google Maps elsewhere. The service dropdown offers the eight requested services and carries the selection into `/book`.

**Security lives in Supabase too:** hiding a button or route is not a replacement for database policies. If you add a table, status, or new write action, update the validation, UI, and database constraints/policies together. Database changes are not deployed by Netlify; review and apply them separately in Supabase.

## Maintaining and pushing changes from your Mac

Set your commit identity once. Use your GitHub-verified email or GitHub's private `noreply` email:

```bash
git config --global user.name "Your name"
git config --global user.email "YOUR_GITHUB_COMMIT_EMAIL"
```

### Recommended: work on a branch

Start with a clean working tree. `git status` should show no uncommitted edits before switching branches or pulling. Commit your existing work or deliberately stash it first; do not discard changes you want to keep.

```bash
git status
git switch main
git pull --ff-only origin main
git switch -c improve-booking-page
```

Edit and test locally, then:

```bash
npm test
npm run build
git diff
git add src/App.jsx src/styles.css
git diff --cached
git commit -m "Improve booking page layout"
git push -u origin improve-booking-page
gh pr create --base main --fill
```

The `git add` example assumes you changed those two files; replace the paths with the actual files you intend to commit. Review staged changes and exclude credentials or customer data. Open the pull request on GitHub, review it, and merge it when ready. Merging into `main` triggers the live Netlify deployment. Netlify may also build deploy previews for pull requests.

After merging, return to your main branch before starting another change:

```bash
git switch main
git pull --ff-only origin main
```

### Simple alternative: push directly to main

For a small change you have tested, you can work on `main` instead:

```bash
git switch main
git pull --ff-only origin main
# Edit the files, then:
npm test
npm run build
git add README.md
git diff --cached
git commit -m "Update project documentation"
git push origin main
```

Replace `README.md` with your actual changed files. **This publishes to the live site automatically** after a successful Netlify build. If push is rejected because GitHub has newer changes, stop and reconcile them with `git pull --rebase origin main` on a clean working tree; resolve any conflicts, rerun tests/build, and then push. Do not use `git push --force` on `main`.

### Dependencies, deployment, and rollback

- On another computer or after pulling dependency changes, run `npm ci` again. Do not copy `node_modules` between Windows and macOS.
- To intentionally add a package, run `npm install package-name` (or `npm install -D package-name` for build/test tools). Commit **both** `package.json` and `package-lock.json`.
- Do not commit `.env.local`, other secret environment files, `node_modules`, or `dist`. `.env.example` may contain variable names and placeholders only.
- Changing `.env.local` affects only that Mac. Update production variables separately in Netlify, and rebuild for `VITE_` changes because those values are compiled into the frontend.
- Watch **Netlify > Project > Deploys** after pushing. If the new build fails, inspect its deploy log; an already-published successful deployment normally remains live.
- If a successfully deployed change is broken, restore a previous published deploy through Netlify, then revert the faulty commit in GitHub/Git so the next build does not reintroduce it. Reverting frontend code does not undo database writes or SQL migrations.
- Each production deployment consumes Free-plan credits, including documentation-only commits unless a build-ignore rule is configured. Batch related changes and monitor usage; previews/builds/traffic can consume other metered resources too.

### Common local problems

- **`git`, `node`, `npm`, or `gh` not found:** finish the relevant installation, restart Terminal, and recheck the version commands.
- **Repository not found / permission denied:** it is private. Check `gh auth status`, the active GitHub account, and repository access.
- **Supabase not configured:** check `.env.local` names and values, save, then restart `npm run dev`.
- **Owner access denied:** your Supabase Auth user must be listed in `app_admins` in the project your local environment points to.
- **Vehicle lookup unavailable:** expected until server-only provider settings and the exact endpoint are configured; manually enter make/model.
- **Port already in use:** open the alternate port Vite prints, or stop your earlier dev server with Control+C.
- **Native dependency errors after moving computers:** run `npm ci` on the target machine. Do not skip install scripts as a normal fix. The Windows group-policy block encountered on the original computer does not imply the same restriction exists on your Mac.

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

The production project URL and publishable key are configured in Netlify. Each local clone needs its own git-ignored `.env.local` as described above. A publishable key is intended for frontend use; it is **not** an admin/service-role key.

1. For a new project, run [`supabase/setup.sql`](supabase/setup.sql) in **SQL Editor**, then run [`supabase/booking-updates.sql`](supabase/booking-updates.sql), then [`supabase/job-cards.sql`](supabase/job-cards.sql), then [`supabase/service-requests.sql`](supabase/service-requests.sql), [`supabase/booking-slots.sql`](supabase/booking-slots.sql) , [`supabase/job-photos.sql`](supabase/job-photos.sql) , [`supabase/staff-access.sql`](supabase/staff-access.sql) and [`supabase/booking-contacts.sql`](supabase/booking-contacts.sql). For an existing installation with the original setup already applied, run the booking-updates migration (if not already applied) and then job-cards and service-requests before deploying this frontend. Both scripts retain existing rows. `setup.sql` now gives authenticated garage owners delete access to bookings; `booking-updates.sql` keeps that permission in place for upgraded installations and adds services plus the owner amendment RPC. If you rerun setup later, rerun booking-updates, job-cards, service-requests, booking-slots, staff-access and booking-contacts afterwards because setup replaces table grants and policies.
2. The script deliberately **replaces existing access policies and role grants on these four application tables**. Review it first if other applications use these tables. The transaction rolls back on failure. Existing rows must have supported status/payment values, non-negative amounts, and registrations unique after removing spaces and uppercasing. Resolve any conflicting existing data if the script reports a constraint/index error.
3. In **Authentication > Users**, create Andy's email/password user (or use an existing one), and confirm the account. Disable public sign-ups in Supabase Auth settings; the app provides no sign-up screen.
4. Run this separately, replacing the example email:

   ```sql
   insert into public.app_admins(user_id)
   select id from auth.users where email = 'andy@example.com'
   on conflict (user_id) do nothing;
   ```

   Verify that exactly the intended owner appears in `app_admins`. Only allowlisted accounts can read, amend or delete bookings; being authenticated alone is not enough.
5. Set the Auth **Site URL** to your deployed site. Add localhost if needed for development.

**Public booking safety:** anonymous visitors cannot select any customer, vehicle, or job rows. They only call `request_booking`, which validates input and writes all records in one transaction with `Pending Confirmation`. Existing vehicles are reused only with a matching contact phone; a changed phone/vehicle ownership requires contacting the workshop. Names/phones on existing records are never overwritten by public intake. Admin intake uses the same RPC with `Booked`, which is owner-gated.

## 2. Run locally

Use Node.js 22 to match Netlify. Configure `.env.local` first; see the Mac quick start above.

```powershell
npm ci
npm run dev
```

Open the localhost URL printed by Vite. The local Vite middleware serves `/api/vehicle`, so no separate backend process is needed.

```powershell
npm test
npm run build
```

`npm run preview` previews the static production frontend only; it does not run Netlify or Vercel API functions. Use `npm run dev` for local vehicle lookup.

## 3. Configure the vehicle provider

### DVSA MOT History API (recommended)

The supplied OAuth credential format is for the **DVSA MOT History API**, not DVLA Vehicle Enquiry. Its [authentication documentation](https://documentation.history.mot.api.gov.uk/mot-history-api/authentication/) and [OpenAPI specification](https://documentation.history.mot.api.gov.uk/mot-history-api/api-specification/) define the integration.

In `.env.local` for local development, or Netlify/Vercel environment settings for production:

```dotenv
VEHICLE_API_PROVIDER=dvsa
DVSA_CLIENT_ID=your-client-id
DVSA_CLIENT_SECRET="your-rotated-client-secret"
DVSA_API_KEY=your-rotated-api-key
DVSA_SCOPE_URL=https://tapi.dvsa.gov.uk/.default
DVSA_TOKEN_URL=https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token
```

Use the exact values issued by DVSA without line-wrapping or spaces inserted into URLs. Quote the client secret in dotenv files if it contains special characters; do not include those quote characters in hosting dashboard values. Rotate credentials shared in chat before production. Credentials are not included in source or notes, and no live provider call is made by the automated tests.

The server obtains a bearer token with form-encoded client credentials, caches it per warm process until shortly before expiry, shares in-flight token requests, and retries once with a fresh token on HTTP 401. Lookup uses `GET https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{registration}` with bearer authentication and `X-API-Key`. Only basic vehicle details and the latest MOT test result/expiry are returned to the browser, not MOT history or tokens. Token requests are restricted to the Microsoft Entra HTTPS tenant-token URL and the DVSA scope; redirects are rejected and each upstream request has a 10-second timeout. No-match, throttling, missing configuration and provider failures are shown explicitly with manual-entry guidance.

For failed lookups, the displayed error code identifies invalid token URL/scope settings, authentication rejection, connection failures, or an invalid vehicle response. Netlify function logs include the same code and the upstream HTTP status when available, never provider bodies, credentials, tokens, or raw exceptions. `DVSA_AUTH_REJECTED` means the token service rejected the client credentials; `DVSA_LOOKUP_REJECTED` means the vehicle endpoint rejected the request (check the API key and access permissions). Use these diagnostics rather than assuming that saved variable names mean their values are valid.

### Optional DVLA tax details

The DVSA MOT History API does **not** return vehicle tax status. The workshop's **Run a plate** page can also query the separate [DVLA Vehicle Enquiry Service (VES)](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/vehicle-enquiry-service/vehicle-enquiry-service-description.html) when `DVLA_VES_API_KEY` is set as a server-only environment variable. VES can provide tax status/due date and additional vehicle details; its data is merged with the DVSA make/model and MOT result. Without this key the plate tool still works for DVSA data and marks tax details as unavailable. DVLA currently says new VES registrations are closed, so use an existing issued VES key if available.

Restart Vite after changing local environment variables. Redeploy after changing hosting variables. Never prefix server credentials with `VITE_`. Enabling DVSA does not fall back silently to another provider.

### Optional legacy RapidAPI provider

Existing RapidAPI configurations remain supported. Set the provider explicitly to use them:

```dotenv
VEHICLE_API_PROVIDER=rapidapi
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

## 4. Deploy on Netlify Free (commercial use permitted)

Netlify explicitly permits commercial projects on its Free plan. The current plan has **300 credits per month**, shared across production deploys, requests, bandwidth, and compute. Production deploys currently cost 15 credits each. The site can pause when the allowance is exhausted; this is not unlimited free hosting. Check [current pricing](https://www.netlify.com/pricing/) and [commercial-use guidance](https://www.netlify.com/blog/introducing-netlify-free-plan/) before deploying.

1. Sign in to Netlify, choose **Add new project > Import an existing project**, and connect the `isheanesumazwi/andys-booking-system` GitHub repository. Stay on the **Free** plan.
2. Deploy branch `main`. `netlify.toml` sets the build command to `npm run build`, output to `dist`, Node to 22, and the functions directory to `netlify/functions`.
3. Before building, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables available to builds. Use your actual project URL and publishable key, not `.env.example` placeholders.
4. For DVSA lookup, add `VEHICLE_API_PROVIDER=dvsa` and all five `DVSA_` variables above with **Functions** scope (or all scopes). Optionally add `DVLA_VES_API_KEY` for tax details. Keep all provider credentials server-only; never use a `VITE_` prefix. The optional RapidAPI configuration is described separately above. Lookup remains an explicit manual-entry fallback without provider configuration.
5. Deploy, then set Supabase Auth's **Site URL** to the assigned HTTPS `netlify.app` URL.
6. Verify `/book`, `/admin`, and `/api/vehicle` on the deployment. The native function route handles `/api/vehicle`; the SPA fallback handles public/admin pages.
7. Test login and the booking lifecycle against your actual database. Monitor credit usage in Netlify.

`netlify/functions/vehicle.mjs` wraps the shared provider handler without changing the frontend API contract. No additional package or service-role key is needed. The existing Vite development middleware still supports local lookup.

## 5. Deploy on Vercel

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
- Verify requested service persistence, owner-only contact/vehicle amendments, permanent deletion confirmation and removal after reload, and the month/day agenda on desktop and mobile.
- Check contact links, maps/directions and FAQ search on `/help`.
- Test a duplicate registration/date and an existing vehicle with a different phone.
- Confirm vehicle lookup using the actual provider endpoint and subscription.
- Enable provider spending limits and appropriate abuse controls (WAF/rate limiting and, if needed, CAPTCHA verified by a server function). The public booking RPC and lookup endpoint are intentionally public and do not yet include a distributed per-IP rate limiter or CAPTCHA.
- Review backups, retention, and privacy obligations for customer contact information.

The local build and unit tests do not certify a remote Supabase configuration. Database and owner login verification require completing the setup in your Supabase project.
