# Spine

Shopify-first ecommerce analytics and GoHighLevel lead-generation reporting: profit and loss, product profitability, acquisition, customer behaviour, UTM analysis, custom costs, and scheduled report exports.

## Foundation

- Next.js App Router with TypeScript
- Supabase Postgres and cookie-based Auth
- Tailwind CSS and shadcn/ui primitives
- Node.js 22 or later

The application was scaffolded from the official Next.js `with-supabase` starter. The long-form product roadmap is maintained in [`TODO.md`](./TODO.md); near-term, model-assigned implementation tasks are tracked in [`TODO-AUDIT.md`](./TODO-AUDIT.md).

## Local setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Add the project URL and publishable key:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

4. Install and run the application:

   ```bash
   npm install
   npm run dev
   ```

The local app runs at `http://localhost:3000`.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run start
npm test
npm run typecheck
```

## Security baseline

- Never expose a Supabase secret/service-role key through a `NEXT_PUBLIC_` variable.
- Enable and test Row Level Security for every tenant-owned exposed table.
- Explicitly grant Data API access only to browser-facing tables and views.
- Keep Shopify and other connector tokens in server-only encrypted storage (Supabase Vault).
- Do not commit `.env.local` or the archived Apps Script prototype.

## Workspace notes

- `legacy-apps-script/` contains the preserved Google Sheets prototype and is intentionally ignored by Git because it includes legacy credentials.
- `TODO.md` contains the phased product roadmap; `TODO-AUDIT.md` contains the current prioritized engineering to-do list.
- The app serves two workspace modes per store (set by `stores.business_model`): `ecommerce` (Shopify-first analytics) and `lead_generation` (GoHighLevel pipeline reporting).
