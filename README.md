# Live Selling Coach (whatnot-empire-site)

Levi Salas's live-selling coaching (TikTok Live + Whatnot): marketing site plus the student/coach portal.
See `CLAUDE.md` for full technical context and development rules.

## Marketing site — `public/`

- `index.html` — landing page (Apply → Calendly onboarding call)
- `booked/index.html` — page shown after booking (pre-call videos)
- `free-course/index.html` — free course page

Hosted on Render as a static site. Publish directory: `public`. No build step.

## Coaching portal — `app/`

Node/Express + PostgreSQL app for students and the coach: check-ins, roadmap, training, AI coach,
knowledge brain, course builder, call analysis and DM leads. Runs on Render as a Node web service.

```bash
cd app
npm install
npm test        # smoke test, no database needed
npm start       # needs DATABASE_URL pointing at a LOCAL Postgres; serves :3000
```

Environment variables are listed in `CLAUDE.md` (names only). Real values live in Render — never commit them.
