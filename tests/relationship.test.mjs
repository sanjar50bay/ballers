import assert from "node:assert/strict";
import fs from "node:fs";
const source = fs.readFileSync(
  new URL(
    "../app/communities/[id]/game-days/[gameId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const metadata = JSON.parse(
  fs.readFileSync(new URL("./schema-metadata.json", import.meta.url), "utf8"),
);
const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20261012_001_pre_match_safety.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.ok(
  metadata.constraints.some(
    (c) =>
      c.name === "game_day_team_players_team_id_fkey" &&
      c.definition.includes("REFERENCES game_day_teams(id)"),
  ),
);
assert.ok(migration.includes("CONSTRAINT ballers_assignment_same_game"));
assert.ok(
  source.includes("game_day_team_players!game_day_team_players_team_id_fkey ("),
);
assert.ok(!source.includes("        game_day_team_players ("));
assert.ok(source.includes("{teamsError ? ("));
assert.match(
  source,
  /JSON\.stringify\(\{\s*code: error\.code,\s*message: error\.message,\s*details: error\.details,\s*hint: error\.hint,?\s*\}\)/,
);
console.log(
  "PASS relationship regression: explicit FK hint and distinct load-error UI. Structural check, not a live PostgREST test.",
);
