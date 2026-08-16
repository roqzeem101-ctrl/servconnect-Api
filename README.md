# ServConnect API

Real backend for ServConnect: bcrypt-hashed auth with JWT access/refresh
tokens, a Haversine-based matching engine, a server-enforced request
state machine, and Stripe Connect escrow (authorize → capture → release).

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT secrets, Stripe keys
npm run migrate         # applies src/schema.sql
npm run dev
```

Requires a Postgres database (14+ recommended). For production-scale
geospatial queries, add the PostGIS extension and swap the bounding-box
prefilter in `routes/providers.js` for `ST_DWithin`.

## What's real here vs. what still needs your input

**Implemented:**
- bcrypt password hashing (12 rounds), JWT access + refresh tokens
- Per-request rate limiting on auth endpoints
- Ownership-scoped queries (`middleware/authorize.js`) — a user can only
  read/modify their own requests, enforced in SQL, not just in the UI
- Server-enforced request state machine (`routes/requests.js`) — status
  can only move along legal transitions, by the correct role
- Address masking — `customer_address` is stripped from API responses
  until a request reaches `accepted`
- Stripe Connect authorize/capture/release flow with webhook signature
  verification
- Security headers (helmet), locked CORS origin, centralized error
  handler that doesn't leak internals

**You still need to:**
- Set real values in `.env` — generate long random strings for the JWT
  secrets (e.g. `openssl rand -hex 32`), get real Stripe keys
- Set up Stripe Connect Express accounts for providers (their onboarding
  link comes from `stripe.accountLinks.create`, not included here — add
  a `POST /providers/onboard` route when you're ready to wire it up)
- Add the dispute-hold window before `releasePayment` fires (currently
  releases immediately on `completed` — see the comment in
  `payments/stripe.js`)
- Deploy Postgres + this API somewhere (Render, Railway, Fly.io, or
  RDS + ECS if you want more control) and point your frontend's
  `fetch` calls at the deployed URL instead of the mock data
- Add HTTPS/TLS termination in front of this (most hosts do this for you)
- Rotate the DB role to least-privilege (no DROP/ALTER) before going live
