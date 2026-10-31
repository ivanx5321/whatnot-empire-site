const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => {
  if (n === null || n === undefined || n === '') return '—';
  const x = Number(n);
  return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
};
const date = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const ago = (d) => {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

// Very small, safe markdown: headings, bold, bullets, numbered lists, paragraphs.
function md(text) {
  if (!text) return '';
  const lines = esc(text).split('\n');
  let out = '';
  let list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { close(); const l = Math.min(m[1].length + 1, 5); out += `<h${l}>${m[2]}</h${l}>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${m[1]}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${m[1]}</li>`; }
    else if (!line.trim()) { close(); }
    else { close(); out += `<p>${line}</p>`; }
  }
  close();
  return out;
}

function sparkline(values, { w = 260, h = 56 } = {}) {
  const v = values.map(Number).filter((x) => !Number.isNaN(x));
  if (v.length < 2) return '<div class="muted small">Not enough check-ins yet for a chart.</div>';
  const max = Math.max(...v, 1);
  const min = Math.min(...v, 0);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 8) + 4},${h - 4 - ((x - min) / (max - min || 1)) * (h - 8)}`).join(' ');
  const last = pts.split(' ').pop().split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Weekly sales trend">
<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
<circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--accent)"/></svg>`;
}

function bar(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;
}

const STUDENT_NAV = [
  ['/', 'Home'], ['/roadmap', 'Roadmap'], ['/checkin', 'Check-in'], ['/ask', 'Ask Levi AI'],
  ['/shows', 'Show Review'], ['/training', 'Training'], ['/resources', 'Resources'], ['/wins', 'Wins'],
];
const COACH_NAV = [
  ['/coach', 'Dashboard'], ['/coach/students', 'Students'], ['/coach/calls', 'Calls'], ['/coach/questions', 'Questions'],
  ['/coach/brain', 'Knowledge Brain'], ['/coach/course', 'Course Builder'], ['/coach/wins', 'Wins'],
  ['/coach/content', 'Content'],
];

function layout({ title, user, path = '', body, flash }) {
  const nav = !user ? [] : user.role === 'coach' ? COACH_NAV : STUDENT_NAV;
  const navHtml = nav.map(([href, label]) => {
    const active = href === path || (href !== '/' && href !== '/coach' && path.startsWith(href));
    return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ''}>${esc(label)}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Live Selling Coach</title>
<link rel="stylesheet" href="/static/style.css">
</head><body>
<header class="top">
  <a class="brand" href="${user ? (user.role === 'coach' ? '/coach' : '/') : '/login'}">Live Selling Coach</a>
  ${user ? `<div class="who"><span class="muted small">${esc(user.name)}${user.role === 'coach' ? ' · Coach' : ''}</span>
  <form method="post" action="/logout"><button class="link">Log out</button></form></div>` : ''}
</header>
${nav.length ? `<nav class="tabs" aria-label="Main">${navHtml}</nav>` : ''}
<main>
${flash ? `<div class="flash ${esc(flash.type || 'ok')}" role="status">${esc(flash.msg)}</div>` : ''}
${body}
</main>
<script src="/static/app.js" defer></script>
</body></html>`;
}

module.exports = { esc, money, date, iso, ago, md, sparkline, bar, layout };
