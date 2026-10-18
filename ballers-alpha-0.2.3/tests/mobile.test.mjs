import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
await db.exec(
  `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`,
);
await db.exec(read("supabase/test_project_baseline.sql"));
await db.exec(read("supabase/migrations/20261012_001_pre_match_safety.sql"));
await db.exec(read("supabase/migrations/20261012_002_integrated_alpha.sql"));
await db.exec(
  read("supabase/migrations/20261013_003_navigation_community.sql"),
);
await db.exec(
  read("supabase/migrations/20261019_004_mobile_notifications.sql"),
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = (n) => id(1000 + n),
  pid = (n) => id(2000 + n);
const game = id(2),
  community = id(1);
async function scalar(sql, params = []) {
  const r = await db.query(sql, params);
  return Object.values(r.rows[0])[0];
}
async function admin() {
  await db.exec("RESET ROLE");
}
async function actor(n) {
  await admin();
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    uid(n),
  ]);
  await db.exec("SET ROLE authenticated");
}
await db.query(
  `INSERT INTO auth.users(id) SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid FROM generate_series(1,25)n`,
);
await db.query(
  `INSERT INTO player_profiles(id,user_id,first_name,primary_position) SELECT ('00000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'P'||n,'MID' FROM generate_series(1,25)n`,
);
await db.query(
  `INSERT INTO communities(id,name,city,created_by) VALUES($1,'Alpha','Astana',$2)`,
  [community, uid(1)],
);
await db.query(
  `INSERT INTO community_members(community_id,player_id,role) SELECT $1,id,CASE WHEN user_id=$2 THEN 'OWNER'::community_role ELSE 'MEMBER'::community_role END FROM player_profiles WHERE first_name IN(SELECT 'P'||n FROM generate_series(1,18)n)`,
  [community, uid(1)],
);
await db.query(
  `INSERT INTO game_days(id,community_id,sequence_number,title,game_date,format,team_count,capacity,created_by) VALUES($1,$2,1,'Alpha','2099-10-12',5,3,15,$3)`,
  [game, community, uid(1)],
);
await db.query(
  `INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) SELECT $1,id,'INVITED','MEMBER' FROM player_profiles WHERE first_name IN(SELECT 'P'||n FROM generate_series(1,18)n)`,
  [game],
);
let count = 0;
async function test(name, fn) {
  await fn();
  count++;
  console.log("PASS " + name);
}
const rpc = (name, args = []) =>
  scalar(
    "SELECT " + name + "(" + args.map((_, i) => "$" + (i + 1)).join(",") + ")",
    args,
  );
await actor(1);
await test("home isolates current profile", async () =>
  assert.equal((await rpc("ballers_home")).profile.id, pid(1)));
await test("invitation read does not imply attendance or completion", async () => {
  const n = (await rpc("ballers_notification_feed")).active[0];
  await rpc("ballers_mark_read", [n.id]);
  const f = await rpc("ballers_notification_feed");
  assert.ok(f.active.some((x) => x.id === n.id));
  assert.equal(f.unread, 0);
  assert.equal(
    await scalar(
      "SELECT attendance_status FROM game_participants WHERE player_id=$1",
      [pid(1)],
    ),
    "INVITED",
  );
});
for (let n = 1; n <= 15; n++)
  await rpc("ballers_set_attendance", [game, pid(n), "GOING"]);
await test("answer resolves the invitation", async () =>
  assert.equal(
    (await rpc("ballers_notification_feed")).active.filter(
      (n) => n.kind === "INVITE",
    ).length,
    0,
  ));
async function team(action, payload = {}) {
  return scalar(
    "SELECT ballers_team_action($1,(SELECT roster_version FROM game_days WHERE id=$1),$2,$3)",
    [game, action, JSON.stringify(payload)],
  );
}
const ga = (a, p = {}) =>
  rpc("ballers_game_action", [game, a, JSON.stringify(p)]);
await team("BUILD");
const teams = (
  await db.query(
    "SELECT id FROM game_day_teams WHERE game_day_id=$1 ORDER BY sort_order",
    [game],
  )
).rows.map((x) => x.id);
for (let n = 1; n <= 15; n++)
  await team("ASSIGN", {
    player_id: pid(n),
    team_id: teams[Math.floor((n - 1) / 5)],
  });
for (let n = 0; n < 3; n++)
  await ga("ROLES", {
    team_id: teams[n],
    captain_id: pid(1 + n * 5),
    responsible_id: pid(1 + n * 5),
  });
