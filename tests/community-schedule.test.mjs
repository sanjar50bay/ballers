import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  followingWeek,
  localDate,
  readCommunityOperation,
  saveCommunityOperation,
} from "../lib/community-schedule.ts";
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
const plan = (
  op = id(50),
  date = "2099-01-09",
  community = c,
  source = id(10),
  venue = "Тестовое поле",
  capacity = null,
) =>
  val("SELECT ballers_schedule_community_game($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    community,
    op,
    source,
    date,
    "20:00",
    venue,
    5,
    2,
    capacity,
  ]);
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
  for (let n = 1; n <= 3; n++) {
    await db.query("INSERT INTO auth.users VALUES($1)", [u(n)]);
    await db.query(
      "INSERT INTO player_profiles(id,user_id,first_name,primary_position) VALUES($1,$2,$3,'MID')",
      [p(n), u(n), "Player " + n],
    );
  }
  for (const cid of [c, other]) {
    await db.query(
      "INSERT INTO communities(id,name,created_by) VALUES($1,'Community',$2)",
      [cid, u(1)],
    );
    await db.query(
      "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
      [cid, p(1)],
    );
  }
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MANAGER'),($1,$3,'MEMBER')",
    [c, p(2), p(3)],
  );
  await db.query(
    "INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,venue,format,team_count,capacity,created_by) VALUES($1,$2,1,'Source','2099-01-02','20:00','Тестовое поле',5,2,NULL,$3)",
    [id(10), c, u(1)],
  );
  await db.query(
    "INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES($1,$2,'GOING','MEMBER')",
    [id(10), p(1)],
  );
  let created;
  await test("explicit schedule creates one empty day and preserves unlimited capacity", async () => {
    await actor(1);
    created = await plan();
    assert.equal(created.created, true);
    const g = (
      await db.query("SELECT * FROM game_days WHERE id=$1", [created.id])
    ).rows[0];
    assert.equal(g.capacity, null);
    assert.equal(g.game_date.toISOString().slice(0, 10), "2099-01-09");
    assert.equal(
      await val(
        "SELECT count(*)::int FROM game_participants WHERE game_day_id=$1",
        [created.id],
      ),
      0,
    );
    assert.equal(
      await val(
        "SELECT count(*)::int FROM game_day_teams WHERE game_day_id=$1",
        [created.id],
      ),
      0,
    );
    assert.equal(
      await val(
        "SELECT count(*)::int FROM ballers_game_settings WHERE game_day_id=$1",
        [created.id],
      ),
      1,
    );
  });
  await test("five retries return the same receipt without extra days", async () => {
    for (let i = 0; i < 5; i++) assert.deepEqual(await plan(), created);
    assert.equal(
      await val("SELECT count(*)::int FROM game_days WHERE community_id=$1", [
        c,
      ]),
      2,
    );
  });
  await test("changed payload or another actor cannot reuse a receipt", async () => {
    await assert.rejects(
      () => plan(id(50), "2099-01-10"),
      /SCHEDULE_OPERATION_REUSE/,
    );
    await actor(2);
    await assert.rejects(() => plan(), /SCHEDULE_OPERATION_REUSE/);
    await actor(1);
  });
  await test("a second manager with a fresh operation gets the existing slot instead of another day", async () => {
    await actor(2);
    assert.deepEqual(await plan(id(51)), { id: created.id, created: false });
    await db.exec("RESET ROLE");
    assert.equal(
      await val("SELECT count(*)::int FROM ballers_community_game_operations"),
      1,
    );
    await actor(1);
  });
  await test("a member cannot create and an alien source is rejected transactionally", async () => {
    await actor(3);
    await assert.rejects(() => plan(id(52), "2099-01-10"), /MANAGER_REQUIRED/);
    await actor(1);
    await assert.rejects(
      () => plan(id(52), "2099-01-10", other),
      /INVALID_SCHEDULE_SOURCE/,
    );
    assert.equal(await val("SELECT count(*)::int FROM game_days"), 2);
  });
  await test("past date, blank venue, invalid capacity and null operation create nothing", async () => {
    await assert.rejects(
      () => plan(id(52), "2000-01-01"),
      /INVALID_SCHEDULE_DETAILS/,
    );
    await assert.rejects(
      () => plan(id(52), "2099-01-10", c, id(10), " "),
      /INVALID_SCHEDULE_DETAILS/,
    );
    await assert.rejects(
      () => plan(id(52), "2099-01-10", c, id(10), "Field", 0),
      /INVALID_SCHEDULE_DETAILS/,
    );
    await assert.rejects(
      () => plan(null, "2099-01-10"),
      /INVALID_SCHEDULE_OPERATION/,
    );
    assert.equal(await val("SELECT count(*)::int FROM game_days"), 2);
  });
  await test("receipt still resolves after source removal and rejects a demoted manager", async () => {
    await db.exec("RESET ROLE");
    await db.query("DELETE FROM game_days WHERE id=$1", [id(10)]);
    await actor(1);
    assert.deepEqual(await plan(), created);
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE community_members SET role='MEMBER' WHERE community_id=$1 AND player_id=$2",
      [c, p(1)],
    );
    await actor(1);
    await assert.rejects(() => plan(), /MANAGER_REQUIRED/);
  });
  await test("anonymous and direct receipt writes are forbidden", async () => {
    await actor(0);
    await assert.rejects(() => plan(), /permission denied/);
    await actor(2);
    await assert.rejects(
      () => db.query("DELETE FROM ballers_community_game_operations"),
      /permission denied/,
    );
  });
  await test("weekly suggestion preserves weekday across months and advances stale templates", () => {
    assert.equal(followingWeek("2026-12-28", "2026-12-01"), "2027-01-04");
    assert.equal(followingWeek("2026-11-02", "2026-11-18"), "2026-11-23");
    assert.equal(followingWeek("2024-02-22", "2024-02-01"), "2024-02-29");
    assert.equal(localDate(new Date(2026, 10, 18, 0, 1)), "2026-11-18");
  });
  await test("pending operation remains scoped to account and community when storage is unavailable", () => {
    const op = {
      id: id(60),
      draft: {
        source: null,
        date: "2099-01-09",
        time: "20:00",
        venue: "Field",
        format: 5,
        teams: 2,
        capacity: null,
      },
    };
    saveCommunityOperation(c, p(1), op);
    assert.deepEqual(readCommunityOperation(c, p(1)), op);
    assert.equal(readCommunityOperation(other, p(1)), null);
    assert.equal(readCommunityOperation(c, p(2)), null);
    saveCommunityOperation(c, p(1), null);
    assert.equal(readCommunityOperation(c, p(1)), null);
  });
  await test("repeat migration is blocked before partial changes", async () => {
    await db.exec("RESET ROLE");
    await assert.rejects(
      () =>
        db.exec(
          fs.readFileSync(
            "supabase/migrations/20261118_013_community_schedule.sql",
            "utf8",
          ),
        ),
      /013 already applied/,
    );
    await db.exec("ROLLBACK");
  });
  console.log(
    `RESULT: ${passed} community scheduling checks passed; isolated PostgreSQL, no live data.`,
  );
} finally {
  await db.close();
}
