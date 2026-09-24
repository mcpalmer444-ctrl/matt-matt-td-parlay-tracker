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
  const dates = [];

  for (let i = -7; i <= 7; i++) {
  const date = new Date();
  date.setDate(date.getDate() + i);

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    dates.push(`${year}${month}${day}`);
  }

  const responses = await Promise.all(
    dates.map((date) =>
      fetchJson(`${ESPN_SCOREBOARD}?dates=${date}`)
    )
  );

  const events = responses.flatMap(
    (data) => data.events || []
  );

  const uniqueEvents = [
    ...new Map(
      events.map((event) => [String(event.id), event])
    ).values()
  ];

  return uniqueEvents.map((event) => ({
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
    const matchingGames = [];

    for (const game of scoreboard) {
      const gameText =
        `${game.name || ""} ${game.shortName || ""}`.toLowerCase();

      const playerGame =
        player.game &&
        gameText.includes(String(player.game).toLowerCase());

      const playerTeam =
        player.team &&
        game.teams.some((team) => {
          const espnTeam =
            String(team.abbreviation || "").toLowerCase();

          const playerTeamCode =
            String(player.team).toLowerCase();

          const aliases = {
            was: "wsh",
            wsh: "wsh",
          };

          return (
            espnTeam ===
            (aliases[playerTeamCode] || playerTeamCode)
          );
        });

      if (playerTeam || playerGame) {
        matchingGames.push(game);
      }
    }

    if (!matchingGames.length) {
      statuses.push({
        ...player,
        status: "not_started",
        touchdowns: 0,
      });

      continue;
    }

    // Pick the correct game:
    // 1. Live
    // 2. Upcoming
    // 3. Most recent completed game

    const liveGame = matchingGames.find(
      (game) => game.status === "live"
    );

    const upcomingGames = matchingGames
      .filter((game) => game.status === "not_started")
      .sort(
        (a, b) =>
          new Date(a.date || 0) -
          new Date(b.date || 0)
      );

    const completedGames = matchingGames
      .filter((game) => game.status === "final")
      .sort(
        (a, b) =>
          new Date(b.date || 0) -
          new Date(a.date || 0)
      );

    let foundGame = null;

    if (liveGame) {
      foundGame = liveGame;
    } else if (upcomingGames.length) {
      foundGame = upcomingGames[0];
    } else if (completedGames.length) {
      foundGame = completedGames[0];
    }

    if (!foundGame) {
      statuses.push({
        ...player,
        status: "not_started",
        touchdowns: 0,
      });

      continue;
    }

    // Upcoming game
    if (foundGame.status === "not_started") {
      statuses.push({
        ...player,
        status: "not_started",
        touchdowns: 0,
        gameId: foundGame.id,
      });

      continue;
    }

    // Live or final game
    const summary = await getGameSummary(foundGame.id);
    const touchdownMap =
      extractPlayerTouchdowns(summary);

    const touchdowns =
      touchdownMap.get(player.normalizedName)?.touchdowns || 0;

    // Final game
    if (foundGame.status === "final") {
      statuses.push({
        ...player,
        status:
          touchdowns > 0
            ? "td_scored"
            : "failed",
        touchdowns,
        gameId: foundGame.id,
      });

      continue;
    }

    // Live game
    statuses.push({
      ...player,
      status:
        touchdowns > 0
          ? "td_scored"
          : "live",
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