await test("failed auto start rolls pair back atomically", async () => {
  await assert.rejects(() => rpc("ballers_start_match", [game]), /правила/);
  assert.equal(
    await scalar("SELECT count(*) FROM ballers_sessions WHERE game_day_id=$1", [
      game,
    ]),
    0,
  );
});
await ga("SETTINGS", {
  duration_seconds: 420,
  goal_limit: 99,
  end_mode: "TIME_ONLY",
  is_open: false,
});
const match = await rpc("ballers_start_match", [game]);
async function ma(action, payload = {}, as = 1, m = match) {
  await actor(as);
  const version = await scalar(
    "SELECT version FROM ballers_matches WHERE id=$1",
    [m],
  );
  return rpc("ballers_match_action", [
    m,
    version,
    action,
    JSON.stringify(payload),
  ]);
}
await test("default pair and first draw rule saved with start", async () => {
  const s = await scalar(
    "SELECT to_jsonb(s) FROM ballers_sessions s WHERE game_day_id=$1",
    [game],
  );
  assert.equal(s.team_a, teams[0]);
  assert.equal(s.older_team, teams[0]);
});
await test("active match prevents closing day", () =>
  assert.rejects(() => ga("CLOSE"), /текущий матч/));
await ma("EVENT", { id: id(9001), kind: "GOAL", player_id: pid(1) });
await ma("FINISH");
await test("finish creates linked requests for both captains", async () => {
  await admin();
  assert.equal(
    await scalar(
      "SELECT count(*) FROM ballers_notifications WHERE match_id=$1 AND match_revision=1 AND completed_at IS NULL",
      [match],
    ),
    2,
  );
  await actor(1);
});
await ma("CONFIRM");
await test("own confirmation closes only own request", async () => {
  assert.equal(
    (await rpc("ballers_notification_feed")).active.filter(
      (n) => n.match_id === match,
    ).length,
    0,
  );
  await actor(6);
  assert.equal(
    (await rpc("ballers_notification_feed")).active.filter(
      (n) => n.match_id === match,
    ).length,
    1,
  );
});
await ma("CONFIRM", {}, 6);
await test("verified result resolves both, remains in history", async () => {
  await actor(6);
  const f = await rpc("ballers_notification_feed");
  assert.equal(f.active.filter((n) => n.match_id === match).length, 0);
  assert.equal(f.history.filter((n) => n.match_id === match).length, 1);
});
await ma("UNDO", { id: id(9001) });
await test("correction issues new revision without reopening old requests", async () => {
  const f = await rpc("ballers_notification_feed");
  assert.equal(f.active.filter((n) => n.match_id === match).length, 1);
  assert.equal(f.active.find((n) => n.match_id === match).match_revision, 2);
  assert.ok(
    f.history.some((n) => n.match_id === match && n.match_revision === 1),
  );
});
await test("personal RLS prevents reading another player requests", async () => {
  await actor(2);
  const f = await rpc("ballers_notification_feed");
  assert.ok(!f.active.some((n) => n.match_id === match));
  assert.ok(f.active.every((n) => n.player_id === pid(2)));
  await actor(1);
});
await ga("CLOSE");
await test("close day removes nearest game and preserves pending results", async () => {
  const h = await rpc("ballers_home");
  assert.ok(!h.games.some((g) => g.id === game));
  assert.ok(h.history.some((g) => g.id === game && g.match_count === 1));
  assert.equal(
    await scalar("SELECT status FROM ballers_matches WHERE id=$1", [match]),
    "PENDING",
  );
});
await test("closed day allows later captain confirmations", async () => {
  await ma("CONFIRM");
  await ma("CONFIRM", {}, 6);
  assert.equal(
    await scalar("SELECT status FROM ballers_matches WHERE id=$1", [match]),
    "VERIFIED",
  );
});
await actor(1);
await test("closed day cannot start another match", () =>
  assert.rejects(() => rpc("ballers_start_match", [game]), /GAME_NOT_OPEN/));
await test("ordinary member cannot start a match", async () => {
  await actor(2);
  await assert.rejects(
    () => rpc("ballers_start_match", [game]),
    /MANAGER_REQUIRED/,
  );
  await actor(1);
});
await test("outsider home reveals no community games", async () => {
  await actor(25);
  const h = await rpc("ballers_home");
  assert.equal(h.games.length, 0);
  assert.equal(h.history.length, 0);
  assert.equal(h.communities.length, 0);
});
await test("anonymous cannot call personal RPCs", async () => {
  await admin();
  await db.exec("SET ROLE anon");
  await assert.rejects(() => rpc("ballers_home"), /permission denied/);
  await assert.rejects(
    () => rpc("ballers_notification_feed"),
    /permission denied/,
  );
});
await admin();
await db.close();
console.log(`Mobile update: ${count} tests passed`);
