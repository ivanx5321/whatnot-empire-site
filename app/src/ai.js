const PERSONA = require('./persona');
const { all } = require('./db');

const API_KEY = () => process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';

const enabled = () => Boolean(API_KEY());

async function claude({ system, messages, maxTokens = 1200, timeoutMs = 60000 }) {
  if (!enabled()) throw new Error('AI_NOT_CONNECTED');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`AI error ${res.status}: ${data?.error?.message || 'unknown'}`);
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  } finally {
    clearTimeout(t);
  }
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Find the most relevant things Levi has already answered (approved first).
async function searchKnowledge(query, limit = 6) {
  if (!query || !query.trim()) return [];
  return all(
    `SELECT id, question, answer, topic, approved,
            ts_rank(to_tsvector('english', coalesce(question,'')||' '||coalesce(answer,'')||' '||coalesce(topic,'')),
                    plainto_tsquery('english', $1)) AS rank
       FROM knowledge
      WHERE answer IS NOT NULL AND answer <> ''
        AND to_tsvector('english', coalesce(question,'')||' '||coalesce(answer,'')||' '||coalesce(topic,''))
            @@ plainto_tsquery('english', $1)
      ORDER BY approved DESC, rank DESC
      LIMIT $2`,
    [query, limit]
  );
}

function studentContext(student, checkins, progressKeys, roadmapItems) {
  const done = roadmapItems.filter((i) => progressKeys.has(i.key)).map((i) => i.title);
  const next = roadmapItems.filter((i) => !progressKeys.has(i.key)).slice(0, 3).map((i) => i.title);
  const recent = checkins.slice(0, 4).map((c) =>
    `- Week of ${String(c.week_of).slice(0, 10)}: ${c.shows} shows, $${c.sales} sales${c.profit != null ? `, $${c.profit} profit` : ''}${c.avg_viewers != null ? `, ${c.avg_viewers} avg viewers` : ''}. Problem: ${c.biggest_problem || 'n/a'}`
  ).join('\n');
  return `STUDENT: ${student.name}. Platforms: ${student.platforms || 'n/a'}. Started ${String(student.start_date).slice(0, 10)}.
Goal: ${student.goal || 'not set'}. Starting point: ${student.starting_point || 'n/a'}.
Roadmap done (${done.length}/${roadmapItems.length}): ${done.slice(-5).join('; ') || 'nothing yet'}.
Next up: ${next.join('; ') || 'all done'}.
Recent check-ins:
${recent || '- none yet'}`;
}

function knowledgeBlock(hits) {
  if (!hits.length) return '';
  return '\n\nRELEVANT ANSWERS FROM LEVI\'S CALLS & PAST QUESTIONS:\n' + hits.map((h) =>
    `${h.approved ? "[Levi's verified answer]" : '[unverified AI answer]'} Q: ${h.question}\nA: ${h.answer}`
  ).join('\n\n');
}

async function askLevi({ context, history, question }) {
  const hits = await searchKnowledge(question);
  const system = `${PERSONA}\n\n${context}${knowledgeBlock(hits)}`;
  const messages = [...history.slice(-10).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: question }];
  return claude({ system, messages, maxTokens: 900 });
}

async function checkinFeedback({ context, checkin }) {
  const system = `${PERSONA}\n\n${context}`;
  const prompt = `The student just submitted this weekly check-in:
Shows: ${checkin.shows}, hours live: ${checkin.hours_live}, sales: $${checkin.sales}, profit: ${checkin.profit ?? 'n/a'}, avg viewers: ${checkin.avg_viewers ?? 'n/a'}, followers: ${checkin.followers ?? 'n/a'}, orders: ${checkin.orders ?? 'n/a'}, mood ${checkin.mood ?? 'n/a'}/5.
Biggest win: ${checkin.biggest_win || 'n/a'}
Biggest problem: ${checkin.biggest_problem || 'n/a'}
Question for Levi: ${checkin.question || 'none'}

Write quick feedback as Levi: 1 line on what's good, the #1 thing to fix this week (with specific how-to), and 3 numbered action items for next week. Under 170 words. If they asked a question, answer it briefly too.`;
  return claude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 700 });
}

