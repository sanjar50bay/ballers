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
const pass = (name) => {
  passed++;
  console.log("PASS " + name);
};
const open = async (page, suffix = "?tab=matches") => {
  await page.goto(`${base}/games/${game}/play${suffix}`);
  await page
    .getByRole("heading", { name: "Trusted Match Day", exact: true })
    .waitFor();
};
const summary = (page) => page.locator("#results > summary");
const closed = async (page) =>
  assert.equal(await page.locator("#results").getAttribute("open"), null);
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
    { page: leader } = await context(3),
    { page: viewer } = await context(6);
  await leader.addInitScript(() => {
    const Native = window.AudioContext;
    window.__matchAudioTest = { contexts: 0, tones: 0, master: null };
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        window.__matchAudioTest.contexts++;
      }
      createGain() {
        const node = super.createGain();
        window.__matchAudioTest.master ??= node;
        return node;
      }
      createOscillator() {
        window.__matchAudioTest.tones++;
        return super.createOscillator();
      }
    };
  });
  await open(owner);
  await owner.setViewportSize({ width: 320, height: 850 });
  const initialSound = owner.getByLabel("Настроить звук матча", {
    exact: true,
  });
  await initialSound.click();
  const initialPopover = await owner
    .locator(".match-audio-popover:visible")
    .boundingBox();
  assert.ok(
    initialPopover &&
      initialPopover.x >= 0 &&
      initialPopover.x + initialPopover.width <= 320,
  );
  await shot(owner, "sound-settings-320.png");
  await initialSound.press("Escape");
  const endDay = owner.getByRole("button", {
    name: "Завершить игровой день",
    exact: true,
  });
  await endDay.scrollIntoViewIfNeeded();
  assert.equal(
    await endDay.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(143, 38, 56)",
  );
  await shot(owner, "red-day-closure-320.png");
  await owner.setViewportSize({ width: 390, height: 850 });
  await owner
    .getByRole("region", { name: "Следующий матч", exact: true })
    .getByText("Предварительная пара", { exact: true })
    .waitFor();
  const initial = await rpc(owner, "ballers_alpha_snapshot", { p_game: game });
  assert.equal(initial.status, 200);
  await rpc(owner, "ballers_set_game_leader", {
    p_game: game,
    p_player: pid(3),
    p_version: initial.body.control.version,
    p_reason: null,
  });
  await open(leader);
  await admin(
    "UPDATE game_days SET game_date=(statement_timestamp() AT TIME ZONE 'Asia/Almaty')::date+1 WHERE id=$1",
    [game],
  );
  await open(leader);
  assert.equal(
    await leader
      .getByRole("button", { name: "Начать первый матч", exact: true })
      .isEnabled(),
    false,
  );
  await leader
    .locator("#start-time-reason")
    .getByText(/Старт доступен/)
    .waitFor();
  const scheduledSnapshot = await rpc(leader, "ballers_alpha_snapshot", {
    p_game: game,
  });
  const earlyStart = await rpc(leader, "ballers_start_game_match", {
    p_game: game,
    p_operation: id(9500),
    p_expected_sequence: 0,
    p_leader_version: scheduledSnapshot.body.control.version,
  });
  assert.equal(earlyStart.status, 400);
  assert.match(earlyStart.body.message, /GAME_NOT_STARTED_YET/);
  await admin("UPDATE game_days SET game_date=current_date-1 WHERE id=$1", [
    game,
  ]);
  await open(leader);
  pass(
    "scheduled start is visibly blocked and a direct early-start request is rejected by SQL",
  );
  await leader
    .getByRole("button", { name: "Начать первый матч", exact: true })
    .click();
  const pitch = leader.getByRole("region", {
    name: "Сейчас на поле",
    exact: true,
  });
  await pitch.waitFor();
  await closed(leader);
  assert.equal(await leader.locator("#results .match-history-card").count(), 0);
  await summary(leader).getByText("Матчей: 0", { exact: true }).waitFor();
  const next = leader.getByRole("region", {
    name: "Следующий матч",
    exact: true,
  });
  await next
    .getByText(
      "Пара определится после завершения текущего матча по правилам ротации.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await next.locator(".next-match-pair").count(), 0);
  await next.locator("ol").getByText("1. Yellow", { exact: true }).waitFor();
  assert.match(
    await pitch.evaluate((el) => getComputedStyle(el).backgroundImage),
    /repeating-linear-gradient/,
  );
  assert.equal(
    await leader.evaluate(() => window.__matchAudioTest.contexts),
    0,
  );
  await pitch.getByLabel("Настроить звук матча", { exact: true }).click();
  await pitch
    .getByRole("button", { name: "Включить звук", exact: true })
    .click();
  await pitch
    .getByRole("button", { name: "Выключить звук", exact: true })
    .waitFor();
  const volume = pitch.getByLabel("Громкость матча", { exact: true });
  await volume.press("Home");
  for (let i = 0; i < 5; i++) await volume.press("ArrowRight");
  assert.equal(await volume.inputValue(), "25");
  await leader.waitForFunction(
    () => Math.round(window.__matchAudioTest.master.gain.value * 100) === 25,
  );
  await pitch.getByLabel("Событие", { exact: true }).selectOption("GOAL");
  await pitch.getByLabel("Игрок", { exact: true }).selectOption(pid(1));
  await pitch
    .getByRole("button", { name: "Записать событие", exact: true })
    .click();
  await pitch
    .locator(".live-match-scoreboard>strong")
    .getByText("1:0", { exact: true })
    .waitFor();
  const tones = await leader.evaluate(() => window.__matchAudioTest.tones);
  assert.ok(tones >= 4);
  await pitch
    .getByRole("button", { name: "Выключить звук", exact: true })
    .click();
  assert.equal(
    await leader.evaluate(() => window.__matchAudioTest.master.gain.value),
    0,
  );
  await leader.waitForTimeout(5500);
  assert.equal(
    await leader.evaluate(() => window.__matchAudioTest.tones),
    tones,
  );
  await pitch
    .getByRole("button", { name: "Включить звук", exact: true })
    .click();
  await pitch
    .getByRole("button", { name: "Выключить звук", exact: true })
    .waitFor();
  assert.equal(
    await leader.evaluate(() => window.__matchAudioTest.contexts),
    1,
  );
  assert.equal(
    await leader.evaluate(() => window.__matchAudioTest.tones),
    tones + 1,
  );
  await pitch
    .getByRole("button", { name: "Выключить звук", exact: true })
    .click();
  await volume.press("Escape");
  assert.equal(await pitch.locator(".match-audio-control[open]").count(), 0);
  pass(
    "pitch audio starts only on click, volume reaches the master gain, mute is immediate and polling/re-enable never replay old goal sounds",
  );
  await shot(leader, "pitch-leader-390.png");
  pass(
    "green pitch is separate from the waiting queue and active match is not duplicated as a finished result",
  );
  await open(owner);
  await open(viewer);
  const closure = owner.getByRole("region", {
    name: "Завершение игрового дня",
    exact: true,
  });
  await closure
    .getByText(
      "Сначала завершите текущий матч. Затем можно закрыть игровой день.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await closure
      .getByRole("button", { name: "Завершить игровой день", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await viewer
      .getByRole("button", { name: "Завершить игровой день", exact: true })
      .count(),
    0,
  );
  await viewer
    .getByText("Игровой день завершает организатор.", { exact: true })
    .waitFor();
  pass(
    "manager sees why day closure is blocked while a viewer sees the responsible role without an unavailable control",
  );
  await pitch.getByRole("button", { name: "Пауза", exact: true }).click();
  await pitch
    .getByRole("button", { name: "Продолжить", exact: true })
    .waitFor();
  await owner.reload();
  assert.equal(
    await closure
      .getByRole("button", { name: "Завершить игровой день", exact: true })
      .isDisabled(),
    true,
  );
  await viewer.reload();
  await viewer.setViewportSize({ width: 320, height: 740 });
  await viewer
    .getByLabel("Язык интерфейса", { exact: true })
    .selectOption("kk");
  await viewer
    .getByRole("region", { name: "Қазір алаңда", exact: true })
    .waitFor();
  await shot(viewer, "pitch-viewer-kk-320.png");
  pass(
    "paused matches also explain the closure block and the spectator pitch fits Kazakh at 320px",
  );
  await pitch
    .getByRole("button", { name: "Завершить матч", exact: true })
    .click();
  await pitch.waitFor({ state: "detached" });
  await next
    .locator(".next-match-pair")
    .getByText("Blue", { exact: false })
    .waitFor();
  assert.match(await next.locator(".next-match-pair").innerText(), /Yellow/);
  await closed(leader);
  await summary(leader).getByText("Матчей: 1", { exact: true }).waitFor();
  await summary(leader).focus();
  await leader.keyboard.press("Enter");
  await leader
    .locator("#results .match-history-card")
    .getByText("Учтён ведущим", { exact: true })
    .waitFor();
  pass(
    "after finishing the server-saved next pair is highlighted and results can be expanded from the keyboard",
  );
  const snap = await rpc(owner, "ballers_alpha_snapshot", { p_game: game });
  const match = snap.body.matches[0];
  await open(owner, `#match-${match.id}`);
  await owner
    .getByRole("navigation", { name: "Разделы игры", exact: true })
    .locator('[aria-current="page"]')
    .filter({ hasText: "Матчи" })
    .waitFor();
  await owner.locator(`#match-${match.id}`).waitFor();
  assert.notEqual(await owner.locator("#results").getAttribute("open"), null);
  await summary(owner).click();
  await owner.waitForTimeout(5500);
  await closed(owner);
  await open(owner, "#results");
  await owner.locator("#results[open]").waitFor();
  pass(
    "legacy result and match links reveal the archive and correct tab; polling respects a manual collapse",
  );
  await admin(
    "UPDATE ballers_matches SET status='PENDING',result_mode='CAPTAINS',confirmed_a=false,confirmed_b=false WHERE id=$1",
    [match.id],
  );
  await open(owner);
  await summary(owner)
    .getByText("Требуют твоего действия: 1", { exact: true })
    .waitFor();
  await closed(owner);
  await summary(owner).click();
  await owner
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .waitFor();
  await viewer.getByLabel("Интерфейс тілі", { exact: true }).selectOption("ru");
  await open(viewer);
  await summary(viewer).getByText("Ждут решения: 1", { exact: true }).waitFor();
  assert.equal(await summary(viewer).locator("strong").count(), 0);
  pass(
    "an unresolved result advertises personal action outside the disclosure while spectators only see its pending state",
  );
  await admin(
    "UPDATE ballers_matches SET status='VERIFIED',is_test=true WHERE id=$1",
    [match.id],
  );
  await owner.reload();
  await closure
    .getByRole("button", { name: "Завершить игровой день", exact: true })
    .click();
  await closure
    .getByRole("heading", { name: "Игровой день закрыт", exact: true })
    .waitFor();
  assert.equal(
    await owner
      .getByRole("region", { name: "Следующий матч", exact: true })
      .count(),
    0,
  );
  assert.equal(
    (await admin("SELECT status FROM game_days WHERE id=$1", [game]))[0].status,
    "COMPLETED",
  );
  pass(
    "an organizer whose name is not Sanzhar can close a day containing a test match; rights do not depend on account name or test flag",
  );
  const dates = await owner.evaluate(() => {
    const d = new Date(),
      fmt = (x) =>
        `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const today = fmt(d);
    d.setDate(d.getDate() + 1);
    return { today, tomorrow: fmt(d) };
  });
  for (const [n, date, status] of [
    [801, dates.today, "OPEN"],
    [802, dates.tomorrow, "OPEN"],
    [803, dates.today, "COMPLETED"],
  ])
    await admin(
      "INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,venue,format,team_count,capacity,status,created_by) SELECT $1,$2,$3::integer,'UI day '||($3::integer)::text,$4::date,'20:00','Купол',5,2,10,$5,created_by FROM game_days WHERE id=$6",
      [id(n), community, n, date, status, game],
    );
  await owner.goto(base + "/my-game");
  await owner
    .getByRole("heading", { name: "UI day 801", exact: true })
    .waitFor();
  await owner
    .locator(".game-day-list")
    .getByText("Сегодня", { exact: true })
    .waitFor();
  const colors = await owner
    .locator(".game-day-list>.game-card")
    .evaluateAll((nodes) =>
      nodes.map((el) => getComputedStyle(el).backgroundColor),
    );
  assert.ok(colors.length >= 2);
  assert.notEqual(colors[0], colors[1]);
  await shot(owner, "game-days-blue-390.png");
  await owner.getByRole("link", { name: "История игр", exact: true }).click();
  const history = owner.locator(".game-day-history-card");
  await history.first().waitFor();
  assert.ok((await history.count()) >= 2);
  const historyColors = await history.evaluateAll((nodes) =>
    nodes.map((el) => getComputedStyle(el).backgroundColor),
  );
  assert.notEqual(historyColors[0], historyColors[1]);
  await history
    .filter({ hasText: "Trusted Match Day" })
    .getByRole("link", { name: "Результаты матчей →", exact: true })
    .click();
  await owner.locator("#results[open]").waitFor();
  pass(
    "upcoming and archived days alternate blue shades with semantic day labels and history opens the results directly",
  );
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} match experience browser checks passed; isolated PGlite with simulated auth/HTTP, not live user data.`,
  );
} finally {
  await close();
}
