import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = (n) => id(1000 + n),
  pid = (n) => id(2000 + n),
  team = id(10),
  otherTeam = id(11),
  c1 = id(1),
  c2 = id(2);
const scalar = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
async function actor(n) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    n ? uid(n) : "",
  ]);
  await db.exec(n ? "SET ROLE authenticated" : "SET ROLE anon");
}
const calendar = () => scalar("SELECT ballers_team_calendar($1)", [team]);
const plan = (
  op = id(100),
  community = c1,
  date = "2099-01-01",
  venue = "Тестовая площадка",
  t = team,
) =>
  scalar("SELECT ballers_schedule_team_game($1,$2,$3,$4,$5,$6)", [
    t,
    op,
    community,
    date,
    "20:00",
    venue,
  ]);
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log("PASS " + name);
};
try {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;",
  );
  for (const file of [
    "supabase/test_project_baseline.sql",
    ...fs
      .readdirSync("supabase/migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort()
      .map((p) => "supabase/migrations/" + p),
  ])
    await db.exec(fs.readFileSync(file, "utf8"));
  for (let n = 1; n <= 4; n++) {
    await db.query("INSERT INTO auth.users VALUES($1)", [uid(n)]);
    await db.query(
      "INSERT INTO player_profiles(id,user_id,first_name,city,primary_position) VALUES($1,$2,$3,'Astana','MID')",
      [pid(n), uid(n), "Person " + n],
    );
  }
  for (const [c, n] of [
    [c1, 1],
    [c2, 3],
  ]) {
    await db.query(
      "INSERT INTO communities(id,name,city,created_by) VALUES($1,$2,'Astana',$3)",
      [c, "Community " + n, uid(n)],
    );
    await db.query(
      "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
      [c, pid(n)],
    );
  }
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MANAGER')",
    [c1, pid(2)],
  );
  await actor(1);
  await scalar("SELECT ballers_team_create($1,'Test Team','Astana','')", [
    team,
  ]);
  await scalar("SELECT ballers_team_create($1,'Another Team','Astana','')", [
    otherTeam,
  ]);
  await scalar("SELECT ballers_club_action($1,'INVITE',$2)", [
    team,
    [pid(2), pid(3)],
  ]);
  await actor(2);
  await scalar("SELECT ballers_club_action($1,'ANSWER_INVITE')", [team]);
  await test("captain sees only communities they manage, without needing a prior team link", async () => {
    await actor(1);
    const s = await calendar();
    assert.equal(s.can_plan, true);
    assert.deepEqual(
      s.communities.map((c) => c.id),
      [c1],
    );
    assert.equal(s.communities[0].linked, false);
    assert.deepEqual(s.games, []);
  });
  await test("community manager who is not the captain cannot schedule for the team", async () => {
    await actor(2);
    await assert.rejects(() => plan(), /CAPTAIN_REQUIRED/);
    const s = await calendar();
    assert.equal(s.can_plan, false);
    assert.deepEqual(s.communities, []);
  });
  await test("captain cannot use another organizers community", async () => {
    await actor(1);
    await assert.rejects(() => plan(id(101), c2), /MANAGER_REQUIRED/);
  });
  let game;
  await test("scheduling atomically links the team, creates a day and invites only confirmed members", async () => {
    await actor(1);
    game = await plan();
    await db.exec("RESET ROLE");
    const rows = (
      await db.query(
        "SELECT player_id,attendance_status,participant_type FROM game_participants WHERE game_day_id=$1 ORDER BY player_id",
        [game],
      )
    ).rows;
    assert.deepEqual(
      rows.map((x) => x.player_id),
      [pid(1), pid(2)],
    );
    assert.ok(
      rows.every(
        (x) =>
          x.attendance_status === "INVITED" && x.participant_type === "GUEST",
      ),
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::int FROM ballers_notifications WHERE game_day_id=$1",
        [game],
      ),
      2,
    );
    assert.equal(
      await scalar(
        "SELECT status FROM ballers_team_communities WHERE team_id=$1 AND community_id=$2",
        [team, c1],
      ),
      "ACTIVE",
    );
    assert.equal(
      await scalar(
        "SELECT duration_seconds FROM ballers_game_settings WHERE game_day_id=$1",
        [game],
      ),
      420,
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::int FROM community_members WHERE community_id=$1",
        [c1],
      ),
      2,
    );
  });
  await test("a committed response can be retried without another game or invitation", async () => {
    await actor(1);
    const ids = await Promise.all(Array.from({ length: 5 }, () => plan()));
    assert.ok(ids.every((x) => x === game));
    await db.exec("RESET ROLE");
    assert.equal(
      await scalar("SELECT count(*)::int FROM ballers_team_games"),
      1,
    );
    assert.equal(
      await scalar(
        "SELECT count(*)::int FROM ballers_notifications WHERE game_day_id=$1",
        [game],
      ),
      2,
    );
  });
  await test("operation reuse with changed details or team is rejected", async () => {
    await actor(1);
    await assert.rejects(
      () => plan(id(100), c1, "2099-01-01", "Другой адрес"),
      /SCHEDULE_OPERATION_REUSE/,
    );
    await assert.rejects(
      () => plan(id(100), c1, "2099-01-01", "Тестовая площадка", otherTeam),
      /SCHEDULE_OPERATION_REUSE/,
    );
  });
  await test("invalid details leave no partial team link or game", async () => {
    await actor(1);
    await assert.rejects(
      () => plan(id(102), c1, "2000-01-01", "Адрес", otherTeam),
      /INVALID_SCHEDULE_DETAILS/,
    );
    await assert.rejects(
      () => plan(id(102), c1, "2099-01-01", " ", otherTeam),
      /INVALID_SCHEDULE_DETAILS/,
    );
    await db.exec("RESET ROLE");
    assert.equal(
      await scalar(
        "SELECT count(*)::int FROM ballers_team_communities WHERE team_id=$1",
        [otherTeam],
      ),
      0,
    );
    assert.equal(
      await scalar("SELECT count(*)::int FROM ballers_team_games"),
      1,
    );
  });
  await test("calendar exposes linked days, per-game invitation and confirmed count", async () => {
    await actor(2);
    const s = await calendar();
    assert.equal(s.games.length, 1);
    assert.equal(s.games[0].id, game);
    assert.equal(s.games[0].attendance_status, "INVITED");
    assert.equal(s.games[0].going, 0);
    assert.equal(s.games[0].invited, 2);
    await scalar("SELECT ballers_set_attendance($1,$2,'GOING')", [
      game,
      pid(2),
    ]);
    assert.equal((await calendar()).games[0].going, 1);
  });
  await test("other community days never become team games by inference", async () => {
    await actor(1);
    await scalar(
      "SELECT ballers_create_game_day($1,'2099-01-02','20:00','Other',5,3,15)",
      [c1],
    );
    assert.equal((await calendar()).games.length, 1);
  });
  await test("pending and unrelated users cannot inspect the private calendar or receipts", async () => {
    for (const n of [3, 4]) {
      await actor(n);
      assert.deepEqual((await calendar()).games, []);
      await assert.rejects(
        () => db.query("SELECT * FROM ballers_team_games"),
        /permission denied/,
      );
    }
  });
  await test("team membership alone does not reveal a day to a later joiner without a game invitation", async () => {
    await actor(3);
    await scalar("SELECT ballers_club_action($1,'ANSWER_INVITE')", [team]);
    assert.deepEqual((await calendar()).games, []);
  });
  await test("removal hides the team calendar while preserving an existing personal game invitation", async () => {
    await actor(1);
    await scalar("SELECT ballers_club_action($1,'REMOVE',$2)", [
      team,
      [pid(2)],
    ]);
    await actor(2);
    assert.deepEqual((await calendar()).games, []);
    assert.equal(
      await scalar("SELECT ballers_can_read_game($1)", [game]),
      true,
    );
  });
  await test("retrying a receipt does not recreate a declined community link", async () => {
    await actor(1);
    await scalar("SELECT ballers_club_action($1,'UNLINK','{}',$2)", [team, c1]);
    assert.equal(await plan(), game);
    await db.exec("RESET ROLE");
    assert.equal(
      await scalar(
        "SELECT status FROM ballers_team_communities WHERE team_id=$1 AND community_id=$2",
        [team, c1],
      ),
      "DECLINED",
    );
  });
  await test("explicit new scheduling invites the current roster and re-links with both authorities", async () => {
    await actor(1);
    await plan(id(103), c1, "2099-01-03");
    const s = await calendar();
    assert.equal(s.games.length, 2);
    assert.equal(s.communities[0].linked, true);
    assert.equal(s.games[1].invited, 2);
  });
  await test("closed days appear in history instead of upcoming games", async () => {
    await db.exec("RESET ROLE");
    await db.query("UPDATE game_days SET status='COMPLETED' WHERE id=$1", [
      game,
    ]);
    await actor(1);
    assert.equal(
      (await calendar()).games.find((g) => g.id === game).upcoming,
      false,
    );
  });
  await test("anonymous execution and direct writes remain forbidden", async () => {
    await actor(0);
    await assert.rejects(() => calendar(), /permission denied/);
    await assert.rejects(() => plan(), /permission denied/);
    await actor(1);
    await assert.rejects(
      () => db.query("DELETE FROM ballers_team_games"),
      /permission denied/,
    );
  });
  await test("migration repeat is rejected transactionally", async () => {
    await db.exec("RESET ROLE");
    await assert.rejects(
      () =>
        db.exec(
          fs.readFileSync(
            "supabase/migrations/20261118_011_team_calendar.sql",
            "utf8",
          ),
        ),
      /011 already applied/,
    );
    await db.exec("ROLLBACK");
  });
  console.log(
    `RESULT: ${passed} team calendar SQL checks passed; isolated PostgreSQL, no live data.`,
  );
} finally {
  await db.close();
}
