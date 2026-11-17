import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
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
const db = new PGlite();
let passed = 0;
const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20261117_009_game_leader.sql",
    import.meta.url,
  ),
  "utf8",
);
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log("PASS " + name);
};
const control = (g) => scalar(db, "SELECT ballers_game_control($1)", [g]);
const assign = (g, p, v, reason = null) =>
  scalar(db, "SELECT ballers_set_game_leader($1,$2,$3,$4)", [g, p, v, reason]);
const launch = (g, op, seq, version) =>
  scalar(db, "SELECT ballers_start_game_match($1,$2,$3,$4)", [
    g,
    op,
    seq,
    version,
  ]);
const count = async (g) => {
  await db.exec("RESET ROLE");
  return scalar(
    db,
    "SELECT count(*)::int FROM ballers_matches WHERE game_day_id=$1",
    [g],
  );
};
try {
  await init(db);
  const old = await day(db, 100);
  const oldMatch = await start(db, old.g);
  await db.exec("RESET ROLE");
  await db.exec(migration);
  await actor(db, 1);
  await test("installation preserves legacy controls until explicit activation", async () => {
    await act(db, oldMatch, "PAUSE", {}, 1);
    await act(db, oldMatch, "RESUME", {}, 1);
  });
  await test("unactivated installation still supports an old-client start and finish", async () => {
    const staged = await day(db, 300);
    const match = await start(db, staged.g);
    await act(db, match, "FINISH");
  });
  await test("explicit assignment enables one test day without changing other days", async () => {
    const pilot = await day(db, 400);
    await assign(pilot.g, pid(3), 0);
    assert.equal((await control(pilot.g)).required, true);
    assert.equal((await control(old.g)).required, false);
    await assert.rejects(() => start(db, pilot.g), /START_REQUIRES_OPERATION/);
  });
  await db.exec("RESET ROLE");
  await db.exec(
    fs.readFileSync(
      new URL("../supabase/activate_009_game_leader.sql", import.meta.url),
      "utf8",
    ),
  );
  await actor(db, 3);
  await test("upgrade preserves an existing live operator, scores and result policy", async () => {
    assert.equal((await control(old.g)).leader_id, pid(3));
    assert.equal(
      await scalar(db, "SELECT operator_id FROM ballers_matches WHERE id=$1", [
        oldMatch,
      ]),
      pid(3),
    );
  });
  await test("manager has no implicit live controls", async () => {
    await assert.rejects(
      () => act(db, oldMatch, "PAUSE", {}, 1),
      /LEADER_REQUIRED/,
    );
  });
  await test("leader can pause, resume and transfer to an attending real player", async () => {
    await act(db, oldMatch, "PAUSE");
    await act(db, oldMatch, "RESUME");
    await actor(db, 3);
    const c = await assign(old.g, pid(2), 1);
    assert.equal(c.leader_id, pid(2));
    assert.equal(c.version, 2);
    assert.equal(c.history[0].action, "TRANSFER");
  });
  await test("previous leader and stale devices lose live write authority", async () => {
    await assert.rejects(
      () => act(db, oldMatch, "FINISH", {}, 3),
      /LEADER_REQUIRED/,
    );
    await actor(db, 2);
    await assert.rejects(() => assign(old.g, pid(3), 1), /LEADER_CHANGED/);
  });
  await test("organizer recovery requires a reason, updates operator and records actor", async () => {
    await actor(db, 1);
    await assert.rejects(
      () => assign(old.g, pid(1), 2),
      /LEADER_RECOVERY_REASON_REQUIRED/,
    );
    const c = await assign(old.g, pid(1), 2, "Телефон ведущего недоступен");
    assert.equal(c.history[0].action, "RECOVER");
    assert.equal(c.history[0].reason, "Телефон ведущего недоступен");
    assert.equal(c.history[0].actor_name, "Organizer");
    assert.equal(
      await scalar(db, "SELECT operator_id FROM ballers_matches WHERE id=$1", [
        oldMatch,
      ]),
      pid(1),
    );
    await act(db, oldMatch, "FINISH", {}, 1);
  });
  const d = await day(db, 200);
  await test("new day has no implicit leader and cannot start without assignment", async () => {
    assert.equal((await control(d.g)).leader_id, null);
    await assert.rejects(() => launch(d.g, id(500), 0, 0), /LEADER_REQUIRED/);
  });
  await test("only a manager can make the initial choice; outsider is not eligible", async () => {
    await actor(db, 2);
    await assert.rejects(
      () => assign(d.g, pid(2), 0),
      /LEADER_TRANSFER_FORBIDDEN/,
    );
    await actor(db, 1);
    await assert.rejects(
      () => assign(d.g, pid(4), 0),
      /LEADER_MUST_PARTICIPATE/,
    );
    const c = await assign(d.g, pid(3), 0);
    assert.equal(c.leader_id, pid(3));
    assert.equal(c.version, 1);
  });
  await test("ordinary assigned leader can start despite having no manager role", async () => {
    await actor(db, 3);
    const m = await launch(d.g, id(501), 0, 1);
    assert.ok(m);
    assert.equal(
      await scalar(db, "SELECT operator_id FROM ballers_matches WHERE id=$1", [
        m,
      ]),
      pid(3),
    );
  });
  let m;
  await test("five competing starts for the same observed sequence return one match", async () => {
    await actor(db, 3);
    const results = [];
    for (let i = 0; i < 5; i++)
      results.push(await launch(d.g, id(510 + i), 0, 1));
    assert.equal(new Set(results).size, 1);
    m = results[0];
    assert.equal(await count(d.g), 1);
  });
  await test("other players and organizer cannot start through another client", async () => {
    for (const n of [1, 2]) {
      await actor(db, n);
      await assert.rejects(
        () => launch(d.g, id(520 + n), 0, 1),
        /LEADER_REQUIRED/,
      );
    }
  });
  await test("legacy RPC entry points and private implementations cannot bypass operation checks", async () => {
    await actor(db, 1);
    await assert.rejects(
      () => scalar(db, "SELECT ballers_game_action($1,'START')", [d.g]),
      /START_REQUIRES_OPERATION/,
    );
    await assert.rejects(() => start(db, d.g), /START_REQUIRES_OPERATION/);
    await assert.rejects(
      () => scalar(db, "SELECT ballers_game_action_pre009($1,'START')", [d.g]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        scalar(db, "SELECT ballers_match_action_pre009($1,0,'FINISH')", [m]),
      /permission denied/,
    );
  });
  await test("stale event versions from two devices cannot both mutate the match", async () => {
    await actor(db, 3);
    const v = await scalar(
      db,
      "SELECT version FROM ballers_matches WHERE id=$1",
      [m],
    );
    await act(db, m, "PAUSE", {}, 3, v);
    await assert.rejects(
      () => act(db, m, "FINISH", {}, 3, v),
      /Матч изменился/,
    );
    await act(db, m, "RESUME");
  });
  await test("leader goal retry is deduplicated and non-leading managers cannot add events", async () => {
    await actor(db, 3);
    const version = await scalar(
      db,
      "SELECT version FROM ballers_matches WHERE id=$1",
      [m],
    );
    const event = { id: id(9800), kind: "GOAL", player_id: pid(1) };
    await act(db, m, "EVENT", event, 3, version);
    await act(db, m, "EVENT", event, 3, version);
    assert.equal(
      await scalar(db, "SELECT score_a FROM ballers_matches WHERE id=$1", [m]),
      1,
    );
    await assert.rejects(
      () => act(db, m, "EVENT", { ...event, id: id(9801) }, 1),
      /LEADER_REQUIRED/,
    );
  });
  await test("request retry after completion returns its original match without starting another", async () => {
    await act(db, m, "FINISH");
    await actor(db, 3);
    assert.equal(await launch(d.g, id(501), 0, 1), m);
    assert.equal(await count(d.g), 1);
  });
  await test("delayed start with a new operation but old sequence is rejected after completion", async () => {
    await actor(db, 3);
    await assert.rejects(
      () => launch(d.g, id(530), 0, 1),
      /START_SEQUENCE_CHANGED/,
    );
    assert.equal(await count(d.g), 1);
  });
  await test("an operation UUID cannot be recycled with different arguments or another actor", async () => {
    await actor(db, 3);
    await assert.rejects(
      () => launch(d.g, id(501), 1, 1),
      /START_OPERATION_REUSE/,
    );
    await actor(db, 1);
    await assert.rejects(
      () => launch(d.g, id(501), 0, 1),
      /START_OPERATION_REUSE/,
    );
  });
  let second;
  await test("explicit next start at the new sequence creates exactly the next match", async () => {
    await actor(db, 3);
    second = await launch(d.g, id(540), 1, 1);
    assert.notEqual(second, m);
    assert.equal(await count(d.g), 2);
  });
  await test("leader is retained across matches instead of silently switching to a resting team", async () => {
    await actor(db, 3);
    assert.equal(
      await scalar(db, "SELECT operator_id FROM ballers_matches WHERE id=$1", [
        second,
      ]),
      pid(3),
    );
  });
  await test("transfer immediately invalidates previous snapshot version and old leader", async () => {
    await actor(db, 3);
    const v = await scalar(
      db,
      "SELECT version FROM ballers_matches WHERE id=$1",
      [second],
    );
    await assign(d.g, pid(2), 1);
    await assert.rejects(
      () => act(db, second, "FINISH", {}, 3, v),
      /LEADER_REQUIRED/,
    );
    await assert.rejects(
      () => act(db, second, "FINISH", {}, 2, v),
      /Матч изменился/,
    );
    await act(db, second, "PAUSE", {}, 2);
  });
  await test("leader transfer cannot be bypassed with the old OPERATOR command", async () => {
    await actor(db, 1);
    await assert.rejects(
      () => act(db, second, "OPERATOR", { player_id: pid(1) }, 1),
      /USE_LEADER_TRANSFER/,
    );
  });
  await test("direct control/audit/receipt table writes and reads are denied", async () => {
    await actor(db, 2);
    for (const table of [
      "ballers_game_leaders",
      "ballers_leader_audit",
      "ballers_start_operations",
    ])
      await assert.rejects(
        () => db.query("SELECT * FROM " + table),
        /permission denied/,
      );
    await assert.rejects(
      () =>
        db.query(
          "UPDATE ballers_game_leaders SET player_id=$1 WHERE game_day_id=$2",
          [pid(2), d.g],
        ),
      /permission denied/,
    );
  });
  await test("anonymous and unrelated users cannot inspect control or recover authority", async () => {
    await actor(db, 0);
    await assert.rejects(() => control(d.g), /permission denied/);
    await actor(db, 4);
    await assert.rejects(() => control(d.g), /FORBIDDEN/);
    await assert.rejects(() => assign(d.g, pid(4), 2, "Перехват"), /FORBIDDEN/);
  });
  await test("snapshot exposes one named leader and audit without exposing start receipts", async () => {
    await actor(db, 2);
    const s = await scalar(db, "SELECT ballers_alpha_snapshot($1)", [d.g]);
    assert.equal(s.control.leader_id, pid(2));
    assert.equal(s.control.history[0].action, "TRANSFER");
    assert.ok(!JSON.stringify(s.control).includes("operation_id"));
  });
  await test("closed day rejects new control changes and new starts", async () => {
    await act(db, second, "FINISH", {}, 2);
    await actor(db, 1);
    await scalar(db, "SELECT ballers_game_action($1,'CLOSE')", [d.g]);
    await assert.rejects(
      () => assign(d.g, pid(1), 2, "Закрыто"),
      /GAME_NOT_OPEN/,
    );
    await actor(db, 2);
    await assert.rejects(() => launch(d.g, id(550), 2, 2), /GAME_NOT_OPEN/);
  });
  await test("migration repeat is transactional and rejected", async () => {
    await db.exec("RESET ROLE");
    await assert.rejects(() => db.exec(migration), /009 already applied/);
    await db.exec("ROLLBACK");
  });
  console.log(
    `RESULT: ${passed} leader SQL checks passed; isolated PostgreSQL, no live database access.`,
  );
} finally {
  await db.close();
}
