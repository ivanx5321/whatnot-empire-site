const express = require('express');
const { one, all, q } = require('../db');
const ai = require('../ai');
const { PHASES, ALL_ITEMS } = require('../roadmap');
const { esc, money, date, iso, md, sparkline, bar, ago } = require('../views');

const num = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
const clip = (v, n = 4000) => String(v ?? '').trim().slice(0, n);

async function loadContext(student) {
  const checkins = await all('SELECT * FROM checkins WHERE student_id=$1 ORDER BY week_of DESC, id DESC LIMIT 12', [student.id]);
  const progress = new Set((await all('SELECT item_key FROM progress WHERE student_id=$1', [student.id])).map((r) => r.item_key));
  return { checkins, progress, text: ai.studentContext(student, checkins, progress, ALL_ITEMS) };
}

function dayOfProgram(student) {
  const start = new Date(student.start_date);
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}

const aiOff = '<p class="muted small">Levi AI isn\'t switched on yet. Levi will see this and reply personally.</p>';

module.exports = (wrap) => {
  const r = express.Router();

  // ---------- Home ----------
  r.get('/', wrap(async (req, res) => {
    const s = req.student;
    const { checkins, progress } = await loadContext(s);
    const day = dayOfProgram(s);
    const pct = (progress.size / ALL_ITEMS.length) * 100;
    const nextItems = ALL_ITEMS.filter((i) => !progress.has(i.key)).slice(0, 3);
    const actions = await all('SELECT * FROM action_items WHERE student_id=$1 AND done_at IS NULL ORDER BY created_at DESC LIMIT 8', [s.id]);
    const ann = await all('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3');
    const last = checkins[0];
    const total = checkins.reduce((a, c) => a + Number(c.sales || 0), 0);
    const dueCheckin = !last || (Date.now() - new Date(last.created_at).getTime()) > 6 * 86400000;
    const series = [...checkins].reverse().map((c) => c.sales);

    res.page('Home', `
<h1>Hey ${esc(s.name.split(' ')[0])} 👋</h1>
<p class="muted">Day ${day} of your program${s.goal ? ` · Goal: <strong>${esc(s.goal)}</strong>` : ''}</p>
${dueCheckin ? `<a class="card cta" href="/checkin"><strong>Your weekly check-in is due →</strong><span class="muted small">Takes 2 minutes. Levi reads every one.</span></a>` : ''}
<div class="grid3">
  <div class="card stat"><span class="muted small">Roadmap</span><strong>${Math.round(pct)}%</strong>${bar(pct)}</div>
  <div class="card stat"><span class="muted small">Sales logged (last 12 wks)</span><strong>${money(total)}</strong></div>
  <div class="card stat"><span class="muted small">Last check-in</span><strong>${last ? ago(last.created_at) : 'none yet'}</strong></div>
</div>
<div class="grid2">
  <section class="card"><h2>Weekly sales</h2>${sparkline(series)}</section>
  <section class="card"><h2>Next up on your roadmap</h2>
    ${nextItems.length ? `<ul class="checks">${nextItems.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul><a href="/roadmap" class="small">See full roadmap →</a>` : '<p>You finished the whole roadmap. 🔥 Post your win!</p>'}
  </section>
</div>
<section class="card"><h2>Your action items</h2>
  ${actions.length ? `<ul class="list">${actions.map((a) => `<li><form method="post" action="/actions/${a.id}/done" class="inline"><button class="tick" aria-label="Mark done">✓</button></form> ${esc(a.text)}${a.owner === 'coach' ? ' <span class="tag">Levi</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">Nothing open. Action items from your calls show up here.</p>'}
</section>
${ann.length ? `<section class="card"><h2>From Levi</h2>${ann.map((a) => `<article class="ann"><h3>${esc(a.title)}</h3><div class="muted small">${date(a.created_at)}</div>${md(a.body)}</article>`).join('')}</section>` : ''}
`);
  }));

  r.post('/actions/:id/done', wrap(async (req, res) => {
    await q('UPDATE action_items SET done_at=now() WHERE id=$1 AND student_id=$2', [req.params.id, req.student.id]);
    res.redirect('back');
  }));

  // ---------- Roadmap ----------
  r.get('/roadmap', wrap(async (req, res) => {
    const progress = new Set((await all('SELECT item_key FROM progress WHERE student_id=$1', [req.student.id])).map((x) => x.item_key));
    const day = dayOfProgram(req.student);
    res.page('Roadmap', `
<h1>Your 90-day roadmap</h1>
<p class="muted">Day ${day}. Tick things off as you hit them — Levi sees your progress.</p>
${PHASES.map((p) => {
      const done = p.items.filter(([k]) => progress.has(k)).length;
      const current = day >= p.days[0] && day <= p.days[1];
      return `<section class="card${current ? ' current' : ''}"><div class="row"><h2>${esc(p.title)}</h2>${current ? '<span class="tag hot">You are here</span>' : ''}<span class="muted small right">${done}/${p.items.length}</span></div>
${bar((done / p.items.length) * 100)}
<form method="post" action="/roadmap" class="stack">
${p.items.map(([k, t]) => `<label class="check"><input type="checkbox" name="done" value="${k}" ${progress.has(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}
<input type="hidden" name="phase" value="${p.key}"><button class="btn small">Save</button></form></section>`;
    }).join('')}`);
  }));

  r.post('/roadmap', wrap(async (req, res) => {
    const phase = PHASES.find((p) => p.key === req.body.phase);
    if (!phase) return res.redirect('/roadmap');
    const done = new Set([].concat(req.body.done || []));
    for (const [k] of phase.items) {
      if (done.has(k)) await q('INSERT INTO progress (student_id,item_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.student.id, k]);
      else await q('DELETE FROM progress WHERE student_id=$1 AND item_key=$2', [req.student.id, k]);
    }
    req.flash('Saved. Keep going.');
    res.redirect('/roadmap');
  }));

  // ---------- Weekly check-in ----------
  r.get('/checkin', wrap(async (req, res) => {
    const list = await all('SELECT * FROM checkins WHERE student_id=$1 ORDER BY week_of DESC, id DESC LIMIT 20', [req.student.id]);
    res.page('Check-in', `
<h1>Weekly check-in</h1>
<p class="muted">Be honest — bad weeks are where the coaching happens.</p>
<form method="post" action="/checkin" class="card stack">
  <div class="grid3">
    <label>Week of<input type="date" name="week_of" value="${iso(new Date())}" required></label>
    <label>Shows this week<input type="number" name="shows" min="0" inputmode="numeric" required></label>
    <label>Hours live<input type="number" name="hours_live" min="0" step="0.5" inputmode="decimal"></label>
    <label>Total sales ($)<input type="number" name="sales" min="0" step="0.01" inputmode="decimal" required></label>
    <label>Profit ($, best guess)<input type="number" name="profit" step="0.01" inputmode="decimal"></label>
    <label>Avg viewers<input type="number" name="avg_viewers" min="0" inputmode="numeric"></label>
    <label>Followers now<input type="number" name="followers" min="0" inputmode="numeric"></label>
    <label>Orders<input type="number" name="orders" min="0" inputmode="numeric"></label>
    <label>How do you feel? (1–5)<select name="mood"><option value="">—</option>${[5, 4, 3, 2, 1].map((m) => `<option>${m}</option>`).join('')}</select></label>
  </div>
  <label>Biggest win this week<textarea name="biggest_win" rows="2"></textarea></label>
  <label>Biggest problem / where you're stuck<textarea name="biggest_problem" rows="2"></textarea></label>
  <label>Question for Levi<textarea name="question" rows="2" placeholder="Anything — he answers these and it helps every student."></textarea></label>
  <button class="btn">Submit check-in</button>
</form>
<h2>Past check-ins</h2>
${list.map((c) => `<details class="card"><summary><strong>${date(c.week_of)}</strong> · ${c.shows} shows · ${money(c.sales)} sales${c.profit != null ? ` · ${money(c.profit)} profit` : ''}</summary>
${c.biggest_win ? `<p><strong>Win:</strong> ${esc(c.biggest_win)}</p>` : ''}${c.biggest_problem ? `<p><strong>Problem:</strong> ${esc(c.biggest_problem)}</p>` : ''}${c.question ? `<p><strong>Your question:</strong> ${esc(c.question)}</p>` : ''}
${c.coach_reply ? `<div class="reply"><strong>Levi:</strong>${md(c.coach_reply)}</div>` : ''}
${c.ai_feedback ? `<div class="reply ai"><strong>Levi AI feedback</strong>${md(c.ai_feedback)}</div>` : ''}</details>`).join('') || '<p class="muted">No check-ins yet.</p>'}`);
  }));

  r.post('/checkin', wrap(async (req, res) => {
    const b = req.body;
    const c = await one(`INSERT INTO checkins (student_id,week_of,shows,hours_live,sales,profit,avg_viewers,followers,orders,biggest_win,biggest_problem,question,mood)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.student.id, b.week_of || new Date(), num(b.shows) ?? 0, num(b.hours_live) ?? 0, num(b.sales) ?? 0, num(b.profit), num(b.avg_viewers), num(b.followers), num(b.orders), clip(b.biggest_win), clip(b.biggest_problem), clip(b.question), num(b.mood)]);
    if (c.question) {
      await q("INSERT INTO knowledge (source,source_id,student_id,question,approved) VALUES ('checkin',$1,$2,$3,false)", [c.id, req.student.id, c.question]);
    }
    if (ai.enabled()) {
      try {
        const ctx = await loadContext(req.student);
        const fb = await ai.checkinFeedback({ context: ctx.text, checkin: c });
        await q('UPDATE checkins SET ai_feedback=$1 WHERE id=$2', [fb, c.id]);
      } catch (e) { console.error('checkin AI', e.message); }
    }
    req.flash('Check-in sent to Levi. 🔥');
    res.redirect('/checkin');
  }));

  // ---------- Ask Levi AI ----------
  r.get('/ask', wrap(async (req, res) => {
    const msgs = await all('SELECT role, content, created_at FROM chats WHERE student_id=$1 ORDER BY created_at DESC LIMIT 40', [req.student.id]);
    msgs.reverse();
    res.page('Ask Levi AI', `
<h1>Ask Levi AI</h1>
<p class="muted">Trained on Levi's videos, coaching calls and answers to other students. Big decisions → bring them to your call.</p>
${ai.enabled() ? '' : '<div class="flash warn">Levi AI is being set up. Your questions still go straight to Levi.</div>'}
<section class="card chat" id="chat">
  <div class="msgs" id="msgs">${msgs.map((m) => `<div class="msg ${m.role}">${m.role === 'assistant' ? md(m.content) : esc(m.content)}</div>`).join('') || '<p class="muted" id="empty">Ask anything: shipping, inventory, getting viewers, TikTok approval…</p>'}</div>
  <form method="post" action="/ask" id="askForm" class="askrow">
    <label class="sr" for="q">Your question</label>
    <textarea id="q" name="q" rows="2" required placeholder="e.g. My shows get 15 viewers and nobody buys. What do I change?"></textarea>
    <button class="btn">Send</button>
  </form>
</section>`);
  }));

  r.post('/ask', wrap(async (req, res) => {
    const question = clip(req.body.q, 2000);
    if (!question) return res.redirect('/ask');
    const history = await all('SELECT role, content FROM chats WHERE student_id=$1 ORDER BY created_at DESC LIMIT 10', [req.student.id]);
    history.reverse();
    await q("INSERT INTO chats (student_id,role,content) VALUES ($1,'user',$2)", [req.student.id, question]);
    let answer;
    if (ai.enabled()) {
      try {
        const ctx = await loadContext(req.student);
        answer = await ai.askLevi({ context: ctx.text, history, question });
      } catch (e) {
        console.error('ask AI', e.message);
        answer = "I couldn't answer that right now. I sent your question to Levi so he can answer it personally.";
      }
    } else {
      answer = "Got it — I sent this to Levi. He'll answer it personally, and you'll see it on your Home page.";
    }
    await q("INSERT INTO chats (student_id,role,content) VALUES ($1,'assistant',$2)", [req.student.id, answer]);
    let topic = null;
    if (ai.enabled()) { try { topic = await ai.suggestTopic(question); } catch { /* optional */ } }
    await q("INSERT INTO knowledge (source,student_id,question,answer,topic,approved) VALUES ('chat',$1,$2,$3,$4,false)",
      [req.student.id, question, ai.enabled() ? answer : null, topic]);
    if (req.get('accept')?.includes('application/json')) return res.json({ answer, html: md(answer) });
    res.redirect('/ask#chat');
  }));

  // ---------- Show review ----------
  r.get('/shows', wrap(async (req, res) => {
    const list = await all('SELECT * FROM show_reviews WHERE student_id=$1 ORDER BY show_date DESC, id DESC LIMIT 20', [req.student.id]);
    res.page('Show Review', `
<h1>Show review</h1>
<p class="muted">After a show, log the numbers and paste what you remember (or the replay transcript). You'll get a breakdown of what to fix next time.</p>
${ai.enabled() ? '' : aiOff}
<form method="post" action="/shows" class="card stack">
  <div class="grid3">
    <label>Platform<select name="platform"><option>Whatnot</option><option>TikTok Live</option></select></label>
    <label>Date<input type="date" name="show_date" value="${iso(new Date())}"></label>
    <label>Length (minutes)<input type="number" name="duration_min" min="0" inputmode="numeric"></label>
    <label>Sales ($)<input type="number" name="sales" min="0" step="0.01" inputmode="decimal"></label>
    <label>Peak viewers<input type="number" name="peak_viewers" min="0" inputmode="numeric"></label>
    <label>Items sold<input type="number" name="items_sold" min="0" inputmode="numeric"></label>
  </div>
  <label>Start prices / format<input name="start_price" placeholder="$1 starts, 30-sec timer…"></label>
  <label>What happened? What felt off?<textarea name="what_happened" rows="3"></textarea></label>
  <label>Replay transcript or notes (optional — paste as much as you can)<textarea name="transcript" rows="5"></textarea></label>
  <button class="btn">Get my review</button>
</form>
${list.map((s) => `<details class="card"${s === list[0] ? ' open' : ''}><summary><strong>${date(s.show_date)}</strong> · ${esc(s.platform)} · ${money(s.sales)} · ${s.items_sold ?? '?'} items · ${s.peak_viewers ?? '?'} peak viewers</summary>
${s.coach_comment ? `<div class="reply"><strong>Levi:</strong>${md(s.coach_comment)}</div>` : ''}
${s.ai_review ? `<div class="reply ai">${md(s.ai_review)}</div>` : '<p class="muted">Levi will review this one.</p>'}</details>`).join('')}`);
  }));

  r.post('/shows', wrap(async (req, res) => {
    const b = req.body;
    const s = await one(`INSERT INTO show_reviews (student_id,platform,show_date,duration_min,sales,peak_viewers,items_sold,start_price,what_happened,transcript)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.student.id, clip(b.platform, 40), b.show_date || new Date(), num(b.duration_min), num(b.sales), num(b.peak_viewers), num(b.items_sold), clip(b.start_price, 200), clip(b.what_happened), clip(b.transcript, 60000)]);
    if (ai.enabled()) {
      try {
        const ctx = await loadContext(req.student);
        const review = await ai.reviewShow({ context: ctx.text, show: s });
        await q('UPDATE show_reviews SET ai_review=$1 WHERE id=$2', [review, s.id]);
      } catch (e) { console.error('show AI', e.message); }
    }
    res.redirect('/shows');
  }));

  // ---------- Training ----------
  r.get('/training', wrap(async (req, res) => {
    const lessons = await all('SELECT * FROM lessons ORDER BY stage, sort, id');
    const done = new Set((await all('SELECT lesson_id FROM lesson_progress WHERE student_id=$1', [req.student.id])).map((x) => x.lesson_id));
    const stages = [...new Set(lessons.map((l) => l.stage))];
    res.page('Training', `
<h1>Training library</h1>
<p class="muted">${done.size} of ${lessons.length} lessons done</p>${bar(lessons.length ? (done.size / lessons.length) * 100 : 0)}
${stages.map((st) => `<section class="card"><h2>${esc(st)}</h2><ul class="lessons">${lessons.filter((l) => l.stage === st).map((l) => `
<li class="${done.has(l.id) ? 'done' : ''}"><div><a href="${esc(l.url || '#')}" target="_blank" rel="noopener"><strong>${esc(l.title)}</strong></a>${l.description ? `<div class="muted small">${esc(l.description)}</div>` : ''}</div>
<form method="post" action="/training/${l.id}"><button class="btn small ${done.has(l.id) ? 'ghost' : ''}">${done.has(l.id) ? 'Done ✓' : 'Mark done'}</button></form></li>`).join('')}</ul></section>`).join('')}`);
  }));

  r.post('/training/:id', wrap(async (req, res) => {
    const ex = await one('SELECT 1 FROM lesson_progress WHERE student_id=$1 AND lesson_id=$2', [req.student.id, req.params.id]);
    if (ex) await q('DELETE FROM lesson_progress WHERE student_id=$1 AND lesson_id=$2', [req.student.id, req.params.id]);
    else await q('INSERT INTO lesson_progress (student_id,lesson_id) SELECT $1,$2 WHERE EXISTS (SELECT 1 FROM lessons WHERE id=$2)', [req.student.id, req.params.id]);
    res.redirect('/training');
  }));

  // ---------- Resources ----------
  r.get('/resources', wrap(async (req, res) => {
    const list = await all('SELECT * FROM resources ORDER BY category, title');
    const cats = [...new Set(list.map((x) => x.category))];
    res.page('Resources', `<h1>Resources</h1>${cats.map((c) => `<section class="card"><h2>${esc(c)}</h2><ul class="list">${list.filter((x) => x.category === c).map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"><strong>${esc(x.title)}</strong></a>` : `<strong>${esc(x.title)}</strong>`}${x.description ? `<div class="muted small">${esc(x.description)}</div>` : ''}</li>`).join('')}</ul></section>`).join('')}`);
  }));

  // ---------- Wins ----------
  r.get('/wins', wrap(async (req, res) => {
    const mine = await all('SELECT * FROM wins WHERE student_id=$1 ORDER BY created_at DESC', [req.student.id]);
    const wall = await all('SELECT w.*, s.name FROM wins w JOIN students s ON s.id=w.student_id WHERE w.ok_to_share ORDER BY w.created_at DESC LIMIT 30');
    res.page('Wins', `
<h1>Wins</h1>
<form method="post" action="/wins" class="card stack">
  <h2>Post a win</h2>
  <div class="grid2"><label>What happened?<input name="title" required placeholder="First $1K show!"></label>
  <label>Amount ($, optional)<input type="number" name="amount" min="0" step="0.01" inputmode="decimal"></label></div>
  <label>Tell the story<textarea name="story" rows="3"></textarea></label>
  <label>Screenshot link (optional)<input name="proof_url" type="url" placeholder="https://"></label>
  <label class="check"><input type="checkbox" name="ok_to_share" value="1" checked> Levi can share this with other students and on his website</label>
  <button class="btn">Post win</button>
</form>
<h2>Student wins</h2>
<div class="grid2">${wall.map((w) => `<article class="card win"><strong>${esc(w.title)}</strong>${w.amount ? ` <span class="tag hot">${money(w.amount)}</span>` : ''}<div class="muted small">${esc(w.name.split(' ')[0])} · ${date(w.created_at)}</div>${w.story ? `<p>${esc(w.story)}</p>` : ''}</article>`).join('') || '<p class="muted">Be the first.</p>'}</div>
${mine.length ? `<h2>Your wins</h2><ul class="list">${mine.map((w) => `<li>${esc(w.title)} ${w.amount ? money(w.amount) : ''} <span class="muted small">${date(w.created_at)}</span></li>`).join('')}</ul>` : ''}`);
  }));

  r.post('/wins', wrap(async (req, res) => {
    const b = req.body;
    const url = /^https?:\/\//i.test(b.proof_url || '') ? clip(b.proof_url, 500) : null;
    await q('INSERT INTO wins (student_id,title,amount,story,proof_url,ok_to_share) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.student.id, clip(b.title, 200), num(b.amount), clip(b.story), url, b.ok_to_share === '1']);
    req.flash('Win posted! 🏆');
    res.redirect('/wins');
  }));

  return r;
};
