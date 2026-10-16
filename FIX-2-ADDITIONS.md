# Fix 2 additions

## Changes

- Bold booking heading: "Book your car service here."
- "Tell us what you need" dropdown with MOT, MOT and Service, Service, oil/filter change, brake work, starter motor replacement, alternator replacement and Fault Finder.
- DVSA MOT History registration lookup through the existing server API, with OAuth client credentials, cached tokens, one authentication retry and explicit manual-entry guidance.
- Owner-only corrections to customer, vehicle, requested service, booking date and job/payment details in one transaction.
- Confirmed permanent deletion for pending and existing jobs. Other bookings, customers and vehicles are retained.
- Whole-month calendar with month navigation, daily booking/pending counts and the existing selected-day job list.
- About/help page with the supplied phone, email and address, embedded map, Apple/Google directions and searchable starter FAQs.

## Deployment order

1. On the existing Supabase project, review and run [`supabase/booking-updates.sql`](supabase/booking-updates.sql) in SQL Editor **before deploying the new frontend**. For a brand-new project, run [`supabase/setup.sql`](supabase/setup.sql) first.
2. Rotate the exposed DVSA client secret and API key. Add `VEHICLE_API_PROVIDER=dvsa`, `DVSA_CLIENT_ID`, `DVSA_CLIENT_SECRET`, `DVSA_API_KEY`, `DVSA_SCOPE_URL` and `DVSA_TOKEN_URL` to the hosting function environment. Use [`.env.example`](.env.example) as a template; never commit actual credentials.
3. Build and deploy the branch to a preview first. No production database migration, deployment or live provider test is performed automatically by these changes.
4. Check booking/service persistence, amendment, deletion after reload, month navigation, mobile layout, contact links and live DVSA lookup using authorized test data.

Customer details are shared between that customer's bookings. Vehicle corrections apply to all visits for the same vehicle. Existing bookings with no service remain valid. The original ten-argument booking RPC remains available for older deployed clients.

## Validation

- Local result: all 32 tests pass; no editor diagnostics were reported in changed source, server or test files.
- `npm test` includes isolated PostgreSQL migration, permission, edit/rollback, duplicate-date, registration-conflict, legacy-intake and deletion tests using dev-only PGlite; it never connects to live Supabase.
- Provider tests cover OAuth encoding, response mapping, token caching/refresh, host/scope restrictions and failure handling. Calendar tests cover complete Monday-first months, leap years and year boundaries.
- The standard production build must be checked on CI or another permitted machine: Windows Group Policy on the development machine blocks the existing native esbuild executable. Do not disable or bypass that policy.
- JSX source syntax is checked separately with the installed Babel parser. This is not a substitute for a production build or live browser testing.
