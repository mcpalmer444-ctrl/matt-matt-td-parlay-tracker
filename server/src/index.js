import { getNFLPlayerStatuses } from "./nfl.js";
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
      historical BOOLEAN DEFAULT FALSE,
      legs JSONB NOT NULL
    );

    ALTER TABLE parlays
    ADD COLUMN IF NOT EXISTS historical BOOLEAN DEFAULT FALSE;
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
function updateParlayResult(parlay) {
  const legs = parlay.legs || [];

  if (!legs.length) {
    return parlay;
  }
async function settleParlay(parlay) {
  if (!pool) return;

  const settlementNote = `Parlay #${parlay.id} ${parlay.status.toUpperCase()}`;

const existing = await pool.query(
  "SELECT 1 FROM bankroll_transactions WHERE note = $1 LIMIT 1",
  [settlementNote]
);

  if (existing.rowCount) {
    return;
  }

  const wager = Number(parlay.wager || 0);

  const payout =
    parlay.status === "won"
      ? Number(parlay.potential_payout || 0)
      : 0;

  const settlementAmount =
  parlay.status === "won"
    ? payout
    : 0;

const mattPAmount = settlementAmount / 2;
const mattBAmount = settlementAmount / 2;

  await pool.query(
    "INSERT INTO bankroll_transactions(person, amount, note) VALUES($1,$2,$3),($4,$5,$6)",
    [
      "mattP",
      mattPAmount,
      `Parlay #${parlay.id} ${parlay.status.toUpperCase()}`,
      "mattB",
      mattBAmount,
      `Parlay #${parlay.id} ${parlay.status.toUpperCase()}`
    ]
  );
}
  const hasFailed = legs.some((leg) => leg.status === "failed");
  const allScored = legs.every((leg) => leg.status === "td_scored");

  if (hasFailed) {
    return {
      ...parlay,
      status: "lost",
      result: "LOSS",
    };
  }

  if (allScored) {
    return {
      ...parlay,
      status: "won",
      result: "WIN",
    };
  }

 return parlay;
}
app.post("/api/live-status", async (req, res) => {
  try {
    const players = Array.isArray(req.body?.players)
      ? req.body.players
      : [];

    if (!players.length) {
      return res.json({ players: [] });
    }

    const statuses = await getNFLPlayerStatuses(players);
    const statusMap = new Map(
  statuses.map((x) => [String(x.id), x])
);

if (pool) {
  const parlayIds = [...new Set(
    players
      .map((p) => p.parlayId)
      .filter(Boolean)
  )];

  for (const parlayId of parlayIds) {
    const current = await pool.query(
      "SELECT * FROM parlays WHERE id=$1",
      [parlayId]
    );

    if (!current.rowCount) continue;

    const parlay = current.rows[0];

    const updatedLegs = (parlay.legs || []).map((leg) => {
      const live = statusMap.get(String(leg.id));

      if (!live) return leg;

      return {
        ...leg,
        status:
          leg.status === "td_scored"
            ? "td_scored"
            : live.status,
        touchdowns:
          leg.status === "td_scored"
            ? Math.max(
                Number(leg.touchdowns || 1),
                Number(live.touchdowns || 0)
              )
            : Number(live.touchdowns || 0)
      };
    });

    const updatedParlay = updateParlayResult({
      ...parlay,
      legs: updatedLegs
    });
if (
  parlay.status === "live" &&
  (updatedParlay.status === "won" || updatedParlay.status === "lost")
) {
  await settleParlay(updatedParlay);
}
    await pool.query(
  "UPDATE parlays SET status=$1, legs=$2, actual_payout=$3 WHERE id=$4",
  [
    updatedParlay.status,
    JSON.stringify(updatedLegs),
    updatedParlay.status === "won"
      ? Number(updatedParlay.potential_payout || 0)
      : 0,
    parlayId
  ]
);
  }
}

    res.json({ players: statuses });
  } catch (error) {
    console.error("Live status error:", error);
    res.status(500).json({
      error: "Unable to retrieve live NFL player status.",
    });
  }
});
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

  if (
    !Array.isArray(p.legs) ||
    !p.legs.length ||
    !Number.isFinite(Number(p.wager))
  ) {
    return res.status(400).json({
      error: "Parlay needs legs and wager"
    });
  }

  const historical = Boolean(p.historical);

  const parlay = {
    id: Date.now(),
    created_at: p.created_at || new Date().toISOString(),
    wager: Number(p.wager),
    potential_payout: Number(p.potential_payout || 0),
    actual_payout:
      historical && p.status === "won"
        ? Number(p.actual_payout || p.potential_payout || 0)
        : 0,
    status: historical ? (p.status || "won") : "live",
    promo_adjusted_payout: p.promo_adjusted_payout ?? null,
    source: p.source || "manual",
    historical,
    legs: historical
  ? p.legs.map(leg => ({
      ...leg,
      status: "td_scored",
      touchdowns: Math.max(Number(leg.touchdowns || 0), 1)
    }))
  : p.legs
  };

  if (pool) {
    const r = await pool.query(
      `INSERT INTO parlays(
        wager,
        potential_payout,
        actual_payout,
        status,
        promo_adjusted_payout,
        source,
        historical,
        legs
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        parlay.wager,
        parlay.potential_payout,
        parlay.actual_payout,
        parlay.status,
        parlay.promo_adjusted_payout,
        parlay.source,
        parlay.historical,
        JSON.stringify(parlay.legs)
      ]
    );

    const created = r.rows[0];

    // Historical parlays document past results.
    // They do NOT change the current bankroll.
    if (!created.historical) {
      const halfWager = -Number(created.wager) / 2;

      await pool.query(
        "INSERT INTO bankroll_transactions(person, amount, note) VALUES($1,$2,$3),($4,$5,$6)",
        [
          "mattP",
          halfWager,
          `Parlay #${created.id} wager`,
          "mattB",
          halfWager,
          `Parlay #${created.id} wager`
        ]
      );
    }

    return res.json(created);
  }

  memory.parlays.unshift(parlay);

  if (!parlay.historical) {
    memory.bankroll.mattP -= parlay.wager / 2;
    memory.bankroll.mattB -= parlay.wager / 2;

    memory.transactions.unshift(
      {
        id: Date.now(),
        person: "mattP",
        amount: -(parlay.wager / 2),
        note: `Parlay #${parlay.id} wager`,
        created_at: new Date().toISOString()
      },
      {
        id: Date.now() + 1,
        person: "mattB",
        amount: -(parlay.wager / 2),
        note: `Parlay #${parlay.id} wager`,
        created_at: new Date().toISOString()
      }
    );
  }

  res.json(parlay);
});
app.patch("/api/parlays/:id", async (req,res) => {
  const id = req.params.id;
  const { status, actual_payout, legs, created_at } = req.body;

  if (pool) {
    const current = await pool.query(
      "SELECT * FROM parlays WHERE id=$1",
      [id]
    );

    if (!current.rowCount) {
      return res.status(404).json({error:"Not found"});
    }

    const existing = current.rows[0];

    const updated = {
  ...existing,
  created_at: created_at ?? existing.created_at,
  status: status ?? existing.status,
      actual_payout:
        actual_payout !== undefined
          ? Number(actual_payout)
          : Number(existing.actual_payout || 0),
      legs: legs ?? existing.legs
    };

    if (
      existing.status === "live" &&
      (updated.status === "won" || updated.status === "lost")
    ) {
      await settleParlay(updated);
    }

    const r = await pool.query(
      "UPDATE parlays SET created_at=COALESCE($1,created_at), status=COALESCE($2,status), actual_payout=COALESCE($3,actual_payout), legs=COALESCE($4,legs) WHERE id=$5 RETURNING *",
     [
  created_at ?? null,
  status ?? null,
  actual_payout ?? null,
  legs ? JSON.stringify(legs) : null,
  id
]
    );

    return res.json(r.rows[0]);
  }

  const p = memory.parlays.find(
    x => String(x.id) === String(id)
  );

  if (!p) {
    return res.status(404).json({error:"Not found"});
  }

  const wasLive = p.status === "live";

  if (status) p.status = status;
  if (created_at) p.created_at = created_at;
  if (actual_payout !== undefined) {
    p.actual_payout = Number(actual_payout);
  }
  if (legs) p.legs = legs;

  if (
    wasLive &&
    (p.status === "won" || p.status === "lost")
  ) {
    const payout =
      p.status === "won"
        ? Number(p.actual_payout || 0)
        : 0;

    memory.bankroll.mattP += payout / 2;
    memory.bankroll.mattB += payout / 2;
  }

  res.json(p);
});
app.delete("/api/parlays/:id", async (req, res) => {
  const id = req.params.id;

  if (pool) {
    const r = await pool.query(
      "DELETE FROM parlays WHERE id=$1 RETURNING *",
      [id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ error: "Not found" });
    }

    const removed = r.rows[0];

    if (removed.status === "live") {
      await pool.query(
        "INSERT INTO bankroll_transactions(person, amount, note) VALUES ($1,$2,$3),($4,$5,$6)",
        [
          "mattP",
          Number(removed.wager) / 2,
          `Refund deleted parlay #${removed.id}`,
          "mattB",
          Number(removed.wager) / 2,
          `Refund deleted parlay #${removed.id}`
        ]
      );
    }

    return res.json(removed);
  }

  const index = memory.parlays.findIndex(
    x => String(x.id) === String(id)
  );

  if (index === -1) {
    return res.status(404).json({ error: "Not found" });
  }

  const [removed] = memory.parlays.splice(index, 1);

  if (removed.status === "live") {
    memory.bankroll.mattP += Number(removed.wager) / 2;
    memory.bankroll.mattB += Number(removed.wager) / 2;
  }

  res.json(removed);
});
app.post("/api/import/parse", (req,res) => {
  const text = String(req.body.text || "");

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  let wager = null;
  let potentialPayout = null;
  let players = [];

for (const line of lines) {
  const wagerMatch = line.match(
    /Wager:\s*\$?([\d,]+(?:\.\d{1,2})?)/i
  );

  if (wagerMatch) {
    wager = Number(
      wagerMatch[1].replace(/,/g, "")
    );
  }

  const payoutMatch = line.match(
    /(?:To Pay|Potential Payout):\s*\$?([\d,]+(?:\.\d{1,2})?)/i
  );

  if (payoutMatch) {
    potentialPayout = Number(
      payoutMatch[1].replace(/,/g, "")
    );
  }
}

  // DraftKings copied format:
  // Player One, Player Two, Player Three
  const playerLine = lines.find(line => {
    if (!line.includes(",")) return false;

    return !/^(wager|to pay|potential payout|stake|open|closed)/i.test(line);
  });

  if (playerLine) {
    players = playerLine
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);
  }

  // Keep support for the original pipe-separated format.
  if (!players.length) {
    for (const line of lines) {
      const parts = line
        .split("|")
        .map(x => x.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        const player = parts[0];

        if (
          /^(parlay|same game parlay|sgp|anytime td|touchdown|total|spread|moneyline|stake|payout|odds)$/i.test(
            player
          )
        ) {
          continue;
        }

        players.push(player);
      }
    }
  }

  const legs = players.map(player => ({
  id: crypto.randomUUID(),
  player,
  team: "",
  game: "",
  market: "Anytime TD",
  odds: "",
  status: "not_started",
  touchdowns: 0,
  promo: false
}));

  res.json({
    source: "draftkings_import",
    wager,
    potential_payout: potentialPayout,
    legs
  });
});
if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist));
  app.get("*splat", (_req,res) => res.sendFile(path.join(clientDist, "index.html")));
}

initDb().then(() => app.listen(process.env.PORT || 3000, () => {
  console.log(`Matt & Matt tracker running on ${process.env.PORT || 3000}`);
})).catch(err => { console.error(err); process.exit(1); });
