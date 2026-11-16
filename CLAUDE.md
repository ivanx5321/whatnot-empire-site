# Live Selling Coach (repo: whatnot-empire-site)

## Purpose
Levi Salas's live-selling coaching business (TikTok Live + Whatnot): 1-on-1 coaching, $7,500 for five months.
This repo has two parts:
1. **`public/`**: the static marketing site (livesellingcoach.com). It covers the landing page and application flow, booking through Calendly, the post-booking page (`booked/`), and a lead magnet (`free-course/`).
2. **`app/`**: the private coaching platform ("livesellingcoach-app"). It has a coach admin, a student dashboard, check-ins, roadmap, calls, action items, wins, lessons/resources, show reviews, an AI coach + knowledge base, a course builder, and DM lead drafts.

Students and leads are real clients. Improve the existing platform. Do not rebuild it.

## Architecture
- `public/`: plain HTML/CSS with no build step. Hosted on Render as a static site (publish dir `public`).
- `app/`: Node ≥20, Express 4, server-rendered HTML (`src/views.js`), Postgres via `pg`, sessions in Postgres (`connect-pg-simple`), bcrypt passwords.
  - `src/server.js`: app setup, security headers, same-origin CSRF check, auth.
  - `src/db.js`: pool + idempotent `migrate()` (all `CREATE TABLE IF NOT EXISTS`).
  - `src/routes/coach.js`: coach/admin side (students, payments, calls, knowledge, course drafts, DM leads).
  - `src/routes/student.js`: student dashboard.
  - `src/ai.js` + `src/persona.js`: AI coach (Anthropic API, model from `AI_MODEL`).
  - `src/roadmap.js`: program roadmap content.

## Data (Postgres tables)
users, students, payments, progress, checkins, calls, action_items, knowledge, chats, show_reviews, wins,
lessons, lesson_progress, resources, announcements, course_drafts, raw_messages, jobs, dm_drafts, dm_leads.

## Development commands
```bash
cd app
npm install
createdb coachapp                      # local Postgres; default DATABASE_URL=postgres://localhost/coachapp
npm start                              # http://localhost:3000 (or $PORT)
npm test                               # NOTE: test/smoke.js does not exist yet — see Known limitations
```
Static site: open `public/index.html` directly or run `npx serve public`.

## Environment variables (names only — values live in Render)
`DATABASE_URL`, `SESSION_SECRET` (required in production), `ANTHROPIC_API_KEY`, `AI_MODEL`, `ADMIN_EMAIL`, `SETUP_CODE`,
`COACH_DISCORD_NAME`, `NODE_ENV`, `PGSSL`, `PORT`.

## Security rules (non-negotiable)
- **This repository is PUBLIC on GitHub.** Never commit secrets, `.env` files, database dumps, student names/emails, payment records, DMs, or call notes. Anything committed is visible to the world.
- Keep coaching data completely separate from the TikTok/AfterLive project. No shared databases, credentials, or exports.
- Every coach route must require the coach role. Every student route may only read or write that student's own rows.
- Escape all user content in HTML (`esc()` in views).
- Without Levi's approval, never charge, refund, or message a student or lead.

## Coding conventions
- Match the existing style: CommonJS, small route handlers, server-rendered template strings, parameterized SQL (`$1`, never string-built SQL).
- Schema changes are additive and idempotent inside `migrate()`.
- Pricing and offer copy (the $7,500 / 5-month program, the $600 30-minute call) must be consistent across `public/` and `src/ai.js`. Confirm with Levi before changing any price.

## Workflow
1. Read the relevant files first.
2. Branch: `feature/<name>` / `fix/<name>`. Never commit straight to `main`.
3. Make small, reversible changes. Add a test for new behavior once the test harness exists.
4. Run it locally against a local database, never production.
5. Open a PR with what changed and how it was tested.
6. Render deploys from `main`, so a merge is a production deploy and needs Levi's approval.

## Integrations
Calendly (onboarding call + paid 30-min call links), Anthropic API (AI coach), Render (static site + web service + Postgres).
Payments come in through Zelle, PayPal, Whop, card, or cash, and are **logged manually** in the coach admin today.

## Known limitations
- No automated tests (`npm test` points at a missing file) and no CI.
- Payments are entered by hand. There's no Whop/PayPal/Stripe sync.
- The CSRF check allows requests with no Origin/Referer (relies on SameSite=Lax).
- The AI coach prompt references "$5K" while the program is $7,500. Confirm the intended offer wording with Levi.

## Current priorities
Lead capture → application → booked call → enrolled student pipeline; payment tracking; onboarding; check-ins and session tracking; reporting.

## Cowork ↔ Code handoff
Business requests from Cowork arrive in `docs/requests/` (see `docs/requests/README.md`). Never put client personal data in those files, because this repo is public.
