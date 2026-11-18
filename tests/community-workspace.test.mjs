import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite(),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  u = (n) => id(1000 + n),
  p = (n) => id(2000 + n),
  c = id(1),
  other = id(2);
const val = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
async function actor(n) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    n ? u(n) : "",
  ]);
  await db.exec(n ? "SET ROLE authenticated" : "SET ROLE anon");
}
const workspace = (cid = c) =>
  val("SELECT ballers_community_workspace($1)", [cid]);
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
try {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;",
  );
  for (const f of [
    "supabase/test_project_baseline.sql",
    ...fs
      .readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => "supabase/migrations/" + f),
  ])
    await db.exec(fs.readFileSync(f, "utf8"));
  for (let n = 1; n <= 4; n++) {
    await db.query("INSERT INTO auth.users VALUES($1)", [u(n)]);
    await db.query(
      "INSERT INTO player_profiles(id,user_id,first_name,primary_position) VALUES($1,$2,$3,'MID')",
      [p(n), u(n), "Player " + n],
    );
  }
  for (const cid of [c, other]) {
    await db.query(
      "INSERT INTO communities(id,name,created_by) VALUES($1,'Test Community',$2)",
      [cid, u(1)],
    );
    await db.query(
      "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
      [cid, p(1)],
    );
  }
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MEMBER'),($1,$3,'MANAGER')",
    [c, p(2), p(3)],
  );
  const game = async (n, cid, date, status = "OPEN") =>
    db.query(
      "INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,format,team_count,capacity,status,created_by) VALUES($1,$2,$3,$4,$5,'20:00',5,2,10,$6,$7)",
      [id(100 + n), cid, n, "Day " + n, date, status, u(1)],
    );
  await game(1, c, "2099-01-02");
  await game(2, c, "2099-01-01", "COMPLETED");
  await game(3, other, "2099-01-03");
  await game(4, c, "2000-01-01");
  await db.query(
    "INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES($1,$2,'GOING','GUEST'),($1,$3,'INVITED','GUEST'),($1,$4,'INVITED','GUEST')",
    [id(101), p(1), p(2), p(4)],
  );
  await test("owner gets real counts and ordered public profile fields only", async () => {
    await actor(1);
    const s = await workspace();
    assert.equal(s.can_manage, true);
    assert.equal(s.member_count, 3);
    assert.equal(s.games.length, 3);
    assert.equal(s.games[0].id, id(101));
    assert.equal(s.games[0].going, 1);
    assert.equal(s.games[0].attendance_status, "GOING");
    assert.equal(s.members[0].role, "OWNER");
    assert.equal(s.members[1].role, "MANAGER");
    assert.equal(JSON.stringify(s.members).includes("user_id"), false);
  });
  await test("regular member sees games and personal answer without management", async () => {
    await actor(2);
    const s = await workspace();
    assert.equal(s.member, true);
    assert.equal(s.can_manage, false);
    assert.equal(s.games[0].attendance_status, "INVITED");
    assert.equal(s.members.length, 3);
  });
  await test("community manager keeps management authority", async () => {
    await actor(3);
    assert.equal((await workspace()).can_manage, true);
  });
  await test("a day invitation alone does not reveal the private community roster or calendar", async () => {
    await actor(4);
    assert.equal(
      await val("SELECT ballers_can_read_game($1)", [id(101)]),
      true,
    );
    const s = await workspace();
    assert.equal(s.member, false);
    assert.equal(s.can_manage, false);
    assert.deepEqual(s.members, []);
    assert.deepEqual(s.games, []);
  });
  await test("membership in one community gives no access to another", async () => {
    await actor(2);
    assert.deepEqual((await workspace(other)).games, []);
    assert.deepEqual((await workspace(other)).members, []);
  });
  await test("completed future and stale open days are history", async () => {
    await actor(1);
    const s = await workspace();
    assert.deepEqual(
      s.games.filter((g) => !g.upcoming).map((g) => g.id),
      [id(102), id(104)],
    );
  });
  await test("a paused match stays upcoming even after the calendar date has passed", async () => {
    await db.exec("RESET ROLE");
    await db.query(
      "INSERT INTO game_day_teams(id,game_day_id,name,color_key,sort_order) VALUES($1,$3,'A','RED',1),($2,$3,'B','BLUE',2)",
      [id(301), id(302), id(104)],
    );
    await db.query(
      "INSERT INTO ballers_matches(game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,status,duration_seconds,goal_limit,end_mode) VALUES($1,1,$2,$3,$4,$5,$4,'PAUSED',420,2,'TIME')",
      [id(104), id(301), id(302), p(1), p(2)],
    );
    await actor(1);
    const g = (await workspace()).games.find((g) => g.id === id(104));
    assert.equal(g.live, true);
    assert.equal(g.upcoming, true);
  });
  await test("role revocation and removal apply on the next read", async () => {
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE community_members SET role='MEMBER' WHERE community_id=$1 AND player_id=$2",
      [c, p(3)],
    );
    await actor(3);
    assert.equal((await workspace()).can_manage, false);
    await db.exec("RESET ROLE");
    await db.query(
      "DELETE FROM community_members WHERE community_id=$1 AND player_id=$2",
      [c, p(3)],
    );
    await actor(3);
    assert.deepEqual((await workspace()).games, []);
  });
  await test("calendar caps each period at 20 without mixing other communities", async () => {
    await db.exec("RESET ROLE");
    for (let n = 10; n < 35; n++) {
      await game(n, c, `2099-02-${String(n - 9).padStart(2, "0")}`);
      await game(n + 40, c, `2001-02-${String(n - 9).padStart(2, "0")}`);
    }
    await actor(1);
    const s = await workspace();
    assert.equal(s.games.filter((g) => g.upcoming).length, 20);
    assert.equal(s.games.filter((g) => !g.upcoming).length, 20);
    assert.equal(
      s.games.some((g) => g.id === id(103)),
      false,
    );
  });
  await test("anonymous and profile-less calls are rejected", async () => {
    await actor(0);
    await assert.rejects(() => workspace(), /permission denied/);
    await db.exec(
      "RESET ROLE;SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-999999999999',false);SET ROLE authenticated",
    );
    await assert.rejects(() => workspace(), /AUTH_REQUIRED/);
  });
  await test("repeat migration rolls back and unknown community is explicit", async () => {
    await actor(1);
    await assert.rejects(() => workspace(id(999)), /COMMUNITY_NOT_FOUND/);
    await db.exec("RESET ROLE");
    await assert.rejects(
      () =>
        db.exec(
          fs.readFileSync(
            "supabase/migrations/20261118_012_community_workspace.sql",
            "utf8",
          ),
        ),
      /012 already applied/,
    );
    await db.exec("ROLLBACK");
  });
  console.log(
    `RESULT: ${passed} community workspace SQL checks passed; isolated PostgreSQL, no live data.`,
  );
} finally {
  await db.close();
}
