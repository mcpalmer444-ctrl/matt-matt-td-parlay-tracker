import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false })
  : null;

const memory = {
  bankroll: { mattP: 31.50, mattB: 31.50 },
  transactions: [],
  parlays: []
};

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bankroll_transactions (
      id SERIAL PRIMARY KEY,
      person TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS parlays (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      wager NUMERIC(12,2) NOT NULL,
      potential_payout NUMERIC(12,2),
      actual_payout NUMERIC(12,2) DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'live',
      promo_adjusted_payout NUMERIC(12,2),
      source TEXT DEFAULT 'manual',
      legs JSONB NOT NULL
    );
  `);
}

async function getState() {
  if (!pool) return memory;
  const tx = await pool.query("SELECT * FROM bankroll_transactions ORDER BY created_at DESC");
  const ps = await pool.query("SELECT * FROM parlays ORDER BY created_at DESC");
  let mattP = 31.50, mattB = 31.50;
  for (const t of tx.rows) {
    if (t.person === "mattP") mattP += Number(t.amount);
    if (t.person === "mattB") mattB += Number(t.amount);
  }
  return {
    bankroll: { mattP, mattB },
    transactions: tx.rows,
    parlays: ps.rows.map(p => ({...p, legs: p.legs}))
  };
}

app.get("/api/state", async (_req,res) => res.json(await getState()));

app.post("/api/transactions", async (req,res) => {
  const { person, amount, note = "" } = req.body;
  if (!["mattP","mattB"].includes(person) || !Number.isFinite(Number(amount))) {
    return res.status(400).json({error:"Invalid transaction"});
  }
  if (pool) {
    await pool.query("INSERT INTO bankroll_transactions(person, amount, note) VALUES($1,$2,$3)", [person, Number(amount), note]);
  } else {
    memory.transactions.unshift({id:Date.now(), person, amount:Number(amount), note, created_at:new Date().toISOString()});
    memory.bankroll[person] += Number(amount);
  }
  res.json(await getState());
});

app.post("/api/parlays", async (req,res) => {
  const p = req.body;
  if (!Array.isArray(p.legs) || !p.legs.length || !Number.isFinite(Number(p.wager))) {
    return res.status(400).json({error:"Parlay needs legs and wager"});
  }
  const parlay = {
    id: Date.now(),
    created_at: new Date().toISOString(),
    wager: Number(p.wager),
    potential_payout: Number(p.potential_payout || 0),
    actual_payout: 0,
    status: "live",
    promo_adjusted_payout: p.promo_adjusted_payout ?? null,
    source: p.source || "manual",
    legs: p.legs
  };
  if (pool) {
    const r = await pool.query(
      "INSERT INTO parlays(wager,potential_payout,actual_payout,status,promo_adjusted_payout,source,legs) VALUES($1,$2,0,'live',$3,$4,$5) RETURNING *",
      [parlay.wager, parlay.potential_payout, parlay.promo_adjusted_payout, parlay.source, JSON.stringify(parlay.legs)]
    );
    return res.json(r.rows[0]);
  }
  memory.parlays.unshift(parlay);
  res.json(parlay);
});

app.patch("/api/parlays/:id", async (req,res) => {
  const id = req.params.id;
  const { status, actual_payout, legs } = req.body;
  if (pool) {
    const r = await pool.query(
      "UPDATE parlays SET status=COALESCE($1,status), actual_payout=COALESCE($2,actual_payout), legs=COALESCE($3,legs) WHERE id=$4 RETURNING *",
      [status ?? null, actual_payout ?? null, legs ? JSON.stringify(legs) : null, id]
    );
    if (!r.rowCount) return res.status(404).json({error:"Not found"});
    return res.json(r.rows[0]);
  }
  const p = memory.parlays.find(x => String(x.id) === String(id));
  if (!p) return res.status(404).json({error:"Not found"});
  if (status) p.status = status;
  if (actual_payout !== undefined) p.actual_payout = Number(actual_payout);
  if (legs) p.legs = legs;
  res.json(p);
});

app.post("/api/import/parse", (req,res) => {
  const text = String(req.body.text || "");
  // Flexible MVP parser: one leg per line. Examples:
  // Josh Jacobs | GB vs CHI | Anytime TD | +120
  const legs = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((line, i) => {
    const parts = line.split("|").map(x => x.trim());
    return {
      id: crypto.randomUUID(),
      player: parts[0] || `Player ${i+1}`,
      game: parts[1] || "",
      market: parts[2] || "Anytime TD",
      odds: parts[3] || "",
      status: "not_started",
      promo: false
    };
  });
  res.json({source:"draftkings_import", legs});
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist));
  app.get("*splat", (_req,res) => res.sendFile(path.join(clientDist, "index.html")));
}

initDb().then(() => app.listen(process.env.PORT || 3000, () => {
  console.log(`Matt & Matt tracker running on ${process.env.PORT || 3000}`);
})).catch(err => { console.error(err); process.exit(1); });
