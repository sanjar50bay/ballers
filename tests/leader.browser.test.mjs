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
let debugPage;
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
  debugPage = owner;
  await open(owner);
  await admin(
    "UPDATE game_participants SET attendance_status=CASE player_id WHEN $2 THEN 'INVITED'::attendance_status WHEN $3 THEN 'MAYBE'::attendance_status WHEN $4 THEN 'DECLINED'::attendance_status ELSE attendance_status END WHERE game_day_id=$1",
    [game, pid(8), pid(7), pid(6)],
  );
  await owner.reload();
  const prep = owner.getByRole("region", {
    name: "Подготовка игры",
    exact: true,
  });
  await prep
    .getByRole("heading", { name: "Назначить ведущего", exact: true })
    .waitFor();
  assert.deepEqual(
    await prep.locator(".preparation-counts dd").allTextContents(),
    ["4", "1", "1", "1"],
  );
  assert.equal(await prep.locator("details").getAttribute("open"), null);
  assert.equal(
    await prep.locator(".preparation-next button,.preparation-next a").count(),
    1,
  );
  await prep.screenshot({
    path: artifactPath("docs/organizer-readiness-390.png"),
  });
  pass(
    "organizer sees authoritative reply counts, one next action and a collapsed checklist",
  );
  await admin("UPDATE game_days SET start_time=NULL,venue=NULL WHERE id=$1", [
    game,
  ]);
  await owner.reload();
  await prep
    .getByText("Уточни недостающие данные с участниками до игры.", {
      exact: true,
    })
    .waitFor();
  await owner.setViewportSize({ width: 320, height: 740 });
  await owner.getByLabel("Язык интерфейса", { exact: true }).selectOption("kk");
  await owner
    .locator(".preparation-next-label")
    .getByText("Келесі қадам", { exact: true })
    .waitFor();
  await owner
    .locator(".game-preparation")
    .screenshot({ path: artifactPath("docs/organizer-readiness-kk-320.png") });
  assert.ok(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await owner.getByLabel("Интерфейс тілі", { exact: true }).selectOption("ru");
  await owner.setViewportSize({ width: 390, height: 844 });
  await admin(
    "UPDATE game_days SET start_time='20:00',venue='Купол · тестовая площадка' WHERE id=$1",
    [game],
  );
  await admin(
    "UPDATE game_participants SET attendance_status='GOING' WHERE game_day_id=$1",
    [game],
  );
  await owner.reload();
  pass(
    "missing planning details are explicit, organizer controls fit Kazakh at 320px",
  );
  await owner.getByText("Ещё не назначен", { exact: true }).waitFor();
  assert.equal(
    await owner
      .getByRole("button", { name: "Начать первый матч", exact: true })
      .count(),
    0,
  );
  await owner
    .getByRole("region", { name: "Подготовка игры", exact: true })
    .getByRole("button", { name: "Назначить ведущего", exact: true })
    .click();
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
  assert.equal(await spectator.locator(".game-preparation").count(), 0);
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
  await admin("DELETE FROM ballers_team_roles WHERE team_id IN ($1,$2)", [
    id(201),
    id(202),
  ]);
  await leader.reload();
  await leader
    .getByRole("heading", { name: "Подготовка игры", exact: true })
    .waitFor();
  assert.equal(
    await leader
      .getByRole("button", { name: "Начать первый матч", exact: true })
      .isEnabled(),
    false,
  );
  await open(owner);
  await owner
    .getByRole("region", { name: "Подготовка игры", exact: true })
    .screenshot({ path: artifactPath("docs/preparation-checklist-390.png") });
  await owner
    .getByRole("link", { name: "Назначить капитанов", exact: true })
    .click();
  const blue = owner
    .locator("form")
    .filter({ has: owner.getByRole("heading", { name: /^Blue\s*·/ }) });
  const red = owner
    .locator("form")
    .filter({ has: owner.getByRole("heading", { name: /^Red\s*·/ }) });
  await blue.getByLabel("Капитан", { exact: true }).waitFor();
  assert.equal(
    await blue.getByLabel("Капитан", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await blue.getByLabel("Ответственный", { exact: true }).inputValue(),
    "",
  );
  await shot(owner, "preparation-captains-390.png");
  pass(
    "missing saved captains block start and the preparation link reveals unsaved role fields",
  );
  for (const [form, player, name] of [
    [blue, pid(1), "Blue"],
    [red, pid(2), "Red"],
  ]) {
    await form.getByLabel("Капитан", { exact: true }).selectOption(player);
    await form
      .getByLabel("Ответственный", { exact: true })
      .selectOption(player);
    await form
      .getByRole("button", { name: "Сохранить роли " + name, exact: true })
      .click();
    await form.getByText("Роли сохранены", { exact: true }).waitFor();
  }
  await owner
    .getByRole("heading", { name: "Можно начинать", exact: true })
    .waitFor();
  pass(
    "saving both starting captains makes preparation ready without changing the waiting team",
  );
  await leader.reload();
  await leader
    .getByRole("heading", { name: "Можно начинать", exact: true })
    .waitFor();
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
  // Stop polling in this tab: returning focus must fetch the new authority itself.
  await spectator.clock.install({ time: new Date("2026-11-18T12:00:00Z") });
  await spectator.clock.pauseAt(new Date("2026-11-18T12:00:01Z"));
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
  await Promise.all([
    spectator.waitForRequest((req) =>
      req.url().endsWith("/rpc/ballers_alpha_snapshot"),
    ),
    spectator.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
  await spectator.getByRole("button", { name: "Пауза", exact: true }).waitFor();
  await spectator.clock.resume();
  pass(
    "returning focus refreshes changed leader authority without reload or a polling tick",
  );
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
  await owner
    .getByRole("status")
    .filter({
      hasText:
        "Составы закреплены на время матча. Изменить их можно после завершения матча.",
    })
    .waitFor();
  assert.equal(
    await owner
      .getByRole("button", { name: "⚡ Перемешать", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await owner
      .getByRole("button", { name: "Управление →", exact: true })
      .count(),
    0,
  );
  pass(
    "active-match participants explain the roster lock and hide unavailable changes",
  );
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
} catch (error) {
  if (debugPage) {
    await debugPage.screenshot({
      path: artifactPath("docs/preparation-failure.png"),
    });
    console.error(
      "Preparation UI:",
      debugPage.url(),
      await debugPage
        .locator("details[id]")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({ id: n.id, open: n.open, hidden: n.hidden })),
        ),
    );
  }
  throw error;
} finally {
  await close();
}
