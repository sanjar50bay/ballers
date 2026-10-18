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

// Seed the old schema as a prior release would have left it, BEFORE applying 004.
const ta = id(3001),
  tb = id(3002),
  m1 = id(4001),
  m2 = id(4002);
await db.query(
  "INSERT INTO game_day_teams(id,game_day_id,name,color_key,sort_order) VALUES($1,$3,'Blue','blue',0),($2,$3,'Red','red',1)",
  [ta, tb, game],
);
for (const [m, seq, status] of [
  [m1, 1, "VERIFIED"],
  [m2, 2, "PENDING"],
])
  await db.query(
    "INSERT INTO ballers_matches(id,game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,status,duration_seconds,goal_limit,end_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,420,2,'FIRST_REACHED')",
    [m, game, seq, ta, tb, pid(1), pid(6), status],
  );
for (const seq of [1, 2])
  for (const p of [pid(1), pid(6)])
    await db.query(
      "INSERT INTO ballers_notifications(player_id,game_day_id,kind,message) VALUES($1,$2,'CONFIRM',$3)",
      [p, game, "Подтвердите результат матча #" + seq],
    );
await db.query(
  "INSERT INTO ballers_notifications(player_id,game_day_id,kind,message) VALUES($1,$2,'CONFIRM','Подтвердите результат матча #2')",
  [pid(1), game],
);
await db.query("UPDATE ballers_matches SET confirmed_a=true WHERE id=$1", [m2]);
await db.exec(
  read("supabase/migrations/20261019_004_mobile_notifications.sql"),
);
assert.equal(
  Number(
    await scalar(
      "SELECT count(*) FROM ballers_notifications WHERE match_id=$1 AND completed_at IS NULL",
      [m1],
    ),
  ),
  0,
);
assert.equal(
  Number(
    await scalar(
      "SELECT count(*) FROM ballers_notifications WHERE match_id=$1 AND completed_at IS NULL",
      [m2],
    ),
  ),
  1,
);
assert.equal(
  Number(
    await scalar(
      "SELECT count(*) FROM ballers_notifications WHERE match_id IS NOT NULL",
    ),
  ),
  5,
);
console.log(
  "PASS 004 backfills legacy verified and partially confirmed results, preserving duplicate history",
);
await actor(6);
const f = await scalar("SELECT ballers_notification_feed()");
assert.equal(f.active.filter((n) => n.match_id === m2).length, 1);
assert.ok(f.active.every((n) => n.player_id === pid(6)));
console.log(
  "PASS legacy pending request remains actionable only for the correct captain",
);
await admin();
await assert.rejects(
  () =>
    db.exec(read("supabase/migrations/20261019_004_mobile_notifications.sql")),
  /already applied/,
);
await db.exec("ROLLBACK");
console.log("PASS repeat migration is blocked before partial schema changes");
await db.close();
