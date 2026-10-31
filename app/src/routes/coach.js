const crypto = require('crypto');
const express = require('express');
const { one, all, q } = require('../db');
const ai = require('../ai');
const { PHASES, ALL_ITEMS } = require('../roadmap');
const { esc, money, date, iso, md, sparkline, bar, ago } = require('../views');

const num = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
const clip = (v, n = 4000) => String(v ?? '').trim().slice(0, n);
const newToken = () => crypto.randomBytes(18).toString('base64url');
const TOPICS = ['Getting Started', 'Shipping', 'Inventory', 'Running Shows', 'Getting Viewers', 'TikTok', 'Whatnot', 'Hiring & Team', 'Money & Profit', 'Mindset', 'Tools', 'Other'];

// One query that gives every student's key numbers + risk flags.
async function studentRows(where = "s.status <> 'archived'") {
  const rows = await all(`
    SELECT s.*,
      (SELECT max(created_at) FROM checkins c WHERE c.student_id=s.id) AS last_checkin,
      (SELECT coalesce(sum(sales),0) FROM checkins c WHERE c.student_id=s.id AND c.week_of > CURRENT_DATE - 28) AS sales_4w,
      (SELECT coalesce(sum(sales),0) FROM checkins c WHERE c.student_id=s.id) AS sales_all,
      (SELECT coalesce(sum(amount),0) FROM payments p WHERE p.student_id=s.id) AS paid,
      (SELECT count(*) FROM progress p WHERE p.student_id=s.id)::int AS done_items,
      (SELECT json_agg(x ORDER BY x.week_of DESC) FROM (SELECT week_of, sales, shows, mood FROM checkins c WHERE c.student_id=s.id ORDER BY week_of DESC LIMIT 3) x) AS recent
    FROM students s WHERE ${where} ORDER BY s.name`);
  return rows.map((s) => ({ ...s, risk: riskOf(s) }));
}

function riskOf(s) {
  if (s.status !== 'active') return [];
  const flags = [];
  const days = s.last_checkin ? (Date.now() - new Date(s.last_checkin).getTime()) / 86400000 : null;
  const started = (Date.now() - new Date(s.start_date).getTime()) / 86400000;
  if (days === null && started > 7) flags.push('No check-in yet');
  else if (days !== null && days > 10) flags.push(`No check-in in ${Math.floor(days)} days`);
  if (!s.user_id && started > 3) flags.push('Never logged in');
  const r = s.recent || [];
  if (r[0] && Number(r[0].shows) === 0) flags.push('0 shows last week');
  if (r.length >= 3 && Number(r[0].sales) < Number(r[1].sales) && Number(r[1].sales) < Number(r[2].sales)) flags.push('Sales dropping 3 weeks');
  if (r[0] && r[0].mood && Number(r[0].mood) <= 2) flags.push('Low mood');
  const expected = Math.min(ALL_ITEMS.length, Math.floor((started / 90) * ALL_ITEMS.length));
  if (started > 21 && s.done_items < expected * 0.5) flags.push('Behind on roadmap');
  if (s.end_date) {
    const left = (new Date(s.end_date).getTime() - Date.now()) / 86400000;
    if (left >= 0 && left <= 14) flags.push(`Program ends in ${Math.ceil(left)} days`);
  }
  return flags;
}

const riskTags = (flags) => flags.map((f) => `<span class="tag ${/ends in/.test(f) ? '' : 'risk'}">${esc(f)}</span>`).join(' ');

function inviteUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/join/${token}`;
}

const aiNote = () => (ai.enabled() ? '' : '<div class="flash warn">AI is off. Add your ANTHROPIC_API_KEY in Render → Environment to switch on Levi AI, call analysis and the Course Builder.</div>');

module.exports = (wrap) => {
  const r = express.Router();

  // ---------- Dashboard ----------
  r.get('/', wrap(async (req, res) => {
    const students = await studentRows();
    const active = students.filter((s) => s.status === 'active');
    const atRisk = active.filter((s) => s.risk.some((f) => !/ends in/.test(f)));
    const renewals = active.filter((s) => s.risk.some((f) => /ends in/.test(f)));
    const unanswered = (await one("SELECT count(*)::int n FROM knowledge WHERE (answer IS NULL OR answer='')")).n;
    const toReview = (await one("SELECT count(*)::int n FROM knowledge WHERE answer IS NOT NULL AND NOT approved AND source='chat'")).n;
    const weekCheckins = await all("SELECT c.*, s.name FROM checkins c JOIN students s ON s.id=c.student_id WHERE c.created_at > now() - interval '7 days' ORDER BY c.created_at DESC");
    const sales4w = active.reduce((a, s) => a + Number(s.sales_4w), 0);
    const collected = students.reduce((a, s) => a + Number(s.paid), 0);
    const trend = await all("SELECT date_trunc('week', week_of)::date wk, sum(sales) total FROM checkins WHERE week_of > CURRENT_DATE - 84 GROUP BY 1 ORDER BY 1");
    const wins = await all('SELECT w.*, s.name FROM wins w JOIN students s ON s.id=w.student_id ORDER BY w.created_at DESC LIMIT 5');

    res.page('Dashboard', `
<h1>Coach dashboard</h1>
${aiNote()}
<div class="grid4">
  <div class="card stat"><span class="muted small">Active students</span><strong>${active.length}</strong></div>
  <div class="card stat"><span class="muted small">Need attention</span><strong class="${atRisk.length ? 'red' : ''}">${atRisk.length}</strong></div>
  <div class="card stat"><span class="muted small">Student sales (4 wks)</span><strong>${money(sales4w)}</strong></div>
  <div class="card stat"><span class="muted small">Collected</span><strong>${money(collected)}</strong></div>
</div>
<div class="grid2">
  <section class="card"><h2>Need attention</h2>
  ${atRisk.length ? `<ul class="list">${atRisk.map((s) => `<li><a href="/coach/students/${s.id}"><strong>${esc(s.name)}</strong></a> ${riskTags(s.risk.filter((f) => !/ends in/.test(f)))}</li>`).join('')}</ul>` : '<p class="muted">Everyone is on track. 🙌</p>'}
  </section>
  <section class="card"><h2>Inbox</h2>
    <ul class="list">
      <li><a href="/coach/questions"><strong>${unanswered}</strong> student questions waiting for your answer</a></li>
      <li><a href="/coach/questions?tab=review"><strong>${toReview}</strong> AI answers to check</a></li>
      <li><strong>${weekCheckins.length}</strong> check-ins this week</li>
    </ul>
    ${renewals.length ? `<h3>Renewals coming up</h3><ul class="list">${renewals.map((s) => `<li><a href="/coach/students/${s.id}">${esc(s.name)}</a> · ends ${date(s.end_date)}</li>`).join('')}</ul>` : ''}
  </section>
</div>
<section class="card"><h2>All students' weekly sales (12 wks)</h2>${sparkline(trend.map((t) => t.total), { w: 600, h: 70 })}</section>
<div class="grid2">
<section class="card"><h2>Latest check-ins</h2>
${weekCheckins.slice(0, 8).map((c) => `<div class="row-item"><a href="/coach/students/${c.student_id}#checkins"><strong>${esc(c.name)}</strong></a> · ${c.shows} shows · ${money(c.sales)}${c.mood ? ` · mood ${c.mood}/5` : ''}${c.biggest_problem ? `<div class="muted small">Stuck: ${esc(c.biggest_problem.slice(0, 140))}</div>` : ''}</div>`).join('') || '<p class="muted">None this week.</p>'}
</section>
<section class="card"><h2>Recent wins</h2>
${wins.map((w) => `<div class="row-item"><strong>${esc(w.name)}</strong>: ${esc(w.title)} ${w.amount ? `<span class="tag hot">${money(w.amount)}</span>` : ''}</div>`).join('') || '<p class="muted">No wins posted yet.</p>'}
</section></div>`);
  }));

  // ---------- Students ----------
  r.get('/students', wrap(async (req, res) => {
    const show = req.query.show === 'all' ? '1=1' : "s.status <> 'archived'";
    const students = await studentRows(show);
    res.page('Students', `
