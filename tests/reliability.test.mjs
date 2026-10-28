// Real isolated PostgreSQL/RLS + production browser. OAuth/HTTP transport simulated.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
const read = (p) =>
  fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
await db.exec(
  `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`,
);
for (const p of [
  "supabase/test_project_baseline.sql",
  ...fs
    .readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((x) => "supabase/migrations/" + x),
])
  await db.exec(read(p));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  uid = (n) => id(1000 + n),
  pid = (n) => id(2000 + n),
  c1 = id(1),
  c2 = id(2);
for (const [n, name, city] of [
  [1, "Sanzhar", "Astana"],
  [2, "Dana", "Astana"],
  [3, "Erzhan", "Astana"],
  [4, "Arsen", "Almaty"],
]) {
  await db.query("INSERT INTO auth.users VALUES($1)", [uid(n)]);
  await db.query(
    "INSERT INTO player_profiles(id,user_id,first_name,city,primary_position) VALUES($1,$2,$3,$4,'MID')",
    [pid(n), uid(n), name, city],
  );
}
for (const [id, name] of [
  [c1, "Saturday Football"],
  [c2, "Wednesday Football"],
]) {
  await db.query(
    "INSERT INTO communities(id,name,city,created_by) VALUES($1,$2,'Astana',$3)",
    [id, name, uid(3)],
  );
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
    [id, pid(3)],
  );
}

const g = id(20),
  hidden = id(21),
  c3 = id(22),
  team1 = id(500),
  team2 = id(501);
await db.query(
  "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MEMBER')",
  [c1, pid(1)],
);
await db.query(
  "INSERT INTO communities(id,name,city,created_by) VALUES($1,'Other Owner Community','Astana',$2)",
  [c3, uid(2)],
);
await db.query(
  "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
  [c3, pid(2)],
);
for (const [game, c] of [
  [g, c1],
  [hidden, c3],
])
  await db.query(
    "INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,format,team_count,capacity,created_by) VALUES($1,$2,1,$3,current_date+1,'20:00',5,2,1,$4)",
    [
      game,
      c,
      game === g ? "Wednesday Next" : "Private Day",
      game === g ? uid(3) : uid(2),
    ],
  );
await db.query(
  "INSERT INTO ballers_game_settings(game_day_id,is_open) VALUES($1,true)",
  [g],
);
for (const [n, t, name] of [
  [1, team1, "Own Team"],
  [2, team2, "Other Owner Team"],
]) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    uid(n),
  ]);
  await db.query("SELECT ballers_team_create($1,$2,'Astana')", [t, name]);
}
const value = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
async function actor(n) {
  await db.exec("RESET ROLE");
  await value("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    n ? uid(n) : "",
  ]);
  await db.exec(n ? "SET ROLE authenticated" : "SET ROLE anon");
}
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS " + name);
  } catch (e) {
    console.error("FAIL " + name, e.message, e.where);
    await db.close();
    process.exit(1);
  }
}
await actor(1);
await test("roles are scoped to the community, not a global account type", async () => {
  assert.equal(await value("SELECT ballers_is_manager($1)", [c1]), false);
  await actor(3);
  assert.equal(await value("SELECT ballers_is_manager($1)", [c1]), true);
  await actor(2);
  assert.equal(await value("SELECT ballers_is_manager($1)", [c3]), true);
  assert.equal(await value("SELECT ballers_is_manager($1)", [c1]), false);
  await actor(1);
});
await test("member cannot mutate another response, teams, settings, start or own role", async () => {
  for (const [sql, args] of [
    ["SELECT ballers_set_attendance($1,$2,'GOING')", [g, pid(3)]],
    ["SELECT ballers_team_action($1,0,'BUILD','{}')", [g]],
    ["SELECT ballers_game_action($1,'SETTINGS','{}')", [g]],
    ["SELECT ballers_start_match($1)", [g]],
  ])
    await assert.rejects(() => value(sql, args), /FORBIDDEN|MANAGER_REQUIRED/);
  await db.query(
    "UPDATE community_members SET role='OWNER' WHERE community_id=$1 AND player_id=$2",
    [c1, pid(1)],
  );
  assert.equal(await value("SELECT ballers_is_manager($1)", [c1]), false);
  await assert.rejects(
    () => value("SELECT ballers_add_test_players($1,1)", [c1]),
    /OWNER_REQUIRED/,
  );
});
await test("global directory shows teams and communities belonging to other creators", async () => {
  const teams = await value("SELECT ballers_directory('teams')"),
    communities = await value("SELECT ballers_directory('communities')");
  assert.ok(teams.items.some((t) => t.id === team1));
  assert.ok(teams.items.some((t) => t.id === team2));
  assert.equal(teams.total, 2);
  assert.ok(communities.items.some((c) => c.id === c3));
  assert.equal(communities.total, 3);
  assert.equal(teams.items[0].created_by, undefined);
});
await test("home includes unjoined community game but not unrelated private day", async () => {
  const h = await value("SELECT ballers_home()");
  assert.ok(h.games.some((x) => x.id === g && x.attendance_status === null));
  assert.ok(!h.games.some((x) => x.id === hidden));
});
await actor(2);
await test("pending guest application appears on home without being marked Going", async () => {
  await value("SELECT ballers_join_open_game($1)", [g]);
  const h = await value("SELECT ballers_home()"),
    game = h.games.find((x) => x.id === g);
  assert.equal(game.request_status, "PENDING");
  assert.equal(game.attendance_status, null);
  assert.equal(game.going, 0);
});
await actor(3);
const request2 = (await value("SELECT ballers_day_requests_feed($1)", [g]))
  .requests[0].id;