async function reviewShow({ context, show }) {
  const system = `${PERSONA}\n\n${context}`;
  const prompt = `Review this live show like Levi would after watching the replay.
Platform: ${show.platform}. Duration: ${show.duration_min ?? '?'} min. Sales: $${show.sales ?? '?'}. Peak viewers: ${show.peak_viewers ?? '?'}. Items sold: ${show.items_sold ?? '?'}. Start prices: ${show.start_price || '?'}.
What happened (student's words): ${show.what_happened || 'n/a'}
Transcript / notes from the replay (may be partial):
${(show.transcript || 'none provided').slice(0, 15000)}

Give:
1) Scores 1–10 for: Opening hook, Pace & sales velocity, Viewers→buyers (shipping explained, "if you're new comment me"), Engagement & giveaways, Closing / end-point pressure.
2) Key numbers: sales per hour, $ per item, and what they suggest.
3) Top 3 fixes for the next show, each with an exact line to say or thing to do.
Be honest and specific. Under 300 words.`;
  return claude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 1100 });
}

async function analyzeCall({ studentName, kind, notes }) {
  const system = `You extract structured coaching data from Levi Salas's coaching call notes or transcripts (live selling on Whatnot and TikTok Live). Only use what is in the text. Answers must be Levi's actual guidance from the call, written clearly and completely enough to teach another student.`;
  const prompt = `Call type: ${kind}. Student: ${studentName || 'group / none'}.
Notes or transcript:
"""
${notes.slice(0, 60000)}
"""

Return ONLY JSON:
{
 "summary": "3-5 sentence summary",
 "action_items": [{"owner": "student" | "coach", "text": "..."}],
 "qa": [{"question": "a question the student asked or a problem they raised, written generally", "answer": "Levi's answer/advice from the call", "topic": "one of: Getting Started, Shipping, Inventory, Running Shows, Getting Viewers, TikTok, Whatnot, Hiring & Team, Money & Profit, Mindset, Tools, Other"}],
 "student_wins": ["..."],
 "concerns": ["risks or signs the student is struggling"]
}`;
  const text = await claude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 3000, timeoutMs: 120000 });
  return parseJson(text) || { summary: text, action_items: [], qa: [], student_wins: [], concerns: [] };
}

async function extractCommunity({ channel, transcript, coachName }) {
  const system = `You turn a live-selling (Whatnot / TikTok Live) community chat log into a coaching knowledge base. The community belongs to coach ${coachName}. Only use what is in the log.`;
  const prompt = `Channel: #${channel}. Chat log in time order. Format: [date] author: message  (↪ = replying to).
"""
${transcript}
"""

Find every real question a seller asked that got a useful answer in the log (including later replies), AND every useful tip, rule of thumb, number, supplier/tool recommendation or lesson someone shared even if nobody asked (write those as the question a seller would ask). Be thorough — a busy chunk can easily have 5-15. For each, write a general standalone Q&A a future student could learn from.
Rules:
- Rewrite the question generally (no names, no @mentions, no personal details).
- The answer combines the useful replies: concrete steps, numbers, tools, settings. 2-6 sentences. No names.
- by_coach = true only if ${coachName}'s own messages supplied the core of the answer.
- Skip: unanswered questions, jokes, hype, personal chit-chat, self-promo, anything unsafe or that's just someone's opinion with no reasoning.
- topic: one of Getting Started, Shipping, Inventory, Running Shows, Getting Viewers, TikTok, Whatnot, Hiring & Team, Money & Profit, Mindset, Tools, Other
Return ONLY JSON: {"qa":[{"question":"...","answer":"...","topic":"...","by_coach":true}]}  (use {"qa":[]} if nothing qualifies)`;
  const text = await claude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 4000, timeoutMs: 180000 });
  return parseJson(text) || { qa: [] };
}

const DM_VOICE = `You write Instagram/TikTok DM replies AS Levi Salas (live selling coach, Whatnot + TikTok Live). Sound exactly like him:
- casual, mostly lowercase, little punctuation, no period at the end of a bubble
- short bubbles, 1-4 of them, each under ~25 words. no greetings like "Hello!", no sign-offs
- slang he really uses, sparingly: yessir, bet, bro, ya, fr, lol. at most one emoji (😂 😭 🔥) and often none
- blunt, helpful, talks numbers casually
Facts about Levi you may use: $1.2M on Whatnot in ~9 months, ~$3M on TikTok Live in his first 5 months, runs a squishy live-selling operation with hired hosts, co-owns ViewNot. Never invent other numbers or results; never promise income.
Links (only when they fit): free course https://livesellingcoach.com/free-course/ · apply for a 1-on-1 strategy call https://livesellingcoach.com/#apply
Goal: actually answer their question with one real tip (use the knowledge below), then move them one step: curious beginners -> free course; people with money/serious intent or already selling -> ask 1 qualifying question (what platform, how long, monthly sales, budget) or send the apply link; existing students -> help and tell them to bring it to their next call. Coaching is 1-on-1, about $5k for 3-5 months; only mention price if they ask.
Never ask for passwords, card numbers or money in DMs. If it's spam, a scam, or abusive, say so and draft nothing.`;

