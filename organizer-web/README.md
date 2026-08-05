# Peakle Organizer Web

Responsive organizer operations portal for desktop, tablet, and mobile browsers. It uses the same Supabase project, user identities, organizer entitlements, venue memberships, RLS policies, RPC functions, and storage as the Expo player app.

## Included workspace

- Organizer overview and live operational metrics
- Open-play session publishing and session history
- Court monitor, scores, open courts, and fair-play queue
- Registration approval and player check-in
- Venue and court availability management
- Programs, competitions, and membership products
- Venue analytics with CSV export
- Staff roles and permission management
- Shared organizer identity, light/dark themes, and session security
- Responsive mobile navigation and installable web-app manifest

## Local development

The Next.js config can reuse the public Supabase values from the parent Expo `.env` file. A standalone deployment should use the names in `.env.example`.

```bash
cd organizer-web
npm install
npm run dev
```

Open `http://localhost:3000/overview`.

The portal always uses authenticated data from the shared Peakle Supabase project. There is no preview or seeded-data mode.

## Required Supabase authentication settings

Add these redirect URLs in Supabase Auth before deployment:

```text
http://localhost:3000/overview
https://organizer.your-domain.com/overview
```

Use the same email/password and Google providers as the player app. Authorization remains server-enforced through the existing row-level security policies and database functions; UI route visibility is not treated as a security boundary.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
node scripts/visual-qa.mjs
```

The visual QA script expects the development server on `localhost:3000` by default and writes desktop/mobile screenshots to `/private/tmp`. Set `PORTAL_BASE_URL` to test another local port.

## Deployment

Deploy `organizer-web` as its own Vercel project with the root directory set to this folder. Configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
```

Recommended domain: `organizer.peakle.app`.

Keep the current native organizer workspace available during beta. After real-account parity testing, replace the mobile workspace switch with a link to the deployed portal.
