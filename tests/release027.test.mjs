import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { dayResults } from "../lib/day-results.ts";
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  u = (n) => id(1000 + n),
  p = (n) => id(2000 + n),
  c = id(1),
  g = id(2);
const val = async (s, a = []) =>
  Object.values((await db.query(s, a)).rows[0])[0];
let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log("PASS " + name);
    passed++;
  } catch (e) {
    console.error("FAIL " + name, e.message, e.where, e.internalQuery);
    await db.close();
    process.exit(1);
  }
};
await db.exec(
  "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;",
);
for (const path of [
  "supabase/test_project_baseline.sql",
  ...fs
    .readdirSync("supabase/migrations")
    .sort()
    .map((x) => "supabase/migrations/" + x),
]) {
  try {
    await db.exec(fs.readFileSync(path, "utf8"));
  } catch (e) {
    console.error("MIGRATION", path, e.message, e.position, e.internalQuery);
    process.exit(1);
  }
}
async function actor(n) {
  await db.exec("RESET ROLE");
  await val("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    n ? u(n) : "",
  ]);
  await db.exec(n ? "SET ROLE authenticated" : "SET ROLE anon");
}
for (let n = 1; n <= 55; n++) {
  await db.query("INSERT INTO auth.users VALUES($1)", [u(n)]);
  await db.query(
    "INSERT INTO player_profiles(id,user_id,first_name,city,primary_position) VALUES($1,$2,$3,$4,'MID')",
    [p(n), u(n), "Person " + n, n % 2 ? "Astana" : "Алматы"],
  );
}
await db.query(
  "INSERT INTO communities(id,name,city,created_by) VALUES($1,'Wednesday','Астана',$2)",
  [c, u(1)],
);
await db.query(
  "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER')",
  [c, p(1), p(2)],
);
await db.query(
  "INSERT INTO game_days(id,community_id,title,game_date,sequence_number,format,team_count,capacity,created_by) VALUES($1,$2,'Day',current_date+1,1,5,2,1,$3)",
  [g, c, u(1)],
);
await db.query(
  "INSERT INTO ballers_game_settings(game_day_id,is_open) VALUES($1,true)",
  [g],
);
await actor(2);
await test("default approval: member GOING becomes request, not participant or reserved place", async () => {
  await val("SELECT ballers_set_attendance($1,$2,'GOING')", [g, p(2)]);
  assert.equal(
    await val("SELECT count(1) FROM game_participants WHERE game_day_id=$1", [
      g,
    ]),
    0,
  );
  const f = await val("SELECT ballers_day_requests_feed($1)", [g]);
  assert.equal(f.requests[0].status, "PENDING");
});
await actor(3);
await test("open guest request is idempotent, and applicant sees only own requests", async () => {
  await val("SELECT ballers_join_open_game($1)", [g]);
  await val("SELECT ballers_join_open_game($1)", [g]);
  const f = await val("SELECT ballers_day_requests_feed($1)", [g]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].player_id, p(3));
});
await actor(1);
let feed = await val("SELECT ballers_day_requests_feed($1)", [g]),
  r2 = feed.requests.find((x) => x.player_id === p(2)).id,
  r3 = feed.requests.find((x) => x.player_id === p(3)).id;
