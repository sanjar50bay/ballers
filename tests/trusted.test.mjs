import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  init,
  id,
  pid,
  day,
  actor,
  scalar,
  start,
  act,
} from "./trusted-fixture.mjs";
import { dayResults } from "../lib/day-results.ts";
const db = new PGlite();
let passed = 0;
const test = async (name, fn) => {
  await fn();
  console.log("PASS " + name);
  passed++;
};
const stats = () => scalar(db, "SELECT ballers_player_stats($1)", [pid(1)]);
try {
  await init(db, true);
  const old = await day(db, 100);
  const oldMatch = await start(db, old.g);
  await act(db, oldMatch, "FINISH");
  await actor(db, 1);
  await start(db, old.g);
  await db.exec("RESET ROLE");
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/20261029_008_trusted_results.sql",
      "utf8",
    ),
  );
  await test("migration preserves old pending/live policies and scores without automatic acceptance", async () => {
    const rows = (
      await db.query(
        "SELECT status,result_mode FROM ballers_matches ORDER BY sequence",
      )
    ).rows;
    assert.deepEqual(rows, [
      { status: "PENDING", result_mode: "CAPTAINS" },
      { status: "LIVE", result_mode: "CAPTAINS" },
    ]);
  });
  const { g, teams } = await day(db, 200);
  const m = await start(db, g);
  await test("new match snapshots trusted default and resting-team operator", async () => {
    assert.equal(
      await scalar(db, "SELECT result_mode FROM ballers_matches WHERE id=$1", [
        m,
      ]),
      "TRUSTED",
    );
    assert.equal(
      await scalar(db, "SELECT operator_id FROM ballers_matches WHERE id=$1", [
        m,
      ]),
      pid(3),
    );
  });
  await test("member and outsider cannot change policy or finish the match", async () => {
    await actor(db, 2);
    await assert.rejects(
      () => db.query("SELECT ballers_result_mode($1,'CAPTAINS')", [g]),
      /MANAGER_REQUIRED/,
    );
    await assert.rejects(() => act(db, m, "FINISH", {}, 2), /FINISH_FORBIDDEN/);
    await assert.rejects(() => act(db, m, "FINISH", {}, 4), /FORBIDDEN/);
  });
  await act(db, m, "EVENT", { id: id(9001), kind: "GOAL", player_id: pid(1) });
  await test("live goals stay out of final career stats until match completion", async () =>
    assert.equal((await stats()).goals, 0));
  await test("manual finish counts standings and scorer immediately without captain flags or confirmation requests", async () => {
    await act(db, m, "FINISH");
    const s = await scalar(db, "SELECT ballers_alpha_snapshot($1)", [g]);
    assert.equal(s.matches[0].status, "VERIFIED");
    assert.equal(s.matches[0].confirmed_a, false);
    assert.equal(s.matches[0].confirmed_b, false);
    assert.equal((await stats()).goals, 1);
    assert.equal(
      dayResults(s.matches, s.events, s.teams, s.rosters).table.find(
        (x) => x.id === teams[0],
      ).points,
      3,
    );
    await db.exec("RESET ROLE");
    assert.equal(
      await scalar(
        db,
        "SELECT count(1) FROM ballers_notifications WHERE match_id=$1 AND kind='CONFIRM'",
        [m],
      ),
      0,
    );
  });
  await test("duplicate finish is rejected without another rotation", async () => {
    await actor(db, 1);
    const before = await scalar(
      db,
      "SELECT row_to_json(s) FROM ballers_sessions s WHERE game_day_id=$1",
      [g],
    );
    await assert.rejects(() => act(db, m, "FINISH"), /FINISH_FORBIDDEN/);
    await actor(db, 1);
    assert.deepEqual(
      await scalar(
        db,
        "SELECT row_to_json(s) FROM ballers_sessions s WHERE game_day_id=$1",
        [g],
      ),
      before,
    );
  });
  await test("only organizer can correct completed trusted match, with meaningful reason", async () => {
    await assert.rejects(
      () => act(db, m, "UNDO", { id: id(9001), reason: "Wrong scorer" }, 3),
      /CORRECTION_MANAGER_REASON_REQUIRED/,
    );
    await assert.rejects(
      () => act(db, m, "UNDO", { id: id(9001), reason: "  " }, 1),
      /CORRECTION_MANAGER_REASON_REQUIRED/,
    );
    await assert.rejects(
      () =>
        act(
          db,
          m,
          "CORRECT_EVENT",
          { id: id(9002), kind: "GOAL", player_id: pid(1), reason: "Checked" },
          2,
        ),
      /CORRECTION_MANAGER_REASON_REQUIRED/,
    );
  });
  await test("undo preserves accounted status, recalculates stats and records author/reason without confirmation spam", async () => {
    await act(
      db,
      m,
      "UNDO",
      { id: id(9001), reason: "Wrong goal recorded" },
      1,
    );
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [m]),
      "VERIFIED",
    );
    assert.equal((await stats()).goals, 0);
    const history = await scalar(db, "SELECT ballers_match_history($1)", [m]);
    assert.equal(history[0].action, "UNDO");
    assert.equal(history[0].reason, "Wrong goal recorded");
    assert.equal(history[0].actor, "Organizer");
  });
  await test("correction adds missed goal with dedupe and no double counting or rotation rewrite", async () => {
    const payload = {
      id: id(9002),
      kind: "GOAL",
      player_id: pid(1),
      reason: "Missed goal checked",
    };
    await actor(db, 1);
    const before = await scalar(
      db,
      "SELECT row_to_json(s) FROM ballers_sessions s WHERE game_day_id=$1",
      [g],
    );
    await act(db, m, "CORRECT_EVENT", payload, 1);
    await act(db, m, "CORRECT_EVENT", payload, 1, 0);
    assert.equal((await stats()).goals, 1);
    assert.deepEqual(
      await scalar(
        db,
        "SELECT row_to_json(s) FROM ballers_sessions s WHERE game_day_id=$1",
        [g],
      ),
      before,
    );
    await assert.rejects(
      () =>
        act(
          db,
          m,
          "CORRECT_EVENT",
          { ...payload, id: id(9003), player_id: pid(3) },
          1,
        ),
      /вне состава/,
    );
  });
  await test("correction stale version and ordinary direct table writes are blocked", async () => {
    await assert.rejects(
      () =>
        act(db, m, "UNDO", { id: id(9002), reason: "Outdated click" }, 1, 0),
      /Матч изменился/,
    );
    await actor(db, 2);
    await assert.rejects(
      () =>
        db.query("UPDATE ballers_matches SET status='VERIFIED' WHERE id=$1", [
          m,
        ]),
      /permission denied/,
    );
  });
  await test("goal-limit completion auto-accounts and repeated event does not rotate twice", async () => {
    await actor(db, 1);
    const m2 = await start(db, g);
    const s = await scalar(db, "SELECT ballers_alpha_snapshot($1)", [g]);
    const scorer = s.rosters.find(
      (x) => x.match_id === m2 && x.team_id === s.matches[0].team_a,
    ).player_id;
    await act(
      db,
      m2,
      "EVENT",
      { id: id(9010), kind: "GOAL", player_id: scorer },
      1,
    );
    const p = { id: id(9011), kind: "GOAL", player_id: scorer };
    await act(db, m2, "EVENT", p, 1);
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [m2]),
      "VERIFIED",
    );
    await act(db, m2, "EVENT", p, 1, 0);
    assert.equal(
      await scalar(
        db,
        "SELECT count(1) FROM ballers_match_events WHERE id=$1",
        [id(9011)],
      ),
      1,
    );
  });
  await test("strict mode still requires both captains; mode changes never alter existing snapshots", async () => {
    const strict = await day(db, 300);
    await db.query("SELECT ballers_result_mode($1,'CAPTAINS')", [strict.g]);
    const sm = await start(db, strict.g);
    await db.query("SELECT ballers_result_mode($1,'TRUSTED')", [strict.g]);
    await act(db, sm, "FINISH");
    assert.equal(
      await scalar(db, "SELECT result_mode FROM ballers_matches WHERE id=$1", [
        sm,
      ]),
      "CAPTAINS",
    );
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [sm]),
      "PENDING",
    );
    await act(db, sm, "CONFIRM", {}, 1);
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [sm]),
      "PENDING",
    );
    await act(db, sm, "CONFIRM", {}, 2);
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [sm]),
      "VERIFIED",
    );
  });
  await test("strict rule edits preserve policy and undo still resets captain confirmations", async () => {
    const strict = await day(db, 500);
    await db.query("SELECT ballers_result_mode($1,'CAPTAINS')", [strict.g]);
    await db.query("SELECT ballers_game_action($1,'SETTINGS',$2)", [
      strict.g,
      JSON.stringify({
        duration_seconds: 420,
        goal_limit: 2,
        end_mode: "FIRST_REACHED",
        max_streak: null,
        is_open: false,
      }),
    ]);
    const sm = await start(db, strict.g);
    await act(db, sm, "EVENT", {
      id: id(9050),
      kind: "GOAL",
      player_id: pid(1),
    });
    await act(db, sm, "FINISH");
    await act(db, sm, "CONFIRM", {}, 1);
    await act(db, sm, "CONFIRM", {}, 2);
    await act(db, sm, "UNDO", { id: id(9050) }, 1);
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [sm]),
      "PENDING",
    );
    assert.equal(
      await scalar(
        db,
        "SELECT confirmed_a OR confirmed_b FROM ballers_matches WHERE id=$1",
        [sm],
      ),
      false,
    );
  });
  await test("time-limit completion accounts immediately without changing clock protections", async () => {
    const timed = await day(db, 600);
    await db.query("SELECT ballers_game_action($1,'SETTINGS',$2)", [
      timed.g,
      JSON.stringify({
        duration_seconds: 30,
        goal_limit: 99,
        end_mode: "TIME_ONLY",
        max_streak: null,
        is_open: false,
      }),
    ]);
    const tm = await start(db, timed.g);
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE ballers_matches SET running_since=now()-interval '31 seconds' WHERE id=$1",
      [tm],
    );
    await assert.rejects(
      () =>
        act(db, tm, "EVENT", { id: id(9060), kind: "GOAL", player_id: pid(1) }),
      /Время вышло/,
    );
    await act(db, tm, "FINISH");
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [tm]),
      "VERIFIED",
    );
  });
  await test("old pending result can be accepted explicitly only by organizer with a reason", async () => {
    await assert.rejects(
      () =>
        act(
          db,
          oldMatch,
          "ACCEPT_TRUSTED",
          { reason: "Reviewed old match" },
          2,
        ),
      /CORRECTION_MANAGER_REASON_REQUIRED/,
    );
    await act(
      db,
      oldMatch,
      "ACCEPT_TRUSTED",
      { reason: "Organizer reviewed result" },
      1,
    );
    assert.equal(
      await scalar(db, "SELECT status FROM ballers_matches WHERE id=$1", [
        oldMatch,
      ]),
      "VERIFIED",
    );
    assert.equal(
      await scalar(db, "SELECT result_mode FROM ballers_matches WHERE id=$1", [
        oldMatch,
      ]),
      "TRUSTED",
    );
  });
  await test("test matches remain isolated from real career and real standings", async () => {
    const td = await day(db, 400);
    await actor(db, 1);
    const tm = await start(db, td.g);
    await db.exec("RESET ROLE");
    await db.query("UPDATE ballers_matches SET is_test=true WHERE id=$1", [tm]);
    await actor(db, 1);
    const before = (await stats()).goals;
    await act(
      db,
      tm,
      "EVENT",
      { id: id(9020), kind: "GOAL", player_id: pid(1) },
      1,
    );
    await act(db, tm, "FINISH", {}, 1);
    assert.equal((await stats()).goals, before);
    assert.equal((await stats()).test_goals, 1);
    const s = await scalar(db, "SELECT ballers_alpha_snapshot($1)", [td.g]);
    assert.equal(
      dayResults(s.matches, s.events, s.teams, s.rosters).confirmed,
      0,
    );
    assert.equal(
      dayResults(s.matches, s.events, s.teams, s.rosters, true).confirmed,
      1,
    );
  });
  await test("history is readable by game viewers, not outsiders or anonymous callers", async () => {
    await actor(db, 2);
    assert.ok(
      (await scalar(db, "SELECT ballers_match_history($1)", [m])).length > 0,
    );
    await actor(db, 4);
    await assert.rejects(
      () => scalar(db, "SELECT ballers_match_history($1)", [m]),
      /FORBIDDEN/,
    );
    await actor(db, 0);
    await assert.rejects(
      () => scalar(db, "SELECT ballers_match_history($1)", [m]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("SELECT ballers_result_mode($1,'TRUSTED')", [g]),
      /permission denied/,
    );
  });
  await test("migration repeat is rejected transactionally", async () => {
    await db.exec("RESET ROLE");
    await assert.rejects(
      () =>
        db.exec(
          fs.readFileSync(
            "supabase/migrations/20261029_008_trusted_results.sql",
            "utf8",
          ),
        ),
      /008 already applied/,
    );
    await db.exec("ROLLBACK");
  });
  console.log(
    `RESULT: ${passed} trusted-result SQL checks passed; isolated PostgreSQL, no live database access.`,
  );
} catch (e) {
  console.error("FAIL", e.message, e.where || "", e.internalQuery || "");
  process.exitCode = 1;
} finally {
  await db.close();
}
