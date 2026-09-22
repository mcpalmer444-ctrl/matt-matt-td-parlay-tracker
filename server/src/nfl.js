const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ESPN request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeName(name = "") {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[.'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function gameStatus(event) {
  const status = event?.competitions?.[0]?.status?.type;

  if (!status) {
    return "not_started";
  }

  if (
    status.completed === true ||
    status.state === "post" ||
    status.name === "STATUS_FINAL"
  ) {
    return "final";
  }

  if (
    status.state === "in" ||
    status.name === "STATUS_IN_PROGRESS"
  ) {
    return "live";
  }

  return "not_started";
}
function gameTeams(event) {
  const competition = event?.competitions?.[0];

  return (competition?.competitors || []).map((team) => ({
    abbreviation: team?.team?.abbreviation || "",
    displayName: team?.team?.displayName || "",
  }));
}

async function getNFLScoreboard() {
  const data = await fetchJson(ESPN_SCOREBOARD);

  return (data.events || []).map((event) => ({
    id: String(event.id),
    name: event.name || "",
    shortName: event.shortName || "",
    date: event.date || null,
    status: gameStatus(event),
    teams: gameTeams(event),
  }));
}

async function getGameSummary(eventId) {
  return fetchJson(
    `${ESPN_SUMMARY}?event=${encodeURIComponent(eventId)}`
  );
}

function extractPlayerTouchdowns(summary) {
  const results = new Map();

  const scoringPlays = Array.isArray(summary?.scoringPlays)
    ? summary.scoringPlays
    : [];

  for (const play of scoringPlays) {
    const type = String(play?.type?.text || "").toLowerCase();
    const text = String(play?.text || "");

    if (!type.includes("touchdown")) {
      continue;
    }

    let scorer = "";

    if (type.includes("passing touchdown")) {
  const match = text.match(/^(.+?)\s+\d+\s+Yd\s+pass from/i);

  if (match) {
    scorer = match[1].trim();
  }
} else if (type.includes("rushing touchdown")) {
      const match = text.match(/^(.+?)\s+\d+\s+Yd\s+Rush/i);

      if (match) {
        scorer = match[1].trim();
      }
    } else {
      const match = text.match(/^(.+?)\s+\d+\s+Yd\s+/i);

      if (match) {
        scorer = match[1].trim();
      }
    }

    if (!scorer) {
      continue;
    }

    const key = normalizeName(scorer);
    const existing = results.get(key);

    results.set(key, {
      name: scorer,
      touchdowns: (existing?.touchdowns || 0) + 1,
    });
  }

  return results;
}

async function getNFLPlayerStatuses(players) {
  const scoreboard = await getNFLScoreboard();

  const wanted = players.map((player) => ({
    ...player,
    normalizedName: normalizeName(player.name),
  }));

  const statuses = [];

  for (const player of wanted) {
    let foundGame = null;
    let touchdowns = 0;

    for (const game of scoreboard) {
      const gameText = `${game.name} ${game.shortName}`.toLowerCase();
      const teamText = game.teams
        .map((team) => `${team.abbreviation} ${team.displayName}`)
        .join(" ")
        .toLowerCase();

      const playerGame =
        player.game &&
        gameText.includes(String(player.game).toLowerCase());

      const playerTeam =
  player.team &&
  game.teams.some(
    (team) =>
      String(team.abbreviation || "").toLowerCase() ===
      String(player.team).toLowerCase()
  );

if (playerTeam || playerGame) {
  foundGame = game;
  break;
}
    }

    if (!foundGame) {
      statuses.push({
        ...player,
        status: "not_started",
        touchdowns: 0,
      });

      continue;
    }

    const gameState = String(
  foundGame.status ||
  foundGame.rawStatus ||
  ""
).toLowerCase();

const gameCompleted =
  gameState === "final" ||
  gameState === "post" ||
  gameState === "completed";

if (gameCompleted) {
  const summary = await getGameSummary(foundGame.id);
  const touchdownMap = extractPlayerTouchdowns(summary);

  touchdowns =
    touchdownMap.get(player.normalizedName)?.touchdowns || 0;

  statuses.push({
    ...player,
    status: touchdowns > 0 ? "td_scored" : "failed",
    touchdowns,
    gameId: foundGame.id,
  });

  continue;
}

if (foundGame.status === "not_started") {
      const summary = await getGameSummary(foundGame.id);
      const touchdownMap = extractPlayerTouchdowns(summary);

      touchdowns =
        touchdownMap.get(player.normalizedName)?.touchdowns || 0;

      statuses.push({
        ...player,
        status: touchdowns > 0 ? "td_scored" : "failed",
        touchdowns,
        gameId: foundGame.id,
      });

      continue;
    }

    const summary = await getGameSummary(foundGame.id);
    const touchdownMap = extractPlayerTouchdowns(summary);

    touchdowns =
      touchdownMap.get(player.normalizedName)?.touchdowns || 0;

    statuses.push({
      ...player,
      status: touchdowns > 0 ? "td_scored" : "live",
      touchdowns,
      gameId: foundGame.id,
    });
  }

  return statuses;
}

export {
  getNFLScoreboard,
  getGameSummary,
  getNFLPlayerStatuses,
};
