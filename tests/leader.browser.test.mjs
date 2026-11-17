import assert from "node:assert/strict";
import { artifactPath } from "./artifact-path.mjs";
import {
  context,
  rpc,
  admin,
  close,
  base,
  game,
  community,
  pid,
  id,
  errors,
} from "./leader-browser-fixture.mjs";
let passed = 0;
const pass = (s) => {
  passed++;
  console.log("PASS " + s);
};
const open = async (page, tab = "overview") => {
  await page.goto(`${base}/games/${game}/play?tab=${tab}`);
  await page
    .getByRole("heading", { name: "Trusted Match Day", exact: true })
    .waitFor();
};
const leaderName = (page) => page.getByRole("region", { name: "Ведущий игры" });
async function shot(page, name) {
  await page.screenshot({ path: artifactPath("docs/" + name) });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    name + " overflow",
  );
}
try {
  const { page: owner } = await context(1),
    { page: leader } = await context(3, { loseStart: true }),
    { page: spectator } = await context(2),
    { page: manager } = await context(5);
  await open(owner);
  await owner.getByText("Ещё не назначен", { exact: true }).waitFor();
  assert.equal(
    await owner
      .getByRole("button", { name: "Начать первый матч", exact: true })
      .count(),
    0,
  );
  await leaderName(owner).getByText("Кто ведёт матч?", { exact: true }).click();
  await leaderName(owner).getByRole("combobox").selectOption(pid(3));
  await leaderName(owner)
    .getByRole("button", { name: "Назначить ведущего", exact: true })
    .click();
  await leaderName(owner).getByText("Operator", { exact: true }).waitFor();
  pass(
    "organizer explicitly selects a real attending leader; there is no start before assignment",
  );
  await shot(owner, "leader-overview-390.png");
  await open(spectator);
  await open(manager);
  for (const page of [owner, spectator, manager]) {
    assert.equal(
      await page
        .getByRole("button", { name: "Начать первый матч", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "Пауза", exact: true }).count(),
      0,
    );
  }
  pass(
    "players and other managers are spectators until they receive the baton",
  );
  await open(leader);
  await leader
    .getByRole("button", { name: "Начать первый матч", exact: true })
    .click();
  await leader
    .getByRole("button", { name: "Проверить запуск", exact: true })
    .waitFor();
  const stored = await leader.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("ballers:start:"),
      )?.[1],
  );
  assert.ok(stored);
  assert.equal(
    (
      await admin(
        "SELECT count(*)::int n FROM ballers_matches WHERE game_day_id=$1",
        [game],
      )
    )[0].n,
    1,
  );
  await leader.reload();
  await leader
    .getByRole("button", { name: "Проверить запуск", exact: true })
    .click();
  await leader.waitForURL("**/play?tab=matches");
  await leader.getByRole("button", { name: "Пауза", exact: true }).waitFor();
  assert.equal(
    (
      await admin(
        "SELECT count(*)::int n FROM ballers_matches WHERE game_day_id=$1",
        [game],
      )
    )[0].n,
    1,
  );
  assert.equal(
    await leader.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("ballers:start:")),
    ),
    false,
  );
  pass(
    "lost start response is recovered after reload with the same operation, without a duplicate match",
  );
  await shot(leader, "leader-match-390.png");
  await leader.getByLabel("Событие", { exact: true }).selectOption("GOAL");
  await leader.getByLabel("Игрок", { exact: true }).selectOption(pid(1));
  await leader
    .getByRole("button", { name: "Записать событие", exact: true })
    .click();
  await leader.getByText("1:0", { exact: true }).first().waitFor();
  assert.equal(
    (
      await admin(
        "SELECT score_a FROM ballers_matches WHERE game_day_id=$1 AND status='LIVE'",
        [game],
      )
    )[0].score_a,
    1,
  );
  pass("the designated leader records a goal through the normal match form");
  const op = JSON.parse(stored);
  const startArgs = (i) => ({
    p_game: game,
    p_operation: id(700 + i),
    p_expected_sequence: op.sequence,
    p_leader_version: op.leaderVersion,
  });
  const devices = [];
  for (let i = 0; i < 5; i++) {
    const { page } = await context(3);
    await open(page);
    devices.push(page);
  }
  const simultaneous = await Promise.all(
    devices.map((page, i) =>
      rpc(page, "ballers_start_game_match", startArgs(i)),
    ),
  );
  assert.ok(simultaneous.every((r) => r.status === 200));
  assert.equal(new Set(simultaneous.map((r) => r.body)).size, 1);
  assert.equal(
    (
      await admin(
        "SELECT count(*)::int n FROM ballers_matches WHERE game_day_id=$1",
        [game],
      )
    )[0].n,
    1,
  );
  pass(
    "five browser sessions send competing starts and receive the same active match",
  );
  for (const page of devices) await page.close();
  const { page: viewer6 } = await context(6),
    { page: viewer7 } = await context(7);
  await open(viewer6);
  await open(viewer7);
  const unauthorized = await Promise.all(
    [owner, spectator, manager, viewer6, viewer7].map((page, i) =>
      rpc(page, "ballers_start_game_match", startArgs(20 + i)),
    ),
  );
  assert.ok(
    unauthorized.every(
      (r) => r.status === 400 && /LEADER_REQUIRED/.test(r.body.message),
    ),
  );
  assert.equal(
    (
      await admin(
        "SELECT count(*)::int n FROM ballers_matches WHERE game_day_id=$1",
        [game],
      )
    )[0].n,
    1,
  );
  pass(
    "five different non-leading players, including two organizers, cannot create extra matches",
  );
  await leader.getByRole("button", { name: "Пауза", exact: true }).click();
  await leader
    .getByRole("button", { name: "Продолжить", exact: true })
    .waitFor();
  await open(spectator, "matches");
  await spectator.getByText("Пауза", { exact: true }).first().waitFor();
  assert.equal(
    await spectator
      .getByRole("button", { name: "Продолжить", exact: true })
      .count(),
    0,
  );
  await leader.getByRole("button", { name: "Продолжить", exact: true }).click();
  await leader.getByRole("button", { name: "Пауза", exact: true }).waitFor();
  pass(
    "leader pauses/resumes while a second player sees the shared state without controls",
  );
  await leaderName(leader)
    .locator("summary")
    .filter({ hasText: /^Передать управление$/ })
    .click();
  await leaderName(leader).getByRole("combobox").selectOption(pid(2));
  await leaderName(leader)
    .getByRole("button", { name: "Передать управление", exact: true })
    .click();
  await leaderName(leader).getByText("Captain", { exact: true }).waitFor();
  assert.equal(
    await leader.getByRole("button", { name: "Пауза", exact: true }).count(),
    0,
  );
  await open(spectator, "matches");
  await spectator.getByRole("button", { name: "Пауза", exact: true }).waitFor();
  const oldWrite = await rpc(leader, "ballers_match_action", {
    p_match: simultaneous[0].body,
    p_version: 0,
    p_action: "FINISH",
    p_payload: {},
  });
  assert.equal(oldWrite.status, 400);
  assert.match(oldWrite.body.message, /LEADER_REQUIRED/);
  pass(
    "transfer updates all devices and the server rejects writes by the former leader",
  );
  await open(owner);
  await leaderName(owner)
    .locator("summary")
    .filter({ hasText: /^Восстановить управление$/ })
    .click();
  await leaderName(owner).getByRole("combobox").selectOption(pid(1));
  const reason = leaderName(owner).getByLabel("Причина восстановления", {
    exact: true,
  });
  await reason.fill("Телефон ведущего недоступен");
  await leaderName(owner)
    .getByRole("button", { name: "Восстановить управление", exact: true })
    .click();
  await leaderName(owner)
    .getByText("Управление у тебя", { exact: true })
    .waitFor();
  await leaderName(owner)
    .getByText("История управления", { exact: true })
    .click();
  await leaderName(owner)
    .getByText("Телефон ведущего недоступен", { exact: true })
    .waitFor();
  pass(
    "organizer recovery requires an explanation and exposes the transfer audit",
  );
  await owner
    .getByRole("navigation", { name: "Разделы игры" })
    .getByRole("link", { name: "Участники", exact: true })
    .click();
  await owner.getByRole("heading", { name: "Команды", exact: true }).waitFor();
  assert.equal(await owner.locator(".ballers-nav").count(), 1);
  await shot(owner, "leader-participants-390.png");
  await owner.reload();
  await owner.getByRole("heading", { name: "Команды", exact: true }).waitFor();
  assert.equal(
    await owner
      .getByRole("navigation", { name: "Разделы игры" })
      .locator('[aria-current="page"]')
      .innerText(),
    "Участники",
  );
  await owner.goto(`${base}/communities/${community}/game-days/${game}`);
  await owner.waitForURL("**/play?tab=participants");
  await owner.getByRole("heading", { name: "Команды", exact: true }).waitFor();
  pass(
    "Participants is embedded in the same game; reload and legacy participant links preserve the tab",
  );
  await owner
    .getByRole("navigation", { name: "Разделы игры" })
    .getByRole("link", { name: "Матчи", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Завершить матч", exact: true })
    .click();
  await owner.getByText("Учтён ведущим", { exact: true }).waitFor();
  const stats = await rpc(owner, "ballers_player_stats", { p_player: pid(1) });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.goals, 1);
  pass("finished trusted match updates the scorer's real career statistics");
  const delayed = await rpc(owner, "ballers_start_game_match", {
    p_game: game,
    p_operation: id(800),
    p_expected_sequence: 0,
    p_leader_version: 3,
  });
  assert.equal(delayed.status, 400);
  assert.match(delayed.body.message, /START_SEQUENCE_CHANGED/);
  assert.equal(
    (
      await admin(
        "SELECT count(*)::int n FROM ballers_matches WHERE game_day_id=$1",
        [game],
      )
    )[0].n,
    1,
  );
  pass(
    "match completion updates results and delayed stale starts cannot create a next match",
  );
  await owner
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Мои игры", exact: true })
    .click();
  await owner.getByRole("heading", { name: "Мои игры", exact: true }).waitFor();
  await owner.getByRole("link", { name: "К игре →", exact: true }).click();
  await owner.waitForURL("**/play");
  await owner
    .getByRole("heading", { name: "Trusted Match Day", exact: true })
    .waitFor();
  pass(
    "home/game list open the canonical game instead of another duplicate control screen",
  );
  await owner.setViewportSize({ width: 320, height: 740 });
  await owner.getByLabel("Язык интерфейса", { exact: true }).selectOption("kk");
  await owner
    .getByRole("navigation", { name: "Ойын бөлімдері" })
    .getByRole("link", { name: "Матчтар", exact: true })
    .click();
  await owner.getByText("Матчты жүргізуші:", { exact: true }).first().waitFor();
  await shot(owner, "leader-match-kk-320.png");
  await owner.setViewportSize({ width: 1280, height: 900 });
  await shot(owner, "leader-match-desktop.png");
  pass(
    "shared game, leader panel and tabs fit 320px and desktop with Kazakh labels",
  );
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} leader/unified-game browser checks passed. Multiple browser contexts; isolated PGlite serializes SQL transport, not a multi-connection production load test.`,
  );
} finally {
  await close();
}