async function draftDM({ message, context }) {
  const hits = await searchKnowledge(message, 5);
  const kb = hits.length ? '\n\nLEVI\'S OWN ANSWERS ON THIS TOPIC (use these):\n' + hits.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n') : '';
  const prompt = `${context ? `Context about this person: ${context}\n` : ''}Their DM (may include earlier back-and-forth):
"""
${message.slice(0, 6000)}
"""

Return ONLY JSON:
{"lead":"hot"|"warm"|"curious"|"student"|"not a lead","why":"one short line on why","bubbles":["reply bubble 1","bubble 2"],"next":"what Levi should do after sending, one short line"}`;
  const text = await claude({ system: DM_VOICE + kb, messages: [{ role: 'user', content: prompt }], maxTokens: 800 });
  return parseJson(text) || { lead: 'curious', why: '', bubbles: [text], next: '' };
}

async function classifyLeads(convos) {
  const system = `You sort Instagram DM conversations for Levi Salas, who sells 1-on-1 live selling coaching (Whatnot + TikTok Live, about $5k for 3-5 months). "Levi" lines are his replies.`;
  const body = convos.map((c, i) => `### ${i} @${c.handle}\n${c.convo}`).join('\n\n');
  const prompt = `${body}

For EACH conversation return one item. level:
- "hot": clearly wants coaching/mentorship, asked price, ready to pay or book, or already in a sales conversation
- "warm": aspiring or current live seller asking for help/advice who could become a client
- "student": already a paying student / onboarding
- "other": friends, suppliers, vendors, buyers, collabs, people pitching Levi services, spam, scams
summary: one short line (no more than 20 words) of who they are and what they want.
ask: their key question or request, short.
next: the single best next move for Levi (e.g. "send booking link", "answer then send free course", "ignore").
Return ONLY JSON: {"items":[{"i":0,"level":"...","summary":"...","ask":"...","next":"..."}]}`;
  const text = await claude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 3500, timeoutMs: 180000 });
  return (parseJson(text) || { items: [] }).items || [];
}

async function suggestTopic(question) {
  const text = await claude({
    system: 'Classify a live-selling coaching question into ONE topic. Reply with only the topic name.',
    messages: [{ role: 'user', content: `Topics: Getting Started, Shipping, Inventory, Running Shows, Getting Viewers, TikTok, Whatnot, Hiring & Team, Money & Profit, Mindset, Tools, Other\nQuestion: ${question}` }],
    maxTokens: 20,
  });
  return text.split('\n')[0].trim().slice(0, 40);
}

async function buildCourse({ items, topicCounts }) {
  const system = `You are helping Levi Salas turn months of real student questions and his answers into a course on live selling (Whatnot + TikTok Live). Prioritize what students struggle with most (frequency). Use Levi's own answers and wording as the lesson content. Don't invent results or numbers.`;
  const body = items.map((k) => `[${k.topic || 'Other'}]${k.approved ? ' (verified)' : ''} Q: ${k.question}\nA: ${k.answer || '(no answer yet)'}`).join('\n\n').slice(0, 120000);
  const prompt = `Topic frequency: ${topicCounts.map((t) => `${t.topic}: ${t.n}`).join(', ')}

Knowledge base (${items.length} items):
${body}

Write a course outline in Markdown:
# Course title
Short promise (1 sentence).
Then 6–10 modules ordered from beginner to advanced. For each module: "## Module N: Title", why it matters (1 line, mention how often students asked about it), then 3–6 lessons as "### Lesson: Title" with 2–4 bullet points of the key teaching pulled from Levi's answers, and a "Homework:" line.
End with "## Gaps to record" — questions that came up but have no good answer yet, which Levi should record a video on.`;
  return claude({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 6000, timeoutMs: 180000 });
}

module.exports = { enabled, draftDM, classifyLeads, extractCommunity, askLevi, checkinFeedback, reviewShow, analyzeCall, suggestTopic, buildCourse, studentContext, searchKnowledge };