await test("accept fills last place once", async () => {
  await value("SELECT ballers_answer_day($1,true)", [request2]);
  await value("SELECT ballers_answer_day($1,true)", [request2]);
  assert.equal(
    await value(
      "SELECT count(1) FROM game_participants WHERE game_day_id=$1 AND attendance_status='GOING'",
      [g],
    ),
    1,
  );
});
await actor(1);
await value("SELECT ballers_set_attendance($1,$2,'GOING')", [g, pid(1)]);
await actor(3);
const request1 = (await value("SELECT ballers_day_requests_feed($1)", [g]))
  .requests[0].id;
await test("next accepted applicant is visibly reserved, not Going", async () => {
  await value("SELECT ballers_answer_day($1,true)", [request1]);
  await actor(1);
  const game = (await value("SELECT ballers_home()")).games.find(
    (x) => x.id === g,
  );
  assert.equal(game.queued, true);
  assert.equal(game.place_offered, false);
  assert.notEqual(game.attendance_status, "GOING");
});
await test("self cancellation offers the free place to reserve and notifies once", async () => {
  await actor(2);
  await value("SELECT ballers_set_attendance($1,$2,'DECLINED')", [g, pid(2)]);
  await actor(1);
  const game = (await value("SELECT ballers_home()")).games.find(
    (x) => x.id === g,
  );
  assert.equal(game.place_offered, true);
  assert.equal(game.queued, true);
  assert.notEqual(game.attendance_status, "GOING");
  const notices = (
    await value("SELECT ballers_notification_feed()")
  ).active.filter((n) => n.kind === "PLACE_OFFER");
  assert.equal(notices.length, 1);
});
await test("a later accepted applicant cannot take an offered place", async () => {
  await actor(4);
  await value("SELECT ballers_join_open_game($1)", [g]);
  await actor(3);
  const req = (
    await value("SELECT ballers_day_requests_feed($1)", [g])
  ).requests.find((x) => x.player_id === pid(4));
  await value("SELECT ballers_answer_day($1,true)", [req.id]);
  assert.equal(
    await value(
      "SELECT count(1) FROM game_participants WHERE game_day_id=$1 AND attendance_status='GOING'",
      [g],
    ),
    0,
  );
  await actor(4);
  assert.equal(
    (await value("SELECT ballers_home()")).games.find((x) => x.id === g).queued,
    true,
  );
});
await actor(1);
await test("reserve confirms deliberately, offer retires and duplicate response is safe", async () => {
  await value("SELECT ballers_set_attendance($1,$2,'GOING')", [g, pid(1)]);
  await value("SELECT ballers_set_attendance($1,$2,'GOING')", [g, pid(1)]);
  const game = (await value("SELECT ballers_home()")).games.find(
    (x) => x.id === g,
  );
  assert.equal(game.attendance_status, "GOING");
  assert.equal(game.queued, false);
  assert.equal(
    (await value("SELECT ballers_notification_feed()")).active.filter(
      (n) => n.kind === "PLACE_OFFER",
    ).length,
    0,
  );
  assert.equal(
    await value(
      "SELECT count(1) FROM game_participants WHERE game_day_id=$1 AND attendance_status='GOING'",
      [g],
    ),
    1,
  );
});
await actor(2);
await test("owning another community does not permit accepting this day requests", async () => {
  await assert.rejects(
    () => value("SELECT ballers_answer_day($1,false)", [request1]),
    /MANAGER_REQUIRED/,
  );
});
await actor(0);
await test("anonymous cannot read home or global directory", async () => {
  await assert.rejects(
    () => value("SELECT ballers_home()"),
    /permission denied|AUTH_REQUIRED/,
  );
  await assert.rejects(
    () => value("SELECT ballers_directory('teams')"),
    /permission denied|AUTH_REQUIRED/,
  );
});
await db.exec("RESET ROLE");
await test("007 repeat is blocked transactionally", async () => {
  await assert.rejects(
    () =>
      db.exec(
        fs.readFileSync(
          new URL(
            "../supabase/migrations/20261028_007_reliability.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    /007 already applied/,
  );
  await db.exec("ROLLBACK");
});
console.log(
  "RESULT: " +
    passed +
    " reliability checks passed; isolated PostgreSQL, no production access.",
);
await db.close();