await test("manager bell receives two actionable requests; reading does not hide controls", async () => {
  let f = await val("SELECT ballers_notification_feed()");
  assert.equal(f.active.filter((n) => n.kind === "JOIN_REQUEST").length, 2);
  const n = f.active.find((n) => n.request_id === r2);
  await val("SELECT ballers_mark_read($1)", [n.id]);
  f = await val("SELECT ballers_notification_feed()");
  assert.ok(f.active.some((x) => x.id === n.id && x.kind === "JOIN_REQUEST"));
});
await actor(4);
await test("outsider cannot approve, alter mode, or call private attendance bypass", async () => {
  await assert.rejects(
    () => val("SELECT ballers_answer_day($1,true)", [r2]),
    /MANAGER_REQUIRED/,
  );
  await assert.rejects(
    () => val("SELECT ballers_day_join_mode($1,'AUTO')", [g]),
    /MANAGER_REQUIRED/,
  );
  await assert.rejects(
    () => val("SELECT ballers_set_attendance_pre006($1,$2,'GOING')", [g, p(4)]),
    /permission denied/,
  );
});
await actor(1);
await test("approval admits player once; repeated answer is a no-op", async () => {
  await val("SELECT ballers_answer_day($1,true)", [r2]);
  await val("SELECT ballers_answer_day($1,true)", [r2]);
  assert.equal(
    await val(
      "SELECT count(1) FROM game_participants WHERE game_day_id=$1 AND attendance_status='GOING'",
      [g],
    ),
    1,
  );
});
await test("approval rechecks capacity and sends next player to queue", async () => {
  await val("SELECT ballers_answer_day($1,true)", [r3]);
  assert.equal(
    await val("SELECT count(1) FROM ballers_waitlist WHERE game_day_id=$1", [
      g,
    ]),
    1,
  );
  assert.equal(
    await val(
      "SELECT count(1) FROM game_participants WHERE game_day_id=$1 AND attendance_status='GOING'",
      [g],
    ),
    1,
  );
});
await actor(3);
await test("applicant receives a queued decision and cannot see other applicants", async () => {
  let f = await val("SELECT ballers_notification_feed()");
  assert.ok(
    f.active.some(
      (n) => n.kind === "JOIN_DECISION" && n.message.includes("очереди"),
    ),
  );
  assert.equal(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests.length,
    1,
  );
});
await actor(1);
await test("manager cancellation is distinct from self withdrawal and requires reapproval", async () => {
  await val("SELECT ballers_set_attendance($1,$2,'DECLINED')", [g, p(2)]);
  await actor(2);
  assert.ok(
    (await val("SELECT ballers_notification_feed()")).active.some((n) =>
      n.message.startsWith("Участие отменено организатором:"),
    ),
  );
  await val("SELECT ballers_set_attendance($1,$2,'GOING')", [g, p(2)]);
  assert.equal(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests[0].status,
    "PENDING",
  );
});
await test("pending request can be withdrawn without a phantom participant", async () => {
  await actor(5);
  await val("SELECT ballers_join_open_game($1)", [g]);
  await val("SELECT ballers_set_attendance($1,$2,'DECLINED')", [g, p(5)]);
  assert.equal(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests[0].status,
    "CANCELLED",
  );
});
await actor(1);
await test("AUTO is explicit; existing pending requests are not silently accepted", async () => {
  await val("SELECT ballers_day_join_mode($1,'AUTO')", [g]);
  await actor(6);
  await val("SELECT ballers_join_open_game($1)", [g]);
  assert.equal(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests.length,
    0,
  );
  await actor(1);
  assert.ok(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests.some(
      (r) => r.id === r2 && r.status === "PENDING",
    ),
  );
  await val("SELECT ballers_day_join_mode($1,'APPROVAL')", [g]);
});
await test("reject completes manager request notifications and tells applicant", async () => {
  await val("SELECT ballers_answer_day($1,false)", [r2]);
  await actor(2);
  assert.ok(
    (await val("SELECT ballers_notification_feed()")).active.some((n) =>
      n.message.startsWith("Заявка отклонена:"),
    ),
  );
});
await test("directory returns 55 real profiles across three disjoint pages", async () => {
  const pages = [];
  for (const off of [0, 24, 48])
    pages.push(
      await val("SELECT ballers_directory('players','','',$1)", [off]),
    );
  assert.deepEqual(
    pages.map((d) => d.items.length),
    [24, 24, 7],
  );
  assert.deepEqual(
    pages.map((d) => d.has_more),
    [true, true, false],
  );
  assert.equal(pages[0].total, 55);
  assert.equal(
    new Set(pages.flatMap((d) => d.items.map((p) => p.id))).size,
    55,
  );
  assert.equal(
    (await val("SELECT ballers_directory('players','Алматы')")).total,
    27,
  );
});
await actor(1);
await test("team/community counts and total are valid SQL and pagination is complete", async () => {
  for (let i = 1; i <= 26; i++)
    await val("SELECT ballers_team_create($1,$2,$3)", [
      id(3000 + i),
      "Club " + i,
      i % 2 ? "Astana" : "Almaty",
    ]);
  const a = await val("SELECT ballers_directory('teams')"),
    b = await val("SELECT ballers_directory('teams','','',24)");
  assert.equal(a.total, 26);
  assert.equal(b.items.length, 2);
  assert.equal(b.has_more, false);
  assert.equal(
    (await val("SELECT ballers_directory('communities','','wed')")).items[0].id,
    c,
  );
});
const team = id(3001);
await test("captain saves a board; version protects against lost updates", async () => {
  await val("SELECT ballers_tactics($1,$2,0)", [
    team,
    JSON.stringify([{ player_id: p(1), x: 50, y: 90 }]),
  ]);
  assert.equal((await val("SELECT ballers_tactics($1)", [team])).version, 1);
  await assert.rejects(
    () => val("SELECT ballers_tactics($1,$2,0)", [team, "[]"]),
    /BOARD_CHANGED/,
  );
});
await test("board validates confirmed membership, coordinates, duplicates and captain rights", async () => {
  for (const dots of [
    [{ player_id: p(2), x: 50, y: 50 }],
    [{ player_id: p(1), x: 150, y: 20 }],
    [
      { player_id: p(1), x: 50, y: 50 },
      { player_id: p(1), x: 30, y: 20 },
    ],
  ])
    await assert.rejects(
      () =>
        val("SELECT ballers_tactics($1,$2,1)", [team, JSON.stringify(dots)]),
      /INVALID_LAYOUT/,
    );
  await actor(2);
  await assert.rejects(
    () => val("SELECT ballers_tactics($1,$2,1)", [team, "[]"]),
    /CAPTAIN_REQUIRED/,
  );
  assert.equal(
    (await val("SELECT ballers_tactics($1)", [team])).layout.length,
    1,
  );
});
await actor(1);
await test("closing game cancels pending requests, not match confirmations", async () => {
  await actor(7);
  await val("SELECT ballers_join_open_game($1)", [g]);
  await actor(1);
  await db.exec("RESET ROLE");
  await db.query("UPDATE game_days SET status='COMPLETED' WHERE id=$1", [g]);
  await actor(1);
  assert.equal(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests.length,
    0,
  );
});
await test("standings count only confirmed selected type; scorer assists and own goals are correct", async () => {
  const teams = [
    { id: "a", name: "Blue" },
    { id: "b", name: "Red" },
  ];
  const matches = [
    {
      id: "m",
      sequence: 1,
      team_a: "a",
      team_b: "b",
      score_a: 2,
      score_b: 0,
      status: "VERIFIED",
      is_test: false,
    },
    {
      id: "pending",
      team_a: "a",
      team_b: "b",
      score_a: 9,
      score_b: 0,
      status: "PENDING",
      is_test: false,
    },
    {
      id: "test",
      team_a: "a",
      team_b: "b",
      score_a: 0,
      score_b: 5,
      status: "VERIFIED",
      is_test: true,
    },
  ];
  const event = (id, kind, extra = {}) => ({
    id,
    match_id: "m",
    kind,
    player_id: "one",
    assist_id: null,
    voided: false,
    elapsed_seconds: 0,
    ...extra,
  });
  const events = [
    event("g", "GOAL", { assist_id: "two" }),
    event("own", "OWN_GOAL"),
    event("void", "GOAL", { voided: true }),
    event("yellow", "YELLOW"),
    event("red", "RED"),
    event("save", "SAVE"),
    event("excluded", "GOAL", { match_id: "pending" }),
  ];
  let d = dayResults(matches, events, teams, [
    { match_id: "m", player_id: "one", team_id: "a" },
    { match_id: "m", player_id: "two", team_id: "a" },
  ]);
  assert.equal(d.table[0].points, 3);
  assert.equal(d.table[0].gf, 2);
  assert.equal(d.pending, 1);
  assert.equal(d.scorers.find((x) => x.id === "one").goals, 1);
  assert.equal(d.scorers.find((x) => x.id === "two").assists, 1);
  assert.equal(d.scorers.find((x) => x.id === "one").yellow, 1);
  assert.equal(d.scorers.find((x) => x.id === "one").saves, 1);
  assert.equal(dayResults(matches, events, teams, [], true).table[0].id, "b");
  matches[0].status = "PENDING";
  assert.equal(dayResults(matches, events, teams, []).confirmed, 0);
});
await test("yellow/red events use operator/version checks and undo does not change score", async () => {
  await db.exec("RESET ROLE");
  const ga = id(4100),
    gb = id(4101),
    m = id(4102);
  await db.query("UPDATE game_days SET status='OPEN' WHERE id=$1", [g]);
  await db.query(
    "INSERT INTO game_day_teams(id,game_day_id,name,color_key,sort_order) VALUES($1,$3,'Blue','BLUE',1),($2,$3,'Red','RED',2)",
    [ga, gb, g],
  );
  await db.query(
    "INSERT INTO ballers_matches(id,game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,duration_seconds,goal_limit,end_mode) VALUES($1,$2,1,$3,$4,$5,$6,$5,420,10,'GOALS_ONLY')",
    [m, g, ga, gb, p(1), p(2)],
  );
  await db.query(
    "INSERT INTO ballers_match_rosters(match_id,player_id,team_id) VALUES($1,$2,$4),($1,$3,$5)",
    [m, p(1), p(2), ga, gb],
  );
  await actor(1);
  const action = async (kind, event, player = p(1), assist = null) =>
    val(
      "SELECT ballers_match_action($1,(SELECT version FROM ballers_matches WHERE id=$1),'EVENT',$2)",
      [
        m,
        JSON.stringify({
          id: event,
          kind,
          player_id: player,
          assist_id: assist,
        }),
      ],
    );
  await action("YELLOW", id(4110));
  await action("RED", id(4111), p(2));
  assert.equal(
    await val("SELECT score_a+score_b FROM ballers_matches WHERE id=$1", [m]),
    0,
  );
  await action("RED", id(4111), p(2));
  assert.equal(
    await val("SELECT count(1) FROM ballers_match_events WHERE match_id=$1", [
      m,
    ]),
    2,
  );
  await assert.rejects(
    () => action("YELLOW", id(4112), p(1), p(2)),
    /ассистент/,
  );
  await assert.rejects(() => action("RED", id(4113), p(3)), /вне состава/);
  await actor(3);
  await assert.rejects(() => action("GOAL", id(4114)), /оператор/);
  await actor(1);
  await val(
    "SELECT ballers_match_action($1,(SELECT version FROM ballers_matches WHERE id=$1),'UNDO',$2)",
    [m, JSON.stringify({ id: id(4110) })],
  );
  assert.equal(
    await val("SELECT voided FROM ballers_match_events WHERE id=$1", [
      id(4110),
    ]),
    true,
  );
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE ballers_matches SET status='VERIFIED',running_since=NULL WHERE id=$1",
    [m],
  );
});
await test("trusted organizer invitation admits once without creating an approval request", async () => {
  const invite = id(4200);
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO invites(token,invite_type,community_id,game_day_id,created_by,max_uses) VALUES($1,'GAME_GUEST',$2,$3,$4,3)",
    [invite, c, g, u(1)],
  );
  await actor(8);
  assert.equal(await val("SELECT ballers_join_game_invite($1)", [invite]), g);
  assert.equal(await val("SELECT ballers_join_game_invite($1)", [invite]), g);
  assert.equal(
    (await val("SELECT ballers_day_requests_feed($1)", [g])).requests.length,
    0,
  );
  await db.exec("RESET ROLE");
  assert.equal(
    await val("SELECT uses_count FROM invites WHERE token=$1", [invite]),
    1,
  );
  await db.query("UPDATE game_days SET capacity=20 WHERE id=$1", [g]);
  await db.query("DELETE FROM ballers_waitlist WHERE game_day_id=$1", [g]);
  await db.query(
    "INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES($1,$2,'INVITED','MEMBER')",
    [g, p(9)],
  );
  await actor(9);
  await val("SELECT ballers_set_attendance($1,$2,'GOING')", [g, p(9)]);
  assert.equal(
    await val(
      "SELECT attendance_status FROM game_participants WHERE game_day_id=$1 AND player_id=$2",
      [g, p(9)],
    ),
    "GOING",
  );
});

await test("anonymous cannot read requests, change mode or save boards", async () => {
  await actor(0);
  for (const sql of [
    "SELECT ballers_day_requests_feed($1)",
    "SELECT ballers_day_join_mode($1,'AUTO')",
    "SELECT ballers_tactics($1)",
  ])
    await assert.rejects(
      () => val(sql, [g]),
      /permission denied|AUTH_REQUIRED/,
    );
});
await actor(1);
await test("006 repeat is blocked before any partial changes", async () => {
  await db.exec("RESET ROLE");
  await assert.rejects(
    () =>
      db.exec(
        fs.readFileSync(
          "supabase/migrations/20261027_006_day_results_requests.sql",
          "utf8",
        ),
      ),
    /006 already applied/,
  );
  await db.exec("ROLLBACK");
});
console.log(
  "RESULT: " +
    passed +
    " release 027 checks passed; isolated PostgreSQL, not live Supabase.",
);
await db.close();
