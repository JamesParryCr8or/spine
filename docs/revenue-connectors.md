# Lead-generation revenue connectors

Revenue & Costs is available in lead-generation workspaces. It reports actual receipts separately from GoHighLevel opportunity values. CSV works immediately after applying the revenue migrations. Stripe and Sheets require their OAuth app settings in the server environment.

## Stripe Connect OAuth

Configure a Stripe Connect platform for Standard accounts and enable OAuth. Add this exact redirect URI in Stripe and Vercel:

`https://spine-nine-orpin.vercel.app/api/revenue/connect/stripe/callback`

Server variables:

- `STRIPE_CONNECT_CLIENT_ID`: the live Connect client ID (`ca_…`).
- `STRIPE_SECRET_KEY`: the platform's live secret key, used only for the OAuth code exchange.
- `STRIPE_CONNECT_REDIRECT_URI`: the callback above.
- `REVENUE_OAUTH_STATE_SECRET`: a random secret for signing short-lived connection state. The existing Supabase service role secret is used if this is omitted.

Standard Connect uses `read_write` authorisation; read-only OAuth is reserved for Stripe extensions. Spine makes read requests for charges and refunds, and does not initiate payments. Test-mode connections are rejected. Authorisation codes are exchanged once, never retried.

Use **Connections → Stripe → Connect Stripe**, then **Import payments & refunds**. Imports page through complete history, saving a resumable checkpoint after each page. Keep the page open. If interrupted, run it again; stable account/payment IDs prevent double-counting. Successful captured payments use captured amounts. Successful refunds are separate negative receipt events on the refund date, using the store timezone. ISK and UGX Stripe amounts are normalized to zero-decimal reporting units.

Only explicitly supplied `ghl_opportunity_id` payment/refund metadata is linked to a GHL opportunity. Spine does not guess links from customer names. Payment processing fees are not imported by this connector. Disconnect removes local credentials and retains historical imports; revoke app access in Stripe if desired.

## Google Sheets OAuth

Enable Google Sheets API in a Google Cloud project. Configure a web OAuth client and consent screen. Allow this redirect:

`https://spine-nine-orpin.vercel.app/api/revenue/connect/google_sheets/callback`

Server variables:

- `GOOGLE_SHEETS_CLIENT_ID`
- `GOOGLE_SHEETS_CLIENT_SECRET`
- `GOOGLE_SHEETS_REDIRECT_URI`

The connector requests the `https://www.googleapis.com/auth/spreadsheets` scope and offline access. Existing Google Ads credentials are not reused implicitly. Google may require consent verification or test-user registration before external users can connect.

Connect Google, then **Create template**. This creates a private spreadsheet in the connected Google account, with a Summary tab and an Entries tab. Year/month dropdowns control the sheet summary only; importing reads all populated entry rows. **Open sheet** opens it; **Copy sheet** opens Google's copy flow. Paste the new copy's URL back into Spine before importing it. Standard cost labels are suggestions; custom labels are allowed.

The connector reads columns A:G from the selected tab, up to 5,000 entries, using typed numeric values and ISO dates. It refreshes the access token on each operation. Import is explicitly previewed and confirmed, not scheduled. If the sheet changes after preview, a new preview is required. Disconnecting removes credentials from Spine but does not delete the spreadsheet or revoke Google access to other applications.

## CSV and ledger rules

Download the empty CSV template in Connections or Revenue & Costs. Columns:

`external_id,date,type,label,amount,currency,opportunity_id`

- Use a permanent unique ID such as `cash-2026-0001`. Reuse it when correcting that entry.
- Types are `sale`, `refund`, `cost`. Amounts are positive; the type supplies the sign.
- Dates are `YYYY-MM-DD`; currencies are ISO codes such as GBP. Amounts have no symbols or grouping separators.
- `opportunity_id` is optional and should contain the GHL opportunity ID when known.
- Do not enter Stripe receipts again. CSV and Sheets share the same manual-ID namespace, so the same ID is one entry across both sources.
- Preview shows up to 20 rows; confirmation atomically imports the full batch. Limits: 2 MB CSV / 5,000 entries.
- Removing a sheet row does not delete an imported record. Roll back the corresponding batch in Revenue & Costs. This restores the previous version of corrected entries.

Amounts in currencies other than the reporting currency are excluded and counted explicitly. There is no implicit FX conversion. After-cost figures exclude unimported expenses and Stripe processing fees. The after-ad-spend figure subtracts matching-currency imported Meta/Google spend; it is unavailable when no spend is imported, and does not assert complete cost coverage.

## Verification

Automated tests cover currency precision, malformed CSV, IDs, refund mapping, local payment dates and signed OAuth state. Database checks run in rolled-back transactions and verify replacement, rollback and cross-tenant denial. OAuth consent, live payment import and Google template creation need configured external app credentials and an authorised account to verify end to end.
