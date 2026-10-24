import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const read = (p) =>
  fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
await db.exec(
  `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`,
);
const migrations = [
  "supabase/test_project_baseline.sql",
  ...fs
    .readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((x) => "supabase/migrations/" + x),
];
for (const p of migrations) await db.exec(read(p));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = (n) => id(1000 + n),
  pid = (n) => id(2000 + n),
  tid = id(1),
  c1 = id(2),
  c2 = id(3);
let passed = 0;
const val = async (s, a = []) =>
  Object.values((await db.query(s, a)).rows[0])[0];
async function actor(n) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    n ? uid(n) : "",
  ]);
  await db.exec(n ? "SET ROLE authenticated" : "SET ROLE anon");
}
async function test(name, fn) {
  await fn();
  console.log("PASS " + name);
  passed++;
}
for (let n = 1; n <= 5; n++) {
  await db.query("INSERT INTO auth.users VALUES($1)", [uid(n)]);
  await db.query(
    "INSERT INTO player_profiles(id,user_id,first_name,city,primary_position) VALUES($1,$2,$3,$4,'MID')",
    [pid(n), uid(n), "Player " + n, n === 4 ? "Almaty" : "Астана"],
  );
}
await db.query(
  "INSERT INTO player_profiles(id,first_name,city,primary_position) VALUES($1,'TEST dummy','Astana','MID')",
  [pid(9)],
);
for (const c of [c1, c2]) {
  await db.query(
    "INSERT INTO communities(id,name,city,created_by) VALUES($1,$2,'Astana',$3)",
    [c, c === c1 ? "Saturday" : "Wednesday", uid(3)],
  );
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
    [c, pid(3)],
  );
}
await actor(1);
await test("directory normalizes city aliases, excludes synthetic profiles and whitelists fields", async () => {
  let d = await val("SELECT ballers_directory()");
  assert.equal(d.items.length, 5);
  assert.ok(!JSON.stringify(d).includes("user_id"));
  assert.ok(!JSON.stringify(d).includes("birth_year"));
  d = await val("SELECT ballers_directory('players','Astana')");
  assert.equal(d.items.length, 4);
  assert.equal(
    (
      await val("SELECT ballers_directory('players','','#'||$1)", [
        String(
          await val("SELECT baller_id FROM player_profiles WHERE id=$1", [
            pid(2),
          ]),
        ),
      ])
    ).items[0].id,
    pid(2),
  );
});
await test("create retry is idempotent and only creator becomes captain", async () => {
  await val("SELECT ballers_team_create($1,'Bars','Астана','Test')", [tid]);
  await val("SELECT ballers_team_create($1,'Bars','Астана','Test')", [tid]);
  const t = await val("SELECT ballers_team_detail($1)", [tid]);
  assert.equal(t.members.length, 1);
  assert.equal(t.members[0].role, "CAPTAIN");
  assert.equal(t.team.city, "Astana");
});
await test("invitation does not add players and duplicate send is safe", async () => {
  for (let i = 0; i < 2; i++)
    await val("SELECT ballers_club_action($1,'INVITE',$2)", [
      tid,
      [pid(2), pid(4)],
    ]);
  const t = await val("SELECT ballers_team_detail($1)", [tid]);
  assert.equal(t.members.length, 1);
  assert.equal(t.pending.length, 2);
});
await actor(5);
await test("outsider cannot invite, remove, approve requests, or link community", async () => {
  for (const a of ["INVITE", "REMOVE", "ANSWER_REQUEST", "LINK"])
    await assert.rejects(
      () =>
        val("SELECT ballers_club_action($1,$2,$3,$4)", [tid, a, [pid(2)], c1]),
      /CAPTAIN_REQUIRED/,
    );
});
await test("public team detail does not leak pending invitations", async () => {
  assert.deepEqual(
    (await val("SELECT ballers_team_detail($1)", [tid])).pending,
    [],
  );
});
await test("request requires captain confirmation", async () => {
  await val("SELECT ballers_club_action($1,'REQUEST')", [tid]);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).my_status,
    "REQUESTED",
  );
  await val("SELECT ballers_club_action($1,'ANSWER_INVITE')", [tid]);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).my_status,
    "REQUESTED",
  );
});
await actor(2);
await test("only intended recipient sees and accepts own invitation", async () => {
  const net = await val("SELECT ballers_network()");
  assert.equal(net.inbox[0].kind, "INVITE");
  await val("SELECT ballers_club_action($1,'ANSWER_INVITE')", [tid]);
  await val("SELECT ballers_club_action($1,'ANSWER_INVITE')", [tid]);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).my_status,
    "ACTIVE",
  );
  assert.equal((await val("SELECT ballers_network()")).inbox.length, 0);
});
await actor(1);
await test("captain approves request and requester role remains PLAYER", async () => {
  await val("SELECT ballers_club_action($1,'ANSWER_REQUEST',$2)", [
    tid,
    [pid(5)],
  ]);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).members.find(
      (x) => x.id === pid(5),
    ).role,
    "PLAYER",
  );
});
await test("captain cannot leave or remove their own captain seat", async () => {
  await assert.rejects(
    () => val("SELECT ballers_club_action($1,'LEAVE')", [tid]),
    /CAPTAIN_CANNOT_LEAVE/,
  );
  await val("SELECT ballers_club_action($1,'REMOVE',$2)", [tid, [pid(1)]]);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).members[0].id,
    pid(1),
  );
});
await test("community link requires independent manager confirmation", async () => {
  for (const c of [c1, c2])
    await val("SELECT ballers_club_action($1,'LINK','{}',$2)", [tid, c]);
  assert.equal(
    (await val("SELECT ballers_community_preview($1)", [c1])).teams.length,
    0,
  );
  await assert.rejects(
    () =>
      val("SELECT ballers_club_action($1,'ANSWER_LINK','{}',$2)", [tid, c1]),
    /MANAGER_REQUIRED/,
  );
});
await actor(3);
await test("one team joins multiple communities without duplicate team identity", async () => {
  assert.equal((await val("SELECT ballers_network()")).inbox.length, 2);
  for (const c of [c1, c2])
    await val("SELECT ballers_club_action($1,'ANSWER_LINK','{}',$2)", [tid, c]);
  for (const c of [c1, c2])
    assert.equal(
      (await val("SELECT ballers_community_preview($1)", [c])).teams[0].id,
      tid,
    );
});
await actor(2);
await test("move city preserves Baller ID, profile and team membership", async () => {
  const number = await val(
    "SELECT baller_id FROM player_profiles WHERE id=$1",
    [pid(2)],
  );
  await val("SELECT ballers_football_save('Алматы','LOOKING',true)");
  const p = await val("SELECT ballers_public_player($1)", [pid(2)]);
  assert.equal(p.city, "Almaty");
  assert.equal(p.baller_id, number);
  assert.equal(p.teams[0].id, tid);
  assert.equal(
    (await val("SELECT ballers_directory('players','Almaty','',0,true)"))
      .items[0].id,
    pid(2),
  );
});
await test("free status and game invitation preference remain independent of membership", async () => {
  await val("SELECT ballers_football_save('Павлодар','HAVE_TEAM',false)");
  const n = await val("SELECT ballers_network()");
  assert.equal(n.preferences.available, false);
  assert.equal(n.teams.length, 1);
  await val("SELECT ballers_club_action($1,'LEAVE')", [tid]);
  assert.equal((await val("SELECT ballers_network()")).teams.length, 0);
});
await actor(4);
await test("declining invitation has no membership and no stale inbox item", async () => {
  await val("SELECT ballers_club_action($1,'ANSWER_INVITE','{}',null,false)", [
    tid,
  ]);
  assert.equal((await val("SELECT ballers_network()")).inbox.length, 0);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).my_status,
    "DECLINED",
  );
});
await test("direct table writes and role escalation are denied", async () => {
  await assert.rejects(
    () =>
      db.query(
        "UPDATE ballers_team_people SET role='CAPTAIN' WHERE player_id=$1",
        [pid(4)],
      ),
    /permission denied/,
  );
});
await test("lost invitation acknowledgement can be retried without resurrecting a declined request", async () => {
  const op = id(900);
  await actor(1);
  await val("SELECT ballers_club_action($1,'INVITE',$2,null,true,$3)", [
    tid,
    [pid(4)],
    op,
  ]);
  await actor(4);
  await val("SELECT ballers_club_action($1,'ANSWER_INVITE','{}',null,false)", [
    tid,
  ]);
  await actor(1);
  await val("SELECT ballers_club_action($1,'INVITE',$2,null,true,$3)", [
    tid,
    [pid(4)],
    op,
  ]);
  assert.equal(
    (await val("SELECT ballers_team_detail($1)", [tid])).pending.some(
      (p) => p.id === pid(4),
    ),
    false,
  );
  await assert.rejects(
    () =>
      val("SELECT ballers_club_action($1,'REMOVE',$2,null,true,$3)", [
        tid,
        [pid(4)],
        op,
      ]),
    /OPERATION_ID_REUSE/,
  );
});
await actor(0);
await test("anonymous cannot discover profiles or mutate membership", async () => {
  for (const s of [
    "SELECT ballers_directory()",
    "SELECT ballers_network()",
    "SELECT ballers_team_detail($1)",
    "SELECT ballers_club_action($1,'REQUEST')",
  ])
    await assert.rejects(
      () => val(s, s.includes("$1") ? [tid] : []),
      /permission denied/,
    );
});
await db.exec("RESET ROLE");
await test("repeat migration is blocked transactionally", async () => {
  await assert.rejects(
    () => db.exec(read(migrations.at(-1))),
    /already applied/,
  );
  await db.exec("ROLLBACK");
  assert.equal(await val("SELECT count(*) FROM ballers_teams"), 1);
});
console.log(
  `RESULT: ${passed} directory/team SQL checks passed; isolated PostgreSQL, not live Supabase.`,
);
await db.close();
