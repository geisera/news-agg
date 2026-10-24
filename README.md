# Omar Report

Reusable, single-topic, independently deployed news aggregator. Built with Next.js, Supabase, RSS/Atom collection, and optional OpenAI classification.

## Local setup

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and supply Supabase project URL, anon key, service-role key, an unpredictable `CRON_SECRET`, and `OPENAI_API_KEY`.
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Create the first administrator via Supabase Authentication. Add their UID to `administrators` using SQL: `insert into administrators(user_id) values ('YOUR_AUTH_UID');`
5. Run `npm run dev`; sign in at `/admin`, set a topic, and discover/approve feeds.
6. Invoke `GET /api/cron` with `Authorization: Bearer YOUR_CRON_SECRET`. The included Vercel configuration runs hourly; adjust only if your hosting plan supports more frequent schedules.

## Behavior

- Latest News is newest-first. Top Stories uses weighted relevance (40%), significance (30%), recency (20%), and a reserved independent coverage component (10%). Clustering/multi-source coverage weighting is not yet implemented.
- RSS/Atom feed autodiscovery checks declared feeds and typical feed paths. Manual feed URLs are supported.
- New entries go to review. Successful AI evaluation publishes when relevance meets the threshold. If AI is unconfigured or fails, articles remain in review.
- Images are stored as metadata but only shown when `sources.image_license_ok` is true. It defaults to false; set it only after verifying rights. No automated licensing checks.
- AI only receives short syndicated descriptions; full article scraping is not implemented.
- Article moderation UI, clustering, publisher licensing workflow, and public source filtering are **not yet implemented**.

## Security notes

Never expose the service-role key to browsers. Admin endpoints check a verified Supabase access token and administrator allowlist; collection requires `CRON_SECRET`. Feed requests reject local/private addresses and restrict redirects. Harden with network egress controls (DNS rebinding protection), job locking, budgets, monitoring and security testing before production use.

This is an MVP starter, not a production-complete publishing platform.
## X post automation (OAuth 2.0)

The X publisher posts **new story clusters only** and is disabled until explicitly enabled in the admin dashboard. Existing story clusters are not backfilled. Each post uses an AI-generated snarky commentary based on the canonical article's headline, description, and saved summary, followed by a direct link to the original publisher. It does not scrape or ingest the publisher's full article body.

Setup:
1. In the X Developer Console, configure a **Web App / Automated App** with Read and Write permissions and OAuth 2.0 user authentication. Register the **exact** callback `https://omarreport.com/api/auth/x/callback` and website `https://omarreport.com`.
2. In the Vercel Production environment, configure `X_CLIENT_ID` and `X_CLIENT_SECRET` as sensitive values. The service also requires `X_TOKEN_ENCRYPTION_KEY`, a stable 32-byte random key encoded as 64 hexadecimal characters. Never change this encryption key after connecting, or stored tokens will become unreadable.
3. Redeploy so the server receives these settings. Open **Admin → X automation → Connect X Account**, authorize the publishing user, then return to the dashboard.
4. Enable publishing and set a limit. After each news collection run, one pending post is sent. Posting status appears in the admin history.

Implementation details: OAuth 2.0 authorization-code flow with PKCE S256 and a one-time database-backed state, `tweet.write tweet.read users.read offline.access` scopes, encrypted server-side storage of both access and refresh tokens, automatic refresh on expiry, and Disconnect to delete local tokens and disable publishing. Client secrets and raw tokens never reach browser-side code. Revocation of X's app permission can also be done from the X account's connected-app settings.

The legacy `X_USER_ACCESS_TOKEN` environment variable is not used. A 403-authentication-error post remains in `review`; it will not automatically retry. Inspect it before resetting to `pending`.
