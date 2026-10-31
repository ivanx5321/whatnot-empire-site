const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://localhost/coachapp';
const useSsl = /render\.com|amazonaws|sslmode=require/.test(connectionString) || process.env.PGSSL === '1';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
});

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
const all = async (text, params) => (await pool.query(text, params)).rows;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('coach','student')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  ig_handle TEXT,
  tiktok_handle TEXT,
  whatnot_handle TEXT,
  platforms TEXT DEFAULT 'Whatnot + TikTok',
  program TEXT DEFAULT '90-Day 1-on-1',
  price NUMERIC(10,2) DEFAULT 0,
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT DEFAULT 'active',
  goal TEXT,
  starting_point TEXT,
  coach_notes TEXT,
  invite_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  method TEXT,
  paid_on DATE DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress (
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  done_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (student_id, item_key)
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  week_of DATE DEFAULT CURRENT_DATE,
  shows INT DEFAULT 0,
  hours_live NUMERIC(6,1) DEFAULT 0,
  sales NUMERIC(12,2) DEFAULT 0,
  profit NUMERIC(12,2),
  avg_viewers INT,
  followers INT,
  orders INT,
  biggest_win TEXT,
  biggest_problem TEXT,
  question TEXT,
  mood INT,
  ai_feedback TEXT,
  coach_reply TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'coaching',
  call_date DATE DEFAULT CURRENT_DATE,
  title TEXT,
  notes TEXT,
  summary TEXT,
  ai_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_items (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  call_id INT REFERENCES calls(id) ON DELETE SET NULL,
  owner TEXT DEFAULT 'student',
  text TEXT NOT NULL,
  due DATE,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_id INT,
  student_id INT REFERENCES students(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  answer TEXT,
  topic TEXT,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS show_reviews (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  platform TEXT,
  show_date DATE DEFAULT CURRENT_DATE,
  duration_min INT,
  sales NUMERIC(12,2),
  peak_viewers INT,
  items_sold INT,
  start_price TEXT,
  what_happened TEXT,
  transcript TEXT,
  ai_review TEXT,
  coach_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wins (
  id SERIAL PRIMARY KEY,
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(12,2),
  story TEXT,
  proof_url TEXT,
  ok_to_share BOOLEAN DEFAULT false,
  featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  description TEXT,
  sort INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  lesson_id INT REFERENCES lessons(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (student_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_drafts (
  id SERIAL PRIMARY KEY,
  title TEXT,
  body TEXT,
  item_count INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS ref TEXT;

CREATE TABLE IF NOT EXISTS raw_messages (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  channel TEXT,
  sent_at TIMESTAMPTZ,
  author TEXT,
  content TEXT,
  reply_to TEXT,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS raw_messages_todo ON raw_messages(processed, channel, sent_at);

CREATE TABLE IF NOT EXISTS jobs (
  name TEXT PRIMARY KEY,
  status TEXT,
  detail TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_fts ON knowledge
  USING GIN (to_tsvector('english', coalesce(question,'') || ' ' || coalesce(answer,'') || ' ' || coalesce(topic,'')));
CREATE INDEX IF NOT EXISTS checkins_student ON checkins(student_id, week_of DESC);
CREATE INDEX IF NOT EXISTS chats_student ON chats(student_id, created_at);
`;

const SEED_LESSONS = [
  ['1. Foundations', 'The full live selling course: how I did $1.2M in 9 months', 'https://www.youtube.com/watch?v=ElVL0NT1tp4', 'Start here. Watch every second.', 1],
  ['1. Foundations', 'TikTok Live or Whatnot?', 'https://www.youtube.com/watch?v=Eq1xymBqpnk', 'Which platform to start on and why you should do both.', 2],
  ['2. Setup & Shipping', 'Shipping explained: the free shipping strategy', 'https://www.youtube.com/watch?v=dVYoobvyTAg', 'Custom shipping profiles, "buy two, next eight free".', 1],
  ['3. Inventory', 'How to find inventory', 'https://www.youtube.com/watch?v=QaLW8ZkZsYs', 'Liquidation, pallets, storage auctions, cost per unit.', 1],
  ['4. Running Shows', 'Turning viewers into buyers', 'https://www.youtube.com/watch?v=Xa4sr7K4YPo', 'Viewers to buyers system, $1 starts, end-point pressure.', 1],
  ['5. Scaling', 'How an 18-year-old built a 6-figure faceless business', 'https://www.youtube.com/watch?v=HaQGNafkTWI', 'Hosts, systems, removing yourself from the stream.', 1],
];

const SEED_RESOURCES = [
  ['Inventory', 'East Coast Distribution', '','Inventory for students. Ask Levi for the current student price list.'],
  ['Tools', 'ViewNot', 'https://viewnot.com', 'Live show analytics. Student access included.'],
  ['Shipping', 'Shipping supplies checklist', '', 'Thermal label printer, scale, poly mailers, bubble mailers, numbered stickers, scan sheet.'],
  ['Scripts', 'Viewers → Buyers script', '', '"If you\'re new here, comment me." Every 5–10 minutes, then explain bundle shipping: buy two, the next ones ship free.'],
];

async function migrate() {
  await pool.query(SCHEMA);
  const { count } = await one('SELECT count(*)::int AS count FROM lessons');
  if (count === 0) {
    for (const l of SEED_LESSONS) {
      await q('INSERT INTO lessons (stage,title,url,description,sort) VALUES ($1,$2,$3,$4,$5)', l);
    }
  }
  const r = await one('SELECT count(*)::int AS count FROM resources');
  if (r.count === 0) {
    for (const x of SEED_RESOURCES) {
      await q('INSERT INTO resources (category,title,url,description) VALUES ($1,$2,$3,$4)', x);
    }
  }
}

module.exports = { pool, q, one, all, migrate };