<div class="row"><h1>Students</h1><a class="right small" href="?show=${req.query.show === 'all' ? '' : 'all'}">${req.query.show === 'all' ? 'Hide archived' : 'Show archived'}</a></div>
<div class="tablewrap card"><table>
<thead><tr><th>Student</th><th>Status</th><th>Day</th><th>Roadmap</th><th>Last check-in</th><th>Sales 4 wks</th><th>Paid</th><th>Flags</th></tr></thead>
<tbody>${students.map((s) => {
      const day = Math.max(0, Math.floor((Date.now() - new Date(s.start_date).getTime()) / 86400000));
      return `<tr><td><a href="/coach/students/${s.id}"><strong>${esc(s.name)}</strong></a><div class="muted small">${esc([s.ig_handle, s.tiktok_handle].filter(Boolean).join(' · '))}</div></td>
<td><span class="tag">${esc(s.status)}</span></td><td>${day}</td><td style="min-width:90px">${bar((s.done_items / ALL_ITEMS.length) * 100)}</td>
<td>${ago(s.last_checkin)}</td><td>${money(s.sales_4w)}</td><td>${money(s.paid)}${Number(s.price) ? ` / ${money(s.price)}` : ''}</td><td>${riskTags(s.risk)}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No students yet. Add your first one below.</td></tr>'}</tbody></table></div>

<form method="post" action="/coach/students" class="card stack">
  <h2>Add a student</h2>
  <div class="grid3">
    <label>Name<input name="name" required></label>
    <label>Email<input name="email" type="email"></label>
    <label>Phone<input name="phone" inputmode="tel"></label>
    <label>Instagram<input name="ig_handle" placeholder="@"></label>
    <label>TikTok<input name="tiktok_handle" placeholder="@"></label>
    <label>Whatnot<input name="whatnot_handle" placeholder="@"></label>
    <label>Program<input name="program" value="90-Day 1-on-1"></label>
    <label>Price for this student ($)<input type="number" name="price" min="0" step="0.01" value="5000"></label>
    <label>Paid so far ($)<input type="number" name="paid" min="0" step="0.01"></label>
    <label>Start date<input type="date" name="start_date" value="${iso(new Date())}"></label>
    <label>Length<select name="days"><option value="90">3 months</option><option value="120">4 months</option><option value="150">5 months</option><option value="180">6 months</option><option value="365">12 months</option></select></label>
    <label>Platforms<select name="platforms"><option>Whatnot + TikTok</option><option>Whatnot</option><option>TikTok</option></select></label>
  </div>
  <label>Their goal<input name="goal" placeholder="$10K/month on Whatnot by March"></label>
  <label>Starting point<input name="starting_point" placeholder="New, $0 so far / doing $2K a month on eBay…"></label>
  <button class="btn">Add student + create login link</button>
</form>`);
  }));

  r.post('/students', wrap(async (req, res) => {
    const b = req.body;
    const days = num(b.days) || 90;
    const start = b.start_date || iso(new Date());
    const end = new Date(new Date(start).getTime() + days * 86400000);
    const s = await one(`INSERT INTO students (name,email,phone,ig_handle,tiktok_handle,whatnot_handle,program,price,start_date,end_date,platforms,goal,starting_point,invite_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [clip(b.name, 120), clip(b.email, 200).toLowerCase() || null, clip(b.phone, 40), clip(b.ig_handle, 80), clip(b.tiktok_handle, 80), clip(b.whatnot_handle, 80), clip(b.program, 80), num(b.price) || 0, start, end, clip(b.platforms, 40), clip(b.goal, 300), clip(b.starting_point, 300), newToken()]);
    if (num(b.paid)) await q('INSERT INTO payments (student_id,amount,method,note) VALUES ($1,$2,$3,$4)', [s.id, num(b.paid), 'initial', 'Entered when added']);
    req.flash('Student added. Copy their login link below and text it to them.');
    res.redirect(`/coach/students/${s.id}`);
  }));

  r.get('/students/:id', wrap(async (req, res) => {
    const s = await one('SELECT * FROM students WHERE id=$1', [req.params.id]);
    if (!s) return res.redirect('/coach/students');
    const [row] = await studentRows(`s.id=${Number(s.id)}`);
    const checkins = await all('SELECT * FROM checkins WHERE student_id=$1 ORDER BY week_of DESC, id DESC', [s.id]);
    const progress = new Set((await all('SELECT item_key FROM progress WHERE student_id=$1', [s.id])).map((x) => x.item_key));
    const payments = await all('SELECT * FROM payments WHERE student_id=$1 ORDER BY paid_on DESC', [s.id]);
    const actions = await all('SELECT * FROM action_items WHERE student_id=$1 ORDER BY done_at NULLS FIRST, created_at DESC LIMIT 30', [s.id]);
    const calls = await all('SELECT id, call_date, kind, title, summary FROM calls WHERE student_id=$1 ORDER BY call_date DESC', [s.id]);
    const shows = await all('SELECT * FROM show_reviews WHERE student_id=$1 ORDER BY show_date DESC LIMIT 10', [s.id]);
    const chats = await all('SELECT * FROM chats WHERE student_id=$1 ORDER BY created_at DESC LIMIT 20', [s.id]);
    const wins = await all('SELECT * FROM wins WHERE student_id=$1 ORDER BY created_at DESC', [s.id]);
    const login = s.user_id ? await one('SELECT email FROM users WHERE id=$1', [s.user_id]) : null;
    const series = [...checkins].reverse().slice(-12).map((c) => c.sales);
    const paid = payments.reduce((a, p) => a + Number(p.amount), 0);

    res.page(s.name, `
<p class="small"><a href="/coach/students">← Students</a></p>
<div class="row"><h1>${esc(s.name)}</h1><span class="tag">${esc(s.status)}</span></div>
<p class="muted">${esc([s.ig_handle && `IG ${s.ig_handle}`, s.tiktok_handle && `TikTok ${s.tiktok_handle}`, s.whatnot_handle && `Whatnot ${s.whatnot_handle}`, s.phone].filter(Boolean).join(' · '))}</p>
${row.risk.length ? `<p>${riskTags(row.risk)}</p>` : ''}
<div class="grid4">
  <div class="card stat"><span class="muted small">Roadmap</span><strong>${progress.size}/${ALL_ITEMS.length}</strong>${bar((progress.size / ALL_ITEMS.length) * 100)}</div>
  <div class="card stat"><span class="muted small">Sales logged</span><strong>${money(row.sales_all)}</strong></div>
  <div class="card stat"><span class="muted small">Paid</span><strong>${money(paid)}</strong><span class="muted small">of ${money(s.price)}</span></div>
  <div class="card stat"><span class="muted small">Program</span><strong>${date(s.start_date)}</strong><span class="muted small">to ${date(s.end_date)}</span></div>
</div>

<section class="card"><h2>Login</h2>
${login ? `<p>Logged in as <strong>${esc(login.email)}</strong>.</p>` : '<p>Hasn\'t set up their login yet.</p>'}
${s.invite_token ? `<p class="small">Text them this link:</p><div class="copyrow"><input readonly value="${esc(inviteUrl(req, s.invite_token))}" id="inv"><button class="btn small" data-copy="inv" type="button">Copy</button></div>` : ''}
<form method="post" action="/coach/students/${s.id}/invite" class="inline"><button class="btn small ghost">${s.user_id ? 'Make a password-reset link' : 'Make a new link'}</button></form>
</section>

<section class="card"><h2>Weekly sales</h2>${sparkline(series, { w: 600, h: 70 })}</section>

<section class="card" id="checkins"><h2>Check-ins</h2>
${checkins.map((c) => `<details class="sub"${c === checkins[0] ? ' open' : ''}><summary><strong>${date(c.week_of)}</strong> · ${c.shows} shows · ${c.hours_live}h · ${money(c.sales)} sales${c.profit != null ? ` · ${money(c.profit)} profit` : ''}${c.avg_viewers != null ? ` · ${c.avg_viewers} viewers` : ''}${c.mood ? ` · mood ${c.mood}/5` : ''}</summary>
${c.biggest_win ? `<p><strong>Win:</strong> ${esc(c.biggest_win)}</p>` : ''}${c.biggest_problem ? `<p><strong>Problem:</strong> ${esc(c.biggest_problem)}</p>` : ''}${c.question ? `<p><strong>Question:</strong> ${esc(c.question)}</p>` : ''}
${c.ai_feedback ? `<details class="reply ai"><summary>AI feedback they got</summary>${md(c.ai_feedback)}</details>` : ''}
<form method="post" action="/coach/checkins/${c.id}/reply" class="stack"><label>Your reply${c.question ? ' (also saved to the Knowledge Brain)' : ''}<textarea name="reply" rows="3">${esc(c.coach_reply || '')}</textarea></label><button class="btn small">Save reply</button></form>
</details>`).join('') || '<p class="muted">No check-ins yet.</p>'}
</section>

<div class="grid2">
<section class="card"><h2>Action items</h2>
<ul class="list">${actions.map((a) => `<li class="${a.done_at ? 'done' : ''}"><form method="post" action="/coach/actions/${a.id}/toggle" class="inline"><button class="tick" aria-label="Toggle done">${a.done_at ? '✓' : ''}</button></form> ${esc(a.text)} <span class="tag">${esc(a.owner)}</span></li>`).join('') || '<li class="muted">None.</li>'}</ul>
<form method="post" action="/coach/students/${s.id}/actions" class="askrow"><input name="text" placeholder="New action item" required><select name="owner"><option>student</option><option>coach</option></select><button class="btn small">Add</button></form>
</section>
<section class="card"><h2>Roadmap</h2>
${PHASES.map((p) => `<h3>${esc(p.title)}</h3><ul class="checks">${p.items.map(([k, t]) => `<li class="${progress.has(k) ? 'done' : ''}">${progress.has(k) ? '✅' : '⬜'} ${esc(t)}</li>`).join('')}</ul>`).join('')}
</section></div>

<section class="card"><h2>Calls</h2>
${calls.map((c) => `<div class="row-item"><a href="/coach/calls/${c.id}"><strong>${date(c.call_date)}</strong> · ${esc(c.title || c.kind)}</a>${c.summary ? `<div class="muted small">${esc(c.summary.slice(0, 220))}</div>` : ''}</div>`).join('') || '<p class="muted">No calls logged.</p>'}
<a class="btn small" href="/coach/calls?student=${s.id}">Log a call</a>
</section>

<section class="card"><h2>Show reviews</h2>
${shows.map((sh) => `<details class="sub"><summary>${date(sh.show_date)} · ${esc(sh.platform)} · ${money(sh.sales)} · ${sh.items_sold ?? '?'} items · ${sh.peak_viewers ?? '?'} viewers</summary>
${sh.what_happened ? `<p>${esc(sh.what_happened)}</p>` : ''}${sh.ai_review ? `<details class="reply ai"><summary>AI review</summary>${md(sh.ai_review)}</details>` : ''}
<form method="post" action="/coach/shows/${sh.id}/comment" class="stack"><textarea name="comment" rows="2" placeholder="Your notes for them">${esc(sh.coach_comment || '')}</textarea><button class="btn small">Save</button></form></details>`).join('') || '<p class="muted">None yet.</p>'}
</section>

<section class="card"><h2>Recent questions to Levi AI</h2>
${chats.filter((m) => m.role === 'user').slice(0, 8).map((m) => `<div class="row-item">${esc(m.content)} <span class="muted small">${ago(m.created_at)}</span></div>`).join('') || '<p class="muted">None yet.</p>'}
</section>

<div class="grid2">
<section class="card"><h2>Payments</h2>
<ul class="list">${payments.map((p) => `<li>${money(p.amount)} · ${esc(p.method || '')} · ${date(p.paid_on)} ${p.note ? `<span class="muted small">${esc(p.note)}</span>` : ''}</li>`).join('') || '<li class="muted">None logged.</li>'}</ul>
<form method="post" action="/coach/students/${s.id}/payments" class="askrow"><input type="number" name="amount" step="0.01" placeholder="Amount" required><select name="method"><option>Zelle</option><option>PayPal</option><option>Whop</option><option>Card</option><option>Cash</option><option>Other</option></select><input type="date" name="paid_on" value="${iso(new Date())}"><button class="btn small">Add</button></form>
</section>
<section class="card"><h2>Wins</h2>${wins.map((w) => `<div class="row-item"><strong>${esc(w.title)}</strong> ${w.amount ? money(w.amount) : ''}<div class="muted small">${esc(w.story || '')}</div></div>`).join('') || '<p class="muted">None yet.</p>'}</section>
</div>

<form method="post" action="/coach/students/${s.id}" class="card stack">
  <h2>Edit profile</h2>
  <div class="grid3">
    <label>Name<input name="name" value="${esc(s.name)}" required></label>
    <label>Email<input name="email" type="email" value="${esc(s.email || '')}"></label>
    <label>Phone<input name="phone" value="${esc(s.phone || '')}"></label>
    <label>Instagram<input name="ig_handle" value="${esc(s.ig_handle || '')}"></label>
    <label>TikTok<input name="tiktok_handle" value="${esc(s.tiktok_handle || '')}"></label>
    <label>Whatnot<input name="whatnot_handle" value="${esc(s.whatnot_handle || '')}"></label>
    <label>Program<input name="program" value="${esc(s.program || '')}"></label>
    <label>Price ($)<input type="number" name="price" step="0.01" value="${esc(s.price)}"></label>
    <label>Status<select name="status">${['active', 'paused', 'completed', 'renewed', 'refunded', 'archived'].map((x) => `<option${x === s.status ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Start<input type="date" name="start_date" value="${iso(s.start_date)}"></label>
    <label>End<input type="date" name="end_date" value="${iso(s.end_date)}"></label>
    <label>Platforms<input name="platforms" value="${esc(s.platforms || '')}"></label>
  </div>
  <label>Goal<input name="goal" value="${esc(s.goal || '')}"></label>
  <label>Starting point<input name="starting_point" value="${esc(s.starting_point || '')}"></label>
  <label>Private notes (only you see these)<textarea name="coach_notes" rows="3">${esc(s.coach_notes || '')}</textarea></label>
  <button class="btn">Save</button>
</form>`);
  }));

  r.post('/students/:id', wrap(async (req, res) => {
    const b = req.body;
    await q(`UPDATE students SET name=$1,email=$2,phone=$3,ig_handle=$4,tiktok_handle=$5,whatnot_handle=$6,program=$7,price=$8,status=$9,start_date=$10,end_date=$11,platforms=$12,goal=$13,starting_point=$14,coach_notes=$15 WHERE id=$16`,
      [clip(b.name, 120), clip(b.email, 200).toLowerCase() || null, clip(b.phone, 40), clip(b.ig_handle, 80), clip(b.tiktok_handle, 80), clip(b.whatnot_handle, 80), clip(b.program, 80), num(b.price) || 0, clip(b.status, 20), b.start_date || null, b.end_date || null, clip(b.platforms, 40), clip(b.goal, 300), clip(b.starting_point, 300), clip(b.coach_notes, 10000), req.params.id]);
    req.flash('Saved.');
    res.redirect(`/coach/students/${req.params.id}`);
  }));

  r.post('/students/:id/invite', wrap(async (req, res) => {
    await q('UPDATE students SET invite_token=$1 WHERE id=$2', [newToken(), req.params.id]);
    req.flash('New login link created. Copy it and text it to them.');
    res.redirect(`/coach/students/${req.params.id}`);
  }));

  r.post('/students/:id/payments', wrap(async (req, res) => {
    if (num(req.body.amount)) await q('INSERT INTO payments (student_id,amount,method,paid_on) VALUES ($1,$2,$3,$4)', [req.params.id, num(req.body.amount), clip(req.body.method, 30), req.body.paid_on || new Date()]);
    res.redirect(`/coach/students/${req.params.id}`);
  }));

  r.post('/students/:id/actions', wrap(async (req, res) => {
    await q('INSERT INTO action_items (student_id,owner,text) VALUES ($1,$2,$3)', [req.params.id, req.body.owner === 'coach' ? 'coach' : 'student', clip(req.body.text, 500)]);
    res.redirect(`/coach/students/${req.params.id}`);
  }));

  r.post('/actions/:id/toggle', wrap(async (req, res) => {
    const a = await one('UPDATE action_items SET done_at = CASE WHEN done_at IS NULL THEN now() ELSE NULL END WHERE id=$1 RETURNING student_id', [req.params.id]);
    res.redirect(a ? `/coach/students/${a.student_id}` : '/coach');
  }));

  r.post('/checkins/:id/reply', wrap(async (req, res) => {
    const reply = clip(req.body.reply, 8000);
    const c = await one('UPDATE checkins SET coach_reply=$1 WHERE id=$2 RETURNING *', [reply, req.params.id]);
    if (c && c.question && reply) {
      const k = await one("SELECT id FROM knowledge WHERE source='checkin' AND source_id=$1", [c.id]);
      if (k) await q('UPDATE knowledge SET answer=$1, approved=true WHERE id=$2', [reply, k.id]);
      else await q("INSERT INTO knowledge (source,source_id,student_id,question,answer,approved) VALUES ('checkin',$1,$2,$3,$4,true)", [c.id, c.student_id, c.question, reply]);
    }
    req.flash('Reply saved — they\'ll see it in their check-ins.');
    res.redirect(`/coach/students/${c ? c.student_id : ''}#checkins`);
  }));

  r.post('/shows/:id/comment', wrap(async (req, res) => {
    const s = await one('UPDATE show_reviews SET coach_comment=$1 WHERE id=$2 RETURNING student_id', [clip(req.body.comment, 8000), req.params.id]);
    res.redirect(`/coach/students/${s ? s.student_id : ''}`);
  }));

  // ---------- Calls ----------
  r.get('/calls', wrap(async (req, res) => {
    const students = await all("SELECT id, name FROM students WHERE status <> 'archived' ORDER BY name");
    const calls = await all('SELECT c.*, s.name FROM calls c LEFT JOIN students s ON s.id=c.student_id ORDER BY call_date DESC, id DESC LIMIT 100');
    const pre = Number(req.query.student) || null;
    res.page('Calls', `
<h1>Calls</h1>
${aiNote()}
<form method="post" action="/coach/calls" class="card stack">
  <h2>Log a call</h2>
  <p class="muted small">Paste your notes or the Zoom transcript. AI pulls out a summary, action items for the student, and every question + your answer into the Knowledge Brain (that's what builds your course).</p>
  <div class="grid3">
    <label>Student<select name="student_id"><option value="">— Group call / no student —</option>${students.map((s) => `<option value="${s.id}"${s.id === pre ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Type<select name="kind"><option value="coaching">1:1 coaching</option><option value="group">Group call</option><option value="sales">Sales call</option></select></label>
    <label>Date<input type="date" name="call_date" value="${iso(new Date())}"></label>
  </div>
  <label>Title<input name="title" placeholder="Week 3 call — shipping + first $1K show"></label>
  <label>Notes or transcript<textarea name="notes" rows="10" required></textarea></label>
  <label class="check"><input type="checkbox" name="analyze" value="1" ${ai.enabled() ? 'checked' : 'disabled'}> Analyze with AI</label>
  <button class="btn">Save call</button>
</form>
<section class="card"><h2>All calls</h2>
${calls.map((c) => `<div class="row-item"><a href="/coach/calls/${c.id}"><strong>${date(c.call_date)}</strong> · ${esc(c.title || c.kind)}</a> <span class="tag">${esc(c.kind)}</span> ${c.name ? `<span class="muted small">${esc(c.name)}</span>` : ''}</div>`).join('') || '<p class="muted">No calls logged yet.</p>'}
</section>`);
  }));

  r.post('/calls', wrap(async (req, res) => {
    const b = req.body;
    const sid = num(b.student_id);
    const notes = clip(b.notes, 200000);
    const call = await one('INSERT INTO calls (student_id,kind,call_date,title,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [sid, ['coaching', 'group', 'sales'].includes(b.kind) ? b.kind : 'coaching', b.call_date || new Date(), clip(b.title, 200), notes]);
    if (b.analyze === '1' && ai.enabled()) {
      try {
        const st = sid ? await one('SELECT name FROM students WHERE id=$1', [sid]) : null;
        const out = await ai.analyzeCall({ studentName: st?.name, kind: call.kind, notes });
        await q('UPDATE calls SET summary=$1, ai_json=$2 WHERE id=$3', [out.summary || '', out, call.id]);
        if (sid) {
          for (const a of (out.action_items || []).slice(0, 20)) {
            if (a && a.text) await q('INSERT INTO action_items (student_id,call_id,owner,text) VALUES ($1,$2,$3,$4)', [sid, call.id, a.owner === 'coach' ? 'coach' : 'student', clip(a.text, 500)]);
          }
        }
        for (const k of (out.qa || []).slice(0, 40)) {
          if (k && k.question && k.answer) await q("INSERT INTO knowledge (source,source_id,student_id,question,answer,topic,approved) VALUES ('call',$1,$2,$3,$4,$5,true)", [call.id, sid, clip(k.question, 1000), clip(k.answer, 6000), clip(k.topic, 40)]);
        }
        req.flash(`Call saved. Added ${(out.action_items || []).length} action items and ${(out.qa || []).length} Q&As to the Knowledge Brain.`);
      } catch (e) {
        console.error('call AI', e.message);
        req.flash('Call saved, but the AI analysis failed. You can re-run it from the call page.', 'warn');
      }
    } else req.flash('Call saved.');
    res.redirect(`/coach/calls/${call.id}`);
  }));

  r.get('/calls/:id', wrap(async (req, res) => {
    const c = await one('SELECT c.*, s.name FROM calls c LEFT JOIN students s ON s.id=c.student_id WHERE c.id=$1', [req.params.id]);
    if (!c) return res.redirect('/coach/calls');
    const qa = await all("SELECT * FROM knowledge WHERE source='call' AND source_id=$1", [c.id]);
    const j = c.ai_json || {};
    res.page('Call', `
<p class="small"><a href="/coach/calls">← Calls</a></p>
<h1>${esc(c.title || 'Call')} </h1>
<p class="muted">${date(c.call_date)} · ${esc(c.kind)}${c.name ? ` · <a href="/coach/students/${c.student_id}">${esc(c.name)}</a>` : ''}</p>
${c.summary ? `<section class="card"><h2>Summary</h2>${md(c.summary)}</section>` : ''}
${(j.concerns || []).length ? `<section class="card"><h2>Watch out</h2><ul>${j.concerns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
${(j.student_wins || []).length ? `<section class="card"><h2>Wins mentioned</h2><ul>${j.student_wins.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
${qa.length ? `<section class="card"><h2>Questions & answers saved to the Brain</h2>${qa.map((k) => `<div class="row-item"><strong>${esc(k.question)}</strong> <span class="tag">${esc(k.topic || '')}</span>${md(k.answer)}</div>`).join('')}</section>` : ''}
${!c.summary && ai.enabled() ? `<form method="post" action="/coach/calls/${c.id}/analyze"><button class="btn">Analyze this call with AI</button></form>` : ''}
<details class="card"><summary>Notes / transcript</summary><pre class="pre">${esc(c.notes)}</pre></details>
<form method="post" action="/coach/calls/${c.id}/delete" onsubmit="return confirm('Delete this call?')"><button class="link danger">Delete call</button></form>`);
  }));

  r.post('/calls/:id/analyze', wrap(async (req, res) => {
    const c = await one('SELECT c.*, s.name FROM calls c LEFT JOIN students s ON s.id=c.student_id WHERE c.id=$1', [req.params.id]);
    if (!c || !ai.enabled()) return res.redirect(`/coach/calls/${req.params.id}`);
    const out = await ai.analyzeCall({ studentName: c.name, kind: c.kind, notes: c.notes || '' });
    await q('UPDATE calls SET summary=$1, ai_json=$2 WHERE id=$3', [out.summary || '', out, c.id]);
    if (c.student_id) for (const a of (out.action_items || []).slice(0, 20)) if (a?.text) await q('INSERT INTO action_items (student_id,call_id,owner,text) VALUES ($1,$2,$3,$4)', [c.student_id, c.id, a.owner === 'coach' ? 'coach' : 'student', clip(a.text, 500)]);
    for (const k of (out.qa || []).slice(0, 40)) if (k?.question && k?.answer) await q("INSERT INTO knowledge (source,source_id,student_id,question,answer,topic,approved) VALUES ('call',$1,$2,$3,$4,$5,true)", [c.id, c.student_id, clip(k.question, 1000), clip(k.answer, 6000), clip(k.topic, 40)]);
    res.redirect(`/coach/calls/${c.id}`);
  }));

  r.post('/calls/:id/delete', wrap(async (req, res) => {
    await q('DELETE FROM calls WHERE id=$1', [req.params.id]);
    res.redirect('/coach/calls');
  }));

  // ---------- Questions inbox ----------
  r.get('/questions', wrap(async (req, res) => {
    const review = req.query.tab === 'review';
    const items = review
      ? await all("SELECT k.*, s.name FROM knowledge k LEFT JOIN students s ON s.id=k.student_id WHERE k.answer IS NOT NULL AND NOT k.approved AND k.source='chat' ORDER BY k.created_at DESC LIMIT 50")
      : await all("SELECT k.*, s.name FROM knowledge k LEFT JOIN students s ON s.id=k.student_id WHERE (k.answer IS NULL OR k.answer='') ORDER BY k.created_at DESC LIMIT 50");
    res.page('Questions', `
<h1>Questions</h1>
<nav class="subtabs"><a href="/coach/questions"${review ? '' : ' class="active"'}>Waiting for you</a><a href="/coach/questions?tab=review"${review ? ' class="active"' : ''}>Check AI answers</a></nav>
<p class="muted small">${review ? 'Answers Levi AI gave students. Approve the good ones (fix them if needed) — approved answers become the "verified" answer the AI uses next time.' : 'Questions students asked in check-ins or while AI was off. Your answer goes back to the student and into the Knowledge Brain.'}</p>
${items.map((k) => `<form method="post" action="/coach/brain/${k.id}" class="card stack">
  <div class="muted small">${esc(k.name || 'Student')} · ${esc(k.source)} · ${ago(k.created_at)}</div>
  <strong>${esc(k.question)}</strong>
  <label>Answer<textarea name="answer" rows="${review ? 6 : 3}">${esc(k.answer || '')}</textarea></label>
  <div class="askrow"><select name="topic"><option value="">Topic…</option>${TOPICS.map((t) => `<option${t === k.topic ? ' selected' : ''}>${t}</option>`).join('')}</select>
  <input type="hidden" name="approved" value="1"><input type="hidden" name="back" value="/coach/questions${review ? '?tab=review' : ''}">
  <button class="btn small">${review ? 'Approve' : 'Answer'}</button></div>
</form>`).join('') || '<p class="muted">All caught up. ✅</p>'}`);
  }));

  // ---------- Knowledge Brain ----------
  r.get('/brain', wrap(async (req, res) => {
    const term = clip(req.query.q, 200);
    const topic = clip(req.query.topic, 40);
    const params = [];
    let where = 'WHERE 1=1';
    if (term) { params.push(term); where += ` AND to_tsvector('english', coalesce(question,'')||' '||coalesce(answer,'')||' '||coalesce(topic,'')) @@ plainto_tsquery('english', $${params.length})`; }
    if (topic) { params.push(topic); where += ` AND topic = $${params.length}`; }
    const items = await all(`SELECT * FROM knowledge ${where} ORDER BY approved DESC, created_at DESC LIMIT 100`, params);
    const counts = await all("SELECT coalesce(nullif(topic,''),'Untagged') topic, count(*)::int n FROM knowledge GROUP BY 1 ORDER BY 2 DESC");
    const total = counts.reduce((a, c) => a + c.n, 0);
    const job = await one("SELECT * FROM jobs WHERE name='community'");
    res.page('Knowledge Brain', `
<h1>Knowledge Brain</h1>
${job && job.status !== 'done' ? `<div class="flash warn">Discord import: ${esc(job.status)} — ${esc(job.detail || '')} <span class="small">(${ago(job.updated_at)}; refresh to update)</span></div>` : job ? `<div class="flash">Discord import finished: ${esc(job.detail || '')}</div>` : ''}
<p class="muted">Everything students ask and everything you teach, in one place. ${total} items. Levi AI uses verified answers first.</p>
<div class="chips"><a href="/coach/brain" class="chip${topic ? '' : ' on'}">All</a>${counts.map((c) => `<a class="chip${c.topic === topic ? ' on' : ''}" href="/coach/brain?topic=${encodeURIComponent(c.topic)}">${esc(c.topic)} · ${c.n}</a>`).join('')}</div>
<form class="askrow" method="get"><input name="q" value="${esc(term)}" placeholder="Search: shipping profile, pallets, TikTok approval…"><button class="btn small">Search</button></form>
<details class="card"${ai.enabled() ? '' : ' hidden'}><summary><strong>+ Paste an Instagram Q&A, notes or a transcript</strong> (AI turns it into Q&As)</summary>
<form method="post" action="/coach/brain/extract" class="stack"><p class="muted small">Paste your answers from an IG story Q&A, a voice-note transcript, a podcast — anything where you teach. AI pulls out every question + your answer.</p>
<div class="askrow"><select name="source"><option value="instagram">Instagram Q&A</option><option value="video">Video / podcast</option><option value="manual">Notes</option></select><input name="ref" type="url" placeholder="Link (optional)"></div>
<textarea name="text" rows="8" required placeholder="Q: How much inventory should I start with?&#10;A: Start with one pallet..."></textarea><button class="btn small">Extract Q&As</button></form></details>
<details class="card"><summary><strong>+ Add your own Q&A</strong> (things you say a lot)</summary>
<form method="post" action="/coach/brain" class="stack"><label>Question<input name="question" required></label><label>Your answer<textarea name="answer" rows="4" required></textarea></label>
<select name="topic">${TOPICS.map((t) => `<option>${t}</option>`).join('')}</select><button class="btn small">Add</button></form></details>
${items.map((k) => `<details class="card"><summary>${k.approved ? '✅' : '🤖'} <strong>${esc(k.question)}</strong> <span class="tag">${esc(k.topic || 'Untagged')}</span> <span class="muted small">${esc(k.source)} · ${date(k.created_at)}</span>${k.ref ? ` <a class="small" href="${esc(k.ref)}" target="_blank" rel="noopener">source ↗</a>` : ''}</summary>
<form method="post" action="/coach/brain/${k.id}" class="stack"><textarea name="answer" rows="5">${esc(k.answer || '')}</textarea>
<div class="askrow"><select name="topic"><option value="">Topic…</option>${TOPICS.map((t) => `<option${t === k.topic ? ' selected' : ''}>${t}</option>`).join('')}</select>
<label class="check"><input type="checkbox" name="approved" value="1" ${k.approved ? 'checked' : ''}> Verified</label><input type="hidden" name="back" value="/coach/brain${term || topic ? `?q=${encodeURIComponent(term)}&topic=${encodeURIComponent(topic)}` : ''}"><button class="btn small">Save</button></div></form>
<form method="post" action="/coach/brain/${k.id}/delete"><button class="link danger small">Delete</button></form></details>`).join('') || '<p class="muted">Nothing yet. Log calls and answer questions to fill it up.</p>'}`);
  }));

  r.post('/brain/extract', wrap(async (req, res) => {
    if (!ai.enabled()) return res.redirect('/coach/brain');
    const source = ['instagram', 'video', 'manual'].includes(req.body.source) ? req.body.source : 'manual';
    const ref = /^https?:\/\//.test(req.body.ref || '') ? clip(req.body.ref, 300) : null;
    try {
      const out = await ai.analyzeCall({ studentName: null, kind: source === 'instagram' ? 'Instagram story Q&A' : 'content', notes: clip(req.body.text, 120000) });
      let n = 0;
      for (const k of (out.qa || []).slice(0, 60)) {
        if (k?.question && k?.answer) { await q('INSERT INTO knowledge (source,question,answer,topic,approved,ref) VALUES ($1,$2,$3,$4,true,$5)', [source, clip(k.question, 1000), clip(k.answer, 6000), clip(k.topic, 40), ref]); n++; }
      }
      req.flash(`Added ${n} Q&As to the Brain.`);
    } catch (e) {
      console.error('extract AI', e.message);
      req.flash('Couldn\'t extract right now — try again in a minute.', 'err');
    }
    res.redirect('/coach/brain');
  }));

  r.post('/brain', wrap(async (req, res) => {
    await q("INSERT INTO knowledge (source,question,answer,topic,approved) VALUES ('manual',$1,$2,$3,true)", [clip(req.body.question, 1000), clip(req.body.answer, 8000), clip(req.body.topic, 40)]);
    req.flash('Added to the Brain.');
    res.redirect('/coach/brain');
  }));

  r.post('/brain/:id', wrap(async (req, res) => {
    const answer = clip(req.body.answer, 8000);
    const k = await one('UPDATE knowledge SET answer=$1, topic=coalesce(nullif($2,\'\'),topic), approved=$3 WHERE id=$4 RETURNING *', [answer || null, clip(req.body.topic, 40), req.body.approved === '1' && Boolean(answer), req.params.id]);
    if (k && k.source === 'checkin' && k.source_id && answer) await q('UPDATE checkins SET coach_reply=$1 WHERE id=$2', [answer, k.source_id]);
    if (k && k.source === 'chat' && k.student_id && answer && req.body.approved === '1' && !k.answer_sent) {
      // Let the student see Levi's personal answer in their chat if AI was off when they asked.
      const last = await one("SELECT content FROM chats WHERE student_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1", [k.student_id]);
      if (last && /sent (this|your question) to Levi/.test(last.content)) await q("INSERT INTO chats (student_id,role,content) VALUES ($1,'assistant',$2)", [k.student_id, `Levi answered your question "${k.question.slice(0, 120)}":\n\n${answer}`]);
    }
    const back = String(req.body.back || '/coach/brain');
    res.redirect(back.startsWith('/coach/') ? back : '/coach/brain');
  }));

  r.post('/brain/:id/delete', wrap(async (req, res) => {
    await q('DELETE FROM knowledge WHERE id=$1', [req.params.id]);
    res.redirect('/coach/brain');
  }));

  // ---------- Course Builder ----------
  r.get('/course', wrap(async (req, res) => {
    const counts = await all("SELECT coalesce(nullif(topic,''),'Untagged') topic, count(*)::int n, count(*) FILTER (WHERE approved)::int verified FROM knowledge GROUP BY 1 ORDER BY 2 DESC");
    const total = counts.reduce((a, c) => a + c.n, 0);
    const drafts = await all('SELECT id, title, item_count, created_at FROM course_drafts ORDER BY created_at DESC');
    const view = req.query.draft ? await one('SELECT * FROM course_drafts WHERE id=$1', [req.query.draft]) : null;
    const max = Math.max(1, ...counts.map((c) => c.n));
    res.page('Course Builder', `
<h1>Course Builder</h1>
${aiNote()}
<p class="muted">Your course writes itself from real student questions and your answers. The more calls you log and questions you answer, the better it gets. Re-generate any time — each version is saved.</p>
<section class="card"><h2>What students ask about most</h2>
${counts.map((c) => `<div class="hbar"><span>${esc(c.topic)}</span><div class="bar"><span style="width:${(c.n / max) * 100}%"></span></div><span class="small muted">${c.n} (${c.verified} verified)</span></div>`).join('') || '<p class="muted">No questions yet.</p>'}
</section>
<form method="post" action="/coach/course" class="card stack"><h2>Generate a course draft</h2>
<p class="small muted">Uses up to 400 of your best Q&As (${total} available). Takes about a minute.</p>
<button class="btn" ${ai.enabled() && total >= 5 ? '' : 'disabled'}>${total < 5 ? 'Need at least 5 Q&As first' : 'Generate draft'}</button></form>
${drafts.length ? `<section class="card"><h2>Drafts</h2><ul class="list">${drafts.map((d) => `<li><a href="/coach/course?draft=${d.id}">${esc(d.title || 'Draft')}</a> <span class="muted small">${date(d.created_at)} · from ${d.item_count} Q&As</span></li>`).join('')}</ul></section>` : ''}
${view ? `<section class="card course"><div class="row"><h2>${esc(view.title || 'Draft')}</h2><button class="btn small ghost right" type="button" data-copy-text="draftBody">Copy</button></div><div>${md(view.body)}</div><textarea id="draftBody" hidden>${esc(view.body)}</textarea></section>` : ''}`);
  }));

  r.post('/course', wrap(async (req, res) => {
    if (!ai.enabled()) return res.redirect('/coach/course');
    const items = await all("SELECT question, answer, topic, approved FROM knowledge WHERE answer IS NOT NULL AND answer <> '' ORDER BY approved DESC, created_at DESC LIMIT 400");
    const topicCounts = await all("SELECT coalesce(nullif(topic,''),'Untagged') topic, count(*)::int n FROM knowledge GROUP BY 1 ORDER BY 2 DESC");
    try {
      const body = await ai.buildCourse({ items, topicCounts });
      const title = (body.match(/^#\s+(.+)/m) || [])[1] || `Course draft ${iso(new Date())}`;
      const d = await one('INSERT INTO course_drafts (title,body,item_count) VALUES ($1,$2,$3) RETURNING id', [clip(title, 200), body, items.length]);
      res.redirect(`/coach/course?draft=${d.id}`);
    } catch (e) {
      console.error('course AI', e.message);
      req.flash('Course generation failed — try again in a minute.', 'err');
      res.redirect('/coach/course');
    }
  }));

  // ---------- Wins ----------
  r.get('/wins', wrap(async (req, res) => {
    const wins = await all('SELECT w.*, s.name, s.ig_handle, s.tiktok_handle FROM wins w JOIN students s ON s.id=w.student_id ORDER BY w.created_at DESC');
    res.page('Wins', `
<h1>Student wins</h1>
<p class="muted">⭐ Feature the best ones for your website and content. Only wins marked "OK to share" can be used publicly.</p>
<div class="grid2">${wins.map((w) => `<article class="card win"><div class="row"><strong>${esc(w.title)}</strong>${w.amount ? `<span class="tag hot">${money(w.amount)}</span>` : ''}
<form method="post" action="/coach/wins/${w.id}/feature" class="inline right"><button class="link">${w.featured ? '⭐ Featured' : '☆ Feature'}</button></form></div>
<div class="muted small"><a href="/coach/students/${w.student_id}">${esc(w.name)}</a>${w.ig_handle ? ` · ${esc(w.ig_handle)}` : ''} · ${date(w.created_at)} · ${w.ok_to_share ? 'OK to share' : '<span class="red">Private</span>'}</div>
${w.story ? `<p>${esc(w.story)}</p>` : ''}${w.proof_url ? `<a href="${esc(w.proof_url)}" target="_blank" rel="noopener" class="small">Proof →</a>` : ''}</article>`).join('') || '<p class="muted">No wins yet.</p>'}</div>`);
  }));

  r.post('/wins/:id/feature', wrap(async (req, res) => {
    await q('UPDATE wins SET featured = NOT featured WHERE id=$1', [req.params.id]);
    res.redirect('/coach/wins');
  }));

  // ---------- Community chat ingest (Discord) ----------
  // A helper page opened from the Discord tab; Discord posts messages to it with postMessage,
  // and it saves them here (same-origin, coach session). Then a background job turns them into Q&As.
  r.get('/ingest', wrap(async (req, res) => {
    const counts = await all("SELECT channel, count(*)::int n, count(*) FILTER (WHERE processed)::int done FROM raw_messages GROUP BY 1 ORDER BY 1");
    const job = await one("SELECT * FROM jobs WHERE name='community'");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Import · Live Selling Coach</title><link rel="stylesheet" href="/static/style.css"></head><body><main>
<h1>Community import</h1>
<p id="st" class="muted">Waiting for messages from Discord…</p>
<section class="card"><h2>Saved so far</h2><ul class="list">${counts.map((c) => `<li>#${esc(c.channel)} · ${c.n} messages · ${c.done} processed</li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
${job ? `<p class="small muted">Processing: ${esc(job.status)} — ${esc(job.detail || '')} (${ago(job.updated_at)})</p>` : ''}
<form method="post" action="/coach/ingest/process"><button class="btn small">Process into Q&As</button></form></section>
<script>
const st=document.getElementById('st');
window.addEventListener('message', async (e) => {
  if (e.origin !== 'https://discord.com' || !e.data || e.data.type !== 'lsc-ingest') return;
  const msgs = e.data.messages || []; let saved = 0;
  for (let i = 0; i < msgs.length; i += 400) {
    const r = await fetch('/coach/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: e.data.channel, reprocess: e.data.reprocess === true, messages: msgs.slice(i, i + 400) }) });
    const j = await r.json(); saved += j.saved || 0;
    st.textContent = 'Saving #' + e.data.channel + ': ' + Math.min(i + 400, msgs.length) + ' / ' + msgs.length;
  }
  st.textContent = 'Saved ' + saved + ' new messages from #' + e.data.channel + '.';
  e.source.postMessage({ type: 'lsc-saved', channel: e.data.channel, saved, total: msgs.length }, e.origin);
});
if (window.opener) window.opener.postMessage({ type: 'lsc-ready' }, 'https://discord.com');
</script></main></body></html>`);
  }));

  r.post('/ingest', express.json({ limit: '10mb' }), wrap(async (req, res) => {
    const channel = clip(req.body?.channel, 80) || 'unknown';
    let saved = 0;
    for (const m of (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(0, 2000)) {
      if (!m?.id || !m.c) continue;
      const r2 = await pool_insert(m, channel, req.body?.reprocess === true);
      saved += r2;
    }
    res.json({ saved });
  }));

  async function pool_insert(m, channel, reprocess) {
    const r2 = await q(`INSERT INTO raw_messages (id,source,channel,sent_at,author,content,reply_to) VALUES ($1,'discord',$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, author=EXCLUDED.author, reply_to=EXCLUDED.reply_to, processed=false
      WHERE raw_messages.content IS NULL AND $7::boolean`,
      [clip(m.id, 80), channel, m.t || null, clip(m.u, 80), clip(m.c, 4000), clip(m.r, 300), reprocess === true]);
    return r2.rowCount;
  }

  let running = false;
  async function setJob(status, detail) {
    await q("INSERT INTO jobs (name,status,detail,updated_at) VALUES ('community',$1,$2,now()) ON CONFLICT (name) DO UPDATE SET status=$1, detail=$2, updated_at=now()", [status, detail]);
  }
  async function processCommunity() {
    if (running) return; running = true;
    const coach = process.env.COACH_DISCORD_NAME || 'YOUNGCEOLEVI';
    let windows = 0; let added = 0;
    try {
      for (;;) {
        const next = await one('SELECT channel FROM raw_messages WHERE NOT processed ORDER BY channel, sent_at LIMIT 1');
        if (!next) break;
        const rows = await all('SELECT id, sent_at, author, content, reply_to FROM raw_messages WHERE NOT processed AND channel=$1 ORDER BY sent_at LIMIT 120', [next.channel]);
        let text = ''; const ids = [];
        for (const m of rows) {
          const line = `[${String(m.sent_at ? new Date(m.sent_at).toISOString().slice(0, 10) : '')}] ${m.author}: ${m.reply_to ? `(↪ ${m.reply_to.slice(0, 120)}) ` : ''}${m.content}\n`;
          if (text.length + line.length > 16000 && ids.length) break;
          text += line; ids.push(m.id);
        }
        await setJob('running', `#${next.channel}: window ${windows + 1}, ${added} Q&As added so far`);
        try {
          const out = await ai.extractCommunity({ channel: next.channel, transcript: text, coachName: coach });
          for (const k of (out.qa || []).slice(0, 60)) {
            if (!k?.question || !k?.answer) continue;
            const dup = await one('SELECT id FROM knowledge WHERE lower(question)=lower($1)', [clip(k.question, 1000)]);
            if (dup) continue;
            await q("INSERT INTO knowledge (source,question,answer,topic,approved) VALUES ('discord',$1,$2,$3,$4)", [clip(k.question, 1000), clip(k.answer, 6000), clip(k.topic, 40), k.by_coach === true]);
            added++;
          }
        } catch (e) {
          console.error('community AI', e.message);
          await setJob('retrying', `AI error on #${next.channel}: ${e.message.slice(0, 120)}`);
          await new Promise((r3) => setTimeout(r3, 20000));
          continue;
        }
        await q('UPDATE raw_messages SET processed=true WHERE id = ANY($1)', [ids]);
        windows++;
      }
      // Raw chat isn't kept once it's been turned into Q&As.
      await q('UPDATE raw_messages SET content=NULL, author=NULL, reply_to=NULL WHERE processed');
      await setJob('done', `${windows} chunks processed, ${added} new Q&As added`);
    } catch (e) {
      console.error('community job', e);
      await setJob('error', e.message.slice(0, 200));
    } finally { running = false; }
  }

  r.post('/ingest/process', wrap(async (req, res) => {
    if (!ai.enabled()) { req.flash('Turn on AI first.', 'err'); return res.redirect('/coach/ingest'); }
    processCommunity();
    req.flash('Processing started. This page shows progress — refresh any time.');
    res.redirect('/coach/brain');
  }));

  // ---------- One-time bulk import (JSON) ----------
  // Skips anyone whose name already exists, so it's safe to run twice.
  r.post('/import', express.json({ limit: '2mb' }), wrap(async (req, res) => {
    const list = Array.isArray(req.body?.students) ? req.body.students : [];
    let added = 0; let skipped = 0;
    for (const s of list.slice(0, 500)) {
      if (!s || !s.name) continue;
      const exists = await one('SELECT id FROM students WHERE lower(name)=lower($1)', [clip(s.name, 120)]);
      if (exists) { skipped++; continue; }
      const st = await one(`INSERT INTO students (name,email,phone,ig_handle,tiktok_handle,program,price,start_date,end_date,status,goal,starting_point,coach_notes,invite_token)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [clip(s.name, 120), s.email ? clip(s.email, 200).toLowerCase() : null, clip(s.phone, 40), clip(s.ig_handle, 80), clip(s.tiktok_handle, 80), clip(s.program, 80), num(s.price) || 0,
        s.start_date || null, s.end_date || null, ['active', 'paused', 'completed', 'renewed', 'refunded', 'archived'].includes(s.status) ? s.status : 'active',
        clip(s.goal, 300), clip(s.starting_point, 300), clip(s.coach_notes, 10000), newToken()]);
      for (const p of (s.payments || []).slice(0, 50)) {
        if (num(p.amount)) await q('INSERT INTO payments (student_id,amount,method,paid_on,note) VALUES ($1,$2,$3,$4,$5)', [st.id, num(p.amount), clip(p.method, 30), p.paid_on || null, clip(p.note, 300)]);
      }
      added++;
    }
    let knowledgeAdded = 0;
    for (const k of (Array.isArray(req.body?.knowledge) ? req.body.knowledge : []).slice(0, 1000)) {
      if (!k?.question || !k?.answer) continue;
      const dup = await one('SELECT id FROM knowledge WHERE lower(question)=lower($1) AND coalesce(ref,\'\')=coalesce($2,\'\')', [clip(k.question, 1000), k.ref || null]);
      if (dup) continue;
      await q('INSERT INTO knowledge (source,question,answer,topic,approved,ref) VALUES ($1,$2,$3,$4,true,$5)',
        [clip(k.source || 'video', 20), clip(k.question, 1000), clip(k.answer, 6000), clip(k.topic, 40), /^https?:\/\//.test(k.ref || '') ? clip(k.ref, 300) : null]);
      knowledgeAdded++;
    }
    let lessonsAdded = 0;
    for (const l of (Array.isArray(req.body?.lessons) ? req.body.lessons : []).slice(0, 200)) {
      if (!l?.title || !l?.url) continue;
      const dup = await one('SELECT id FROM lessons WHERE url=$1', [clip(l.url, 500)]);
      if (dup) continue;
      await q('INSERT INTO lessons (stage,title,url,description,sort) VALUES ($1,$2,$3,$4,$5)', [clip(l.stage, 80), clip(l.title, 200), clip(l.url, 500), clip(l.description, 500), num(l.sort) || 0]);
      lessonsAdded++;
    }
    let purged = 0;
    if (req.body?.purgeTest) {
      const t = await all("SELECT id FROM students WHERE name LIKE 'TEST Student%'");
      for (const x of t) {
        await q("DELETE FROM knowledge WHERE source='call' AND source_id IN (SELECT id FROM calls WHERE student_id=$1)", [x.id]);
        await q('DELETE FROM calls WHERE student_id=$1', [x.id]);
        await q('DELETE FROM students WHERE id=$1', [x.id]);
        purged++;
      }
    }
    res.json({ added, skipped, purged, knowledgeAdded, lessonsAdded });
  }));

  // ---------- Content: lessons, resources, announcements ----------
  r.get('/content', wrap(async (req, res) => {
    const lessons = await all('SELECT * FROM lessons ORDER BY stage, sort, id');
    const resources = await all('SELECT * FROM resources ORDER BY category, title');
    const anns = await all('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20');
    res.page('Content', `
<h1>Content</h1>
<section class="card"><h2>Post an announcement</h2><p class="muted small">Shows on every student's home page.</p>
<form method="post" action="/coach/announcements" class="stack"><input name="title" placeholder="Title" required><textarea name="body" rows="3" placeholder="Message"></textarea><button class="btn small">Post</button></form>
${anns.map((a) => `<div class="row-item"><strong>${esc(a.title)}</strong> <span class="muted small">${date(a.created_at)}</span><form method="post" action="/coach/announcements/${a.id}/delete" class="inline"><button class="link danger small">Remove</button></form></div>`).join('')}
</section>
<section class="card"><h2>Training lessons</h2>
<ul class="list">${lessons.map((l) => `<li><span class="tag">${esc(l.stage)}</span> <a href="${esc(l.url || '#')}" target="_blank" rel="noopener">${esc(l.title)}</a><form method="post" action="/coach/lessons/${l.id}/delete" class="inline"><button class="link danger small">Remove</button></form></li>`).join('')}</ul>
<form method="post" action="/coach/lessons" class="stack"><div class="grid3"><input name="stage" placeholder="Stage, e.g. 2. Setup & Shipping" required list="stages"><input name="title" placeholder="Lesson title" required><input name="url" type="url" placeholder="YouTube / Loom link"></div>
<datalist id="stages">${[...new Set(lessons.map((l) => l.stage))].map((s) => `<option>${esc(s)}</option>`).join('')}</datalist>
<input name="description" placeholder="One line on what they'll learn"><button class="btn small">Add lesson</button></form>
</section>
<section class="card"><h2>Resources</h2>
<ul class="list">${resources.map((x) => `<li><span class="tag">${esc(x.category)}</span> ${esc(x.title)}<form method="post" action="/coach/resources/${x.id}/delete" class="inline"><button class="link danger small">Remove</button></form></li>`).join('')}</ul>
<form method="post" action="/coach/resources" class="stack"><div class="grid3"><input name="category" placeholder="Category" required><input name="title" placeholder="Title" required><input name="url" type="url" placeholder="Link (optional)"></div><input name="description" placeholder="Description"><button class="btn small">Add resource</button></form>
</section>`);
  }));

  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? clip(u, 500) : null);
  r.post('/announcements', wrap(async (req, res) => { await q('INSERT INTO announcements (title,body) VALUES ($1,$2)', [clip(req.body.title, 200), clip(req.body.body, 5000)]); res.redirect('/coach/content'); }));
  r.post('/announcements/:id/delete', wrap(async (req, res) => { await q('DELETE FROM announcements WHERE id=$1', [req.params.id]); res.redirect('/coach/content'); }));
  r.post('/lessons', wrap(async (req, res) => { await q('INSERT INTO lessons (stage,title,url,description) VALUES ($1,$2,$3,$4)', [clip(req.body.stage, 80), clip(req.body.title, 200), safeUrl(req.body.url), clip(req.body.description, 500)]); res.redirect('/coach/content'); }));
  r.post('/lessons/:id/delete', wrap(async (req, res) => { await q('DELETE FROM lessons WHERE id=$1', [req.params.id]); res.redirect('/coach/content'); }));
  r.post('/resources', wrap(async (req, res) => { await q('INSERT INTO resources (category,title,url,description) VALUES ($1,$2,$3,$4)', [clip(req.body.category, 80), clip(req.body.title, 200), safeUrl(req.body.url), clip(req.body.description, 500)]); res.redirect('/coach/content'); }));
  r.post('/resources/:id/delete', wrap(async (req, res) => { await q('DELETE FROM resources WHERE id=$1', [req.params.id]); res.redirect('/coach/content'); }));

  return r;
};
