import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  init,
  day,
  id,
  pid,
  actor,
  scalar,
  act,
  start,
} from "./trusted-fixture.mjs";
import { scheduledStart } from "../lib/game-schedule.ts";
const db = new PGlite();
let passed = 0;
const pass = (s) => {
  passed++;
  console.log("PASS " + s);
};
try {
  await init(db);
  const future = await day(db, 900),
    legacy = await day(db, 1000);
  await db.exec("RESET ROLE");
  for (const name of fs
    .readdirSync("supabase/migrations")
    .filter((n) => Number(n.match(/_(\d+)_/)?.[1]) >= 9)
    .sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + name, "utf8"));
  await actor(db, 1);
  await assert.rejects(() => start(db, legacy.g), /GAME_NOT_STARTED_YET/);
  await assert.rejects(
    () => scalar(db, "SELECT ballers_game_action($1,'START','{}')", [legacy.g]),
    /GAME_NOT_STARTED_YET/,
  );
  pass("legacy start and generic game-action cannot bypass a future date");
  await db.exec("RESET ROLE");
  await db.exec(
    fs.readFileSync("supabase/activate_009_game_leader.sql", "utf8"),
  );
  await actor(db, 1);
  const control = await scalar(db, "SELECT ballers_game_control($1)", [
    future.g,
  ]);
  await scalar(db, "SELECT ballers_set_game_leader($1,$2,$3,NULL)", [
    future.g,
    pid(1),
    control.version,
  ]);
  const c = await scalar(db, "SELECT ballers_game_control($1)", [future.g]);
  const launch = () =>
    scalar(db, "SELECT ballers_start_game_match($1,$2,0,$3)", [
      future.g,
      id(1200),
      c.version,
    ]);
  await assert.rejects(launch, /GAME_NOT_STARTED_YET/);
  pass(
    "designated leader cannot start before the date through the operation RPC",
  );
  await db.exec("RESET ROLE");
  assert.equal(
    await scalar(db, "SELECT count(*)::int FROM ballers_matches"),
    0,
  );
  assert.equal(
    await scalar(db, "SELECT count(*)::int FROM ballers_start_operations"),
    0,
  );
  pass("rejected start leaves no match or start-operation record");
  await db.query(
    "UPDATE game_days SET game_date=(statement_timestamp() AT TIME ZONE 'Asia/Almaty')::date,start_time=((statement_timestamp() AT TIME ZONE 'Asia/Almaty')+interval '1 hour')::time WHERE id=$1",
    [future.g],
  );
  // Avoid midnight wrap for this clock-boundary case by deriving date and time together.
  await db.query(
    "UPDATE game_days SET game_date=((statement_timestamp() AT TIME ZONE 'Asia/Almaty')+interval '1 hour')::date WHERE id=$1",
    [future.g],
  );
  await actor(db, 1);
  await assert.rejects(launch, /GAME_NOT_STARTED_YET/);
  pass("same-day future time is blocked using the server clock");
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE game_days SET game_date=current_date+2,start_time=NULL WHERE id=$1",
    [future.g],
  );
  await actor(db, 1);
  await assert.rejects(launch, /GAME_NOT_STARTED_YET/);
  pass("an unknown time cannot bypass a future game date");
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE game_days SET game_date=((statement_timestamp() AT TIME ZONE 'Asia/Almaty')-interval '1 second')::date,start_time=((statement_timestamp() AT TIME ZONE 'Asia/Almaty')-interval '1 second')::time WHERE id=$1",
    [future.g],
  );
  await actor(db, 1);
  const match = await launch();
  assert.ok(match);
  assert.equal(await launch(), match);
  pass(
    "start is permitted at/after scheduled time and retry returns the same match",
  );
  await db.exec("RESET ROLE");
  await db.query("UPDATE game_days SET game_date=current_date+2 WHERE id=$1", [
    future.g,
  ]);
  await act(db, match, "PAUSE", {}, 1);
  await assert.rejects(
    () => act(db, match, "RESUME", {}, 1),
    /GAME_NOT_STARTED_YET/,
  );
  await act(db, match, "FINISH", {}, 1);
  pass(
    "an already-active premature match can be paused or finished, but cannot resume early",
  );
  assert.equal(
    scheduledStart({ game_date: "2026-11-20", start_time: "20:00" }),
    Date.parse("2026-11-20T15:00:00Z"),
  );
  assert.equal(
    scheduledStart({ game_date: "2026-11-20", start_time: null }),
    Date.parse("2026-11-19T19:00:00Z"),
  );
  pass(
    "UI schedule uses Kazakhstan UTC+5; an unspecified time uses the beginning of that day",
  );
  console.log(
    `RESULT: ${passed} schedule checks passed on isolated PostgreSQL, not live data.`,
  );
} finally {
  await db.close();
}
