import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { init, day, actor, scalar, pid } from "./trusted-fixture.mjs";
const db = new PGlite();
let passed = 0;
const pass = (name) => {
  passed++;
  console.log("PASS " + name);
};
try {
  await init(db);
  const games = [];
  for (let n = 1; n <= 7; n++) games.push(await day(db, 10000 + n * 10));
  await db.exec("RESET ROLE");
  for (const name of fs
    .readdirSync("supabase/migrations")
    .filter((n) => Number(n.match(/_(\d+)_/)?.[1]) >= 9)
    .sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + name, "utf8"));
  await db.exec("UPDATE ballers_game_settings SET is_open=true");
  await db.query(
    "UPDATE ballers_game_settings SET is_open=false WHERE game_day_id=$1",
    [games[1].g],
  );
  await db.query("UPDATE game_days SET status='COMPLETED' WHERE id=$1", [
    games[2].g,
  ]);
  await db.query("UPDATE game_days SET game_date='2000-01-01' WHERE id=$1", [
    games[3].g,
  ]);
  await db.query("DELETE FROM ballers_game_settings WHERE game_day_id=$1", [
    games[4].g,
  ]);
  await db.query(
    "INSERT INTO ballers_matches(game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,duration_seconds,goal_limit,end_mode,is_test,status) VALUES($1,1,$2,$3,$4,$5,$4,420,2,'FIRST_REACHED',true,'VERIFIED')",
    [games[5].g, games[5].teams[0], games[5].teams[1], pid(1), pid(2)],
  );
  await db.query(
    "INSERT INTO player_profiles(id,first_name,primary_position) VALUES($1,'BALLERS_TEST_01','MID')",
    [pid(999)],
  );
  await db.query(
    "INSERT INTO game_participants(game_day_id,player_id,attendance_status) VALUES($1,$2,'GOING')",
    [games[6].g, pid(999)],
  );
  await actor(db, null);
  const cards = await scalar(db, "SELECT ballers_public_open_games()");
  assert.deepEqual(
    cards.map((g) => g.id),
    [games[0].g],
  );
  pass(
    "anonymous catalogue excludes private, closed, past, unconfigured and fixture/test games",
  );
  assert.deepEqual(
    Object.keys(cards[0]).sort(),
    [
      "id",
      "title",
      "city",
      "game_date",
      "start_time",
      "venue",
      "format",
      "capacity",
      "join_mode",
      "going",
    ].sort(),
  );
  assert.equal(cards[0].going, 3);
  pass(
    "public cards contain attendance counts but no player, owner, contact or community identifiers",
  );
  assert.equal(
    (await scalar(db, "SELECT ballers_public_open_games('Астана')")).length,
    1,
  );
  assert.deepEqual(
    await scalar(db, "SELECT ballers_public_open_games('Almaty')"),
    [],
  );
  assert.deepEqual(
    await scalar(db, "SELECT ballers_public_open_games(NULL,24,$1)", [
      games[1].g,
    ]),
    [],
  );
  assert.equal(
    (
      await scalar(db, "SELECT ballers_public_open_games(NULL,24,$1)", [
        games[0].g,
      ])
    )[0].id,
    games[0].g,
  );
  pass(
    "city aliases and a selected game are filtered on the server without disclosing a private game",
  );
  await assert.rejects(
    () => scalar(db, "SELECT ballers_join_open_game($1)", [games[0].g]),
    /permission denied/,
  );
  await assert.rejects(
    () => scalar(db, "SELECT ballers_open_games()"),
    /permission denied/,
  );
  pass(
    "public read permission grants neither joining nor the authenticated catalogue",
  );
  await db.exec("RESET ROLE");
  assert.equal(
    await scalar(db, "SELECT count(*)::int FROM community_members"),
    3,
  );
  for (let n = 0; n < 105; n++) {
    await db
      .query(
        "INSERT INTO game_days(community_id,sequence_number,title,game_date,format,team_count,capacity,created_by) SELECT community_id,$2,'Public extra','2099-12-02',format,team_count,capacity,created_by FROM game_days WHERE id=$1 RETURNING id",
        [games[0].g, 20000 + n],
      )
      .then(async (r) =>
        db.query(
          "INSERT INTO ballers_game_settings(game_day_id,is_open) VALUES($1,true)",
          [r.rows[0].id],
        ),
      );
  }
  await actor(db, null);
  assert.equal(
    (await scalar(db, "SELECT ballers_public_open_games(NULL,3)")).length,
    3,
  );
  assert.equal(
    (await scalar(db, "SELECT ballers_public_open_games(NULL,9999)")).length,
    100,
  );
  assert.equal(
    (await scalar(db, "SELECT ballers_public_open_games(NULL,-1)")).length,
    1,
  );
  assert.equal(
    (await scalar(db, "SELECT ballers_public_open_games(NULL,NULL)")).length,
    24,
  );
  pass(
    "public reads are bounded even with a malicious or missing limit and do not enroll visitors",
  );
  await actor(db, 1);
  assert.equal(
    (await scalar(db, "SELECT ballers_public_open_games(NULL,3)")).length,
    3,
  );
  assert.ok((await scalar(db, "SELECT ballers_open_games()")).length > 3);
  pass(
    "authenticated users retain their existing catalogue while sharing the safe public preview",
  );
  console.log(
    `RESULT: ${passed} public catalogue SQL checks passed; isolated PostgreSQL, no live data.`,
  );
} finally {
  await db.close();
}
