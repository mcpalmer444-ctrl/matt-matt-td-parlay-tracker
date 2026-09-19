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
    .replace(/[.'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function gameStatus(event) {
  const status = event?.competitions?.[0]?.status?.type;

  if (!status) {
    return "not_started";
  }

  if (status.completed) {
    return "final";
  }

  if (status.state === "in") {
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

  const players = summary?.boxscore?.players || [];

  for (const teamGroup of players) {
    for (const statGroup of teamGroup?.statistics || []) {
      for (const athlete of statGroup?.athletes || []) {
        const name =
          athlete?.athlete?.displayName ||
          athlete?.athlete?.fullName ||
          athlete?.displayName ||
          "";

        if (!name) continue;

        const stats = athlete?.stats || [];

        let touchdowns = 0;

        for (const stat of stats) {
          const label = String(stat?.label || "").toLowerCase();
          const nameField = String(stat?.name || "").toLowerCase();

          if (
            label === "td" ||
            label === "touchdowns" ||
            nameField === "touchdowns" ||
            nameField === "td"
          ) {
            const parsed = Number(stat?.displayValue);

            if (Number.isFinite(parsed)) {
              touchdowns = Math.max(touchdowns, parsed);
            }
          }
        }

        const key = normalizeName(name);

        if (key) {
          results.set(key, {
            name,
            touchdowns,
          });
        }
      }
    }
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
        teamText.includes(String(player.team).toLowerCase());

      if (playerGame || playerTeam) {
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

    if (foundGame.status === "not_started") {
      statuses.push({
        ...player,
        status: "not_started",
        touchdowns: 0,
        gameId: foundGame.id,
      });

      continue;
    }

    if (foundGame.status === "final") {
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

module.exports = {
  getNFLScoreboard,
  getGameSummary,
  getNFLPlayerStatuses,
};
