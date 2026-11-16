# CLAUDE.md — Live Selling Coach (whatnot-empire-site)

Project instructions for Claude Code. Owner: Levi Salas (live-selling coach: TikTok Live + Whatnot).

## What this repo is

Two separate things in one repo:

| Part | Folder | What it is |
|---|---|---|
| Marketing site | `public/` | Static HTML landing pages for livesellingcoach.com. No build step. |
| Coaching app | `app/` | Node/Express student + coach portal (check-ins, roadmap, training, AI coach, knowledge brain, course builder, call analysis, DM leads). |

- GitHub: `ivanx5321/whatnot-empire-site` (public repo — never commit secrets)
- Domain: livesellingcoach.com (registered at Namecheap)
- Hosting: Render. Static site publishes `public/` (live at whatnot-empire-site.onrender.com). The `app/` runs as a separate Render Node web service with Render Postgres.

## Marketing site (`public/`)

- `index.html` — landing page; Apply → Calendly onboarding call
- `booked/index.html` — post-booking page with pre-call videos (disallowed in robots.txt)
- `free-course/index.html` — free course page
- Pure HTML/CSS, Google Fonts, YouTube embeds. Deploys on push to the default branch.

## Coaching app (`app/`)

- Runtime: Node >= 20, CommonJS, Express 4
- Entry: `app/src/server.js` (`npm start`). Health check: `GET /healthz`
- Files: `db.js` (pg pool + schema/migrations), `ai.js` (Anthropic API), `persona.js` (Levi's AI voice), `roadmap.js` (student roadmap), `views.js` (server-rendered HTML helpers), `routes/coach.js` (`/coach/*`), `routes/student.js` (`/*` for students)
- Auth: express-session stored in Postgres (connect-pg-simple), bcrypt passwords. Roles: `coach`, `student`. First coach is created at `/setup` with `SETUP_CODE`; students join via `/join/:token` invite links.
- Security in place (keep it): CSRF origin check, secure cookies in prod, X-Frame-Options/nosniff headers, HTML escaping via `esc()`.
- Database: PostgreSQL. Schema is created by `migrate()` in `db.js` with `CREATE TABLE IF NOT EXISTS`. Tables: users, students, payments, progress, checkins, calls, action_items, knowledge, chats, show_reviews, wins, lessons, lesson_progress, resources, announcements, course_drafts, raw_messages, jobs, dm_drafts, dm_leads.

### Environment variables (names only — values live in Render, never in git)

`DATABASE_URL`, `PGSSL`, `SESSION_SECRET` (required in prod), `NODE_ENV`, `PORT`, `SETUP_CODE`, `ADMIN_EMAIL`, `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-sonnet-5-5`), `COACH_DISCORD_NAME`.

Locally, put these in `app/.env` (gitignored — add `.env` to `app/.gitignore` before creating one) and point `DATABASE_URL` at a LOCAL Postgres (default `postgres://localhost/coachapp`).

## Integrations

- Calendly: `levisalas-eastcoastseller/whatnot-coaching-onboarding-call` and `/30-min-call`
- Anthropic API (AI coach, call analysis, knowledge extraction, course drafts)
- Discord (community Q&A ingested into the knowledge brain via `/coach/ingest`)
- ManyChat, Instagram (@youngceolevi), YouTube, ViewNot (viewnot.com — Levi has ownership; keep it featured)
- Payments are tracked in the app; students pay via Whop, PayPal invoices or Zelle

## Development rules

1. Never rebuild or restructure the site; make focused changes to existing files.
2. Never commit API keys, passwords, `.env` files or database URLs. Repo is public.
3. Never run anything against the production database (Render Postgres). Use a local DB for development. No destructive SQL (DROP/TRUNCATE/DELETE without WHERE) anywhere.
4. Schema changes must be additive and idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) inside `migrate()`.
5. Pushing to the default branch deploys to Render. Work on a branch; get Levi's approval before merging/pushing to the default branch or triggering a deploy.
6. Keep all existing integrations, links and Calendly URLs working.
7. Copy rules: coaching covers TikTok Live AND Whatnot (not Whatnot-only); high-ticket only, no low-ticket offer; don't promise a fixed timeline like "90 days"; no raids from his shows; 50+ sellers coached; $3M in TikTok Live sales in his first 5 months.
8. Don't add dependencies unless necessary; keep the server-rendered, no-build approach.
9. Before finishing a change: `node --check` every edited JS file, start the app locally and hit `/healthz`.

## Commands

```bash
cd app && npm install          # install deps
npm start                      # run on :3000 (needs a local Postgres)
curl localhost:3000/healthz    # should print ok
```

Note: `npm test` points to `test/smoke.js`, which doesn't exist yet.
