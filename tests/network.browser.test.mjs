import { artifactPath } from "./artifact-path.mjs";
// Real isolated PostgreSQL/RLS + production browser. OAuth/HTTP transport simulated.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const db = new PGlite();
const read = (p) =>
  fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
await db.exec(
  `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`,
);
for (const p of [
  "supabase/test_project_baseline.sql",
  ...fs
    .readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((x) => "supabase/migrations/" + x),
])
  await db.exec(read(p));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  uid = (n) => id(1000 + n),
  pid = (n) => id(2000 + n),
  c1 = id(1),
  c2 = id(2);
for (const [n, name, city] of [
  [1, "Sanzhar", "Astana"],
  [2, "Dana", "Astana"],
  [3, "Erzhan", "Astana"],
  [4, "Arsen", "Almaty"],
]) {
  await db.query("INSERT INTO auth.users VALUES($1)", [uid(n)]);
  await db.query(
    "INSERT INTO player_profiles(id,user_id,first_name,city,primary_position) VALUES($1,$2,$3,$4,'MID')",
    [pid(n), uid(n), name, city],
  );
}
for (const [id, name] of [
  [c1, "Saturday Football"],
  [c2, "Wednesday Football"],
]) {
  await db.query(
    "INSERT INTO communities(id,name,city,created_by) VALUES($1,$2,'Astana',$3)",
    [id, name, uid(3)],
  );
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
    [id, pid(3)],
  );
}
const rpc = {
  ballers_community_workspace: { p_community: "uuid" },
  ballers_community_action: {
    p_community: "uuid",
    p_action: "text",
    p_payload: "jsonb",
  },
  ballers_team_calendar: { p_team: "uuid" },
  ballers_schedule_team_game: {
    p_team: "uuid",
    p_operation: "uuid",
    p_community: "uuid",
    p_date: "date",
    p_time: "time",
    p_venue: "text",
  },
  ballers_create_community: {
    p_name: "text",
    p_city: "text",
    p_team_mode: "public.team_mode",
    p_format: "int",
    p_team_count: "int",
    p_capacity: "int",
  },
  ballers_alpha_snapshot: { p_game: "uuid" },
  ballers_day_requests_feed: { p_game: "uuid" },
  ballers_set_attendance: {
    p_game_id: "uuid",
    p_player_id: "uuid",
    p_status: "public.attendance_status",
  },
  ballers_tactics: { p_team: "uuid", p_layout: "jsonb", p_version: "bigint" },
  ballers_home: {},
  ballers_notification_feed: {},
  ballers_network: {},
  ballers_player_stats: { p_player: "uuid" },
  ballers_public_player: { p_player: "uuid" },
  ballers_directory: {
    p_kind: "text",
    p_city: "text",
    p_query: "text",
    p_offset: "int",
    p_free: "boolean",
  },
  ballers_team_detail: { p_team: "uuid" },
  ballers_community_preview: { p_community: "uuid" },
  ballers_team_create: {
    p_id: "uuid",
    p_name: "text",
    p_city: "text",
    p_about: "text",
  },
  ballers_football_save: {
    p_city: "text",
    p_status: "text",
    p_available: "boolean",
  },
  ballers_club_action: {
    p_team: "uuid",
    p_action: "text",
    p_players: "uuid[]",
    p_community: "uuid",
    p_accept: "boolean",
    p_operation: "uuid",
  },
};
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3012";
let passed = 0;
const errors = [];
const contexts = [];
function pass(s) {
  console.log("PASS " + s);
  passed++;
}
async function context(
  n,
  locale = "ru",
  width = 390,
  { loseSchedule = false } = {},
) {
  let lostSchedule = false;
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  contexts.push(ctx);
  const user = {
    id: uid(n),
    aud: "authenticated",
    role: "authenticated",
    email: "test@example.invalid",
    app_metadata: { provider: "google" },
    user_metadata: {},
  };
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const token =
    b64({ alg: "HS256", typ: "JWT" }) +
    "." +
    b64({
      sub: uid(n),
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
      aud: "authenticated",
    }) +
    ".dummy";
  await ctx.addInitScript(
    ({ user, token, locale }) => {
      if (!localStorage.getItem("ballers:locale"))
        localStorage.setItem("ballers:locale", locale);
      localStorage.setItem("ballers:welcome:disabled", "true");
      localStorage.setItem(
        "sb-example-auth-token",
        JSON.stringify({
          access_token: token,
          token_type: "bearer",
          refresh_token: "test-only",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user,
        }),
      );
    },
    { user, token, locale },
  );
  await ctx.route("https://example.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    try {
      if (url.pathname === "/auth/v1/user")
        return route.fulfill({ status: 200, headers, json: user });
      const result = await serial(async () => {
        await db.exec("RESET ROLE");
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
          uid(n),
        ]);
        await db.exec("SET ROLE authenticated");
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          const name = url.pathname.split("/").at(-1);
          assert.ok(rpc[name], name);
          const args = req.postDataJSON() || {},
            keys = Object.keys(args);
          assert.ok(
            keys.every((k) => rpc[name][k]),
            JSON.stringify(args),
          );
          const params = keys.map((k) => args[k]);
          return (
            await db.query(
              `SELECT ${name}(${keys.map((k, i) => k + " => $" + (i + 1) + "::" + rpc[name][k]).join(",")}) result`,
              params,
            )
          ).rows[0].result;
        }
        if (url.pathname === "/rest/v1/player_profiles") {
          const rows = (
            await db.query("SELECT * FROM player_profiles WHERE user_id=$1", [
              uid(n),
            ])
          ).rows;
          return (req.headers().accept || "").includes("vnd.pgrst.object")
            ? rows[0]
            : rows;
        }
        throw new Error("Unhandled " + url.pathname);
      });
      if (
        loseSchedule &&
        !lostSchedule &&
        url.pathname.endsWith("/rpc/ballers_schedule_team_game")
      ) {
        lostSchedule = true;
        return route.abort("failed");
      }
      return route.fulfill({ status: 200, headers, json: result });
    } catch (e) {
      console.log("TRANSPORT ERROR", e.message);
      return route.fulfill({
        status: 400,
        headers,
        json: { code: e.code || "TEST_ERROR", message: e.message },
      });
    }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGE ERROR", new URL(page.url()).pathname, e.message);
  });
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}
async function screenshot(page, name) {
  await page.screenshot({
    path: artifactPath(new URL("../docs/" + name, import.meta.url)),
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    name + " overflow",
  );
}
try {
  const { page: captain } = await context(1);
  await captain.goto(base + "/discover");
  await captain.getByRole("heading", { name: "Найти", exact: true }).waitFor();
  await captain.getByText("Dana", { exact: true }).waitFor();
  await captain.getByText("Arsen", { exact: true }).waitFor();
  await captain
    .getByLabel("Город игры", { exact: true })
    .selectOption("Astana");
  await captain.waitForTimeout(600);
  assert.equal(await captain.getByText("Arsen", { exact: true }).count(), 0);
  await captain.getByLabel("Город игры", { exact: true }).selectOption("");
  await captain.getByText("Arsen", { exact: true }).waitFor();
  await captain
    .getByRole("textbox", { name: "Имя, ник или Baller ID", exact: true })
    .fill("Dana");
  await captain.getByText("Dana", { exact: true }).waitFor();
  await captain.waitForTimeout(700);
  assert.equal(await captain.getByText("Sanzhar", { exact: true }).count(), 0);
  await screenshot(captain, "network-directory-mobile.png");
  pass("city directory, all-city selection and name search work");
  await captain.goto(base + "/teams/create");
  await captain.getByLabel("Название команды", { exact: true }).fill("Bars");
  await captain.getByLabel("О команде").fill("Friends who play football");
  await captain
    .getByRole("button", { name: "Создать команду", exact: true })
    .dblclick();
  await captain.waitForURL(/\/teams\/[a-f0-9-]{36}$/);
  const teamId = captain.url().split("/").at(-1);
  await captain.getByRole("heading", { name: "Bars", exact: true }).waitFor();
  pass("double create creates one persistent team and captain");
  await captain
    .getByRole("button", { name: "Пригласить игроков", exact: true })
    .click();
  await captain.getByLabel("Имя, ник или Baller ID").fill("Dana");
  await captain.getByRole("button", { name: "Выбрать", exact: true }).click();
  await captain.getByLabel("Имя, ник или Baller ID").fill("Arsen");
  await captain.getByRole("button", { name: "Выбрать", exact: true }).click();
  await screenshot(captain, "network-select-players-mobile.png");
  await captain
    .getByRole("button", { name: "Отправить приглашения", exact: true })
    .click();
  await captain.getByText("Ожидают подтверждения", { exact: true }).waitFor();
  await captain.getByText("Dana", { exact: true }).waitFor();
  await captain.getByText("Arsen", { exact: true }).waitFor();
  pass(
    "captain selects two players across cities; pending invites are not active membership",
  );
  const { page: player } = await context(2, "kk");
  await player.goto(base + "/discover?kind=inbox");
  await player.getByText("Командаға шақыру", { exact: true }).waitFor();
  await screenshot(player, "network-inbox-kk-mobile.png");
  await player.getByRole("button", { name: "Қабылдау", exact: true }).click();
  await player.getByText("Барлығы қаралды", { exact: true }).waitFor();
  await player.goto(base + "/teams/" + teamId);
  await player.getByText("Сен командадасың", { exact: true }).waitFor();
  await player.getByRole("button", { name: "Құрам", exact: true }).click();
  await player.getByText("Dana", { exact: true }).waitFor();
  pass("Kazakh player accepts own invitation and appears in confirmed roster");
  const { page: arsen } = await context(4);
  await arsen.goto(base + "/discover?kind=inbox");
  await arsen.getByRole("button", { name: "Отклонить", exact: true }).click();
  await arsen.getByText("Всё разобрано", { exact: true }).waitFor();
  await arsen.goto(base + "/teams/" + teamId);
  await arsen
    .getByRole("button", { name: "Хочу в команду", exact: true })
    .click();
  await arsen.getByText("Заявка отправлена", { exact: true }).waitFor();
  await captain.goto(base + "/discover?kind=inbox");
  await captain.getByText("Arsen", { exact: true }).waitFor();
  await captain.getByRole("button", { name: "Принять", exact: true }).click();
  await captain.getByText("Всё разобрано", { exact: true }).waitFor();
  pass(
    "decline clears invitation; later application requires captain approval",
  );
  await captain.goto(base + "/teams/" + teamId);
  await captain
    .getByRole("button", { name: "Управление", exact: true })
    .click();
  for (const name of ["Saturday", "Wednesday"]) {
    await captain.getByLabel("Найти сообщество", { exact: true }).fill(name);
    await captain
      .getByRole("button", { name: "Подать заявку от команды", exact: true })
      .click();
    await captain.getByText("Ждём организатора").first().waitFor();
  }
  const { page: manager } = await context(3);
  await manager.goto(base + "/discover?kind=inbox");
  await manager
    .getByRole("button", { name: "Принять", exact: true })
    .first()
    .click();
  await manager.waitForTimeout(700);
  await manager.getByRole("button", { name: "Принять", exact: true }).click();
  await manager.getByText("Всё разобрано", { exact: true }).waitFor();
  await manager.goto(base + "/discover/community/" + c1);
  await manager.getByText("Bars", { exact: true }).waitFor();
  await screenshot(manager, "network-community-mobile.png");
  await manager.goto(base + "/discover/community/" + c2);
  await manager.getByText("Bars", { exact: true }).waitFor();
  pass("independent community manager confirms one team in two communities");
  await player.goto(base + "/profile/football");
  await player
    .getByLabel("Ойын ойнайтын қала", { exact: true })
    .selectOption("Almaty");
  await player.getByLabel("Команда іздеп жүрмін").check();
  await player.getByRole("button", { name: "Сақтау", exact: true }).click();
  await player.getByText("Өзгерістер сақталды.", { exact: true }).waitFor();
  await screenshot(player, "network-football-kk-mobile.png");
  await player.goto(base + "/players/" + pid(2));
  await player.getByText("Команда іздеп жүрмін", { exact: true }).waitFor();
  await player.getByText("Алматы", { exact: true }).waitFor();
  await player.getByText("Bars", { exact: true }).waitFor();
  pass("moving city retains identity/team; free-player status is independent");
  await captain.goto(base + "/teams/" + teamId);
  await captain.getByRole("button", { name: "Состав", exact: true }).click();
  await captain.getByText("Arsen", { exact: true }).waitFor();
  await screenshot(captain, "network-team-roster-mobile.png");
  await captain.setViewportSize({ width: 1280, height: 900 });
  await screenshot(captain, "network-team-desktop.png");
  await captain.setViewportSize({ width: 320, height: 740 });
  await screenshot(captain, "network-team-320.png");
  pass("team roster layouts fit 320px, mobile and desktop");
  const { page: planner } = await context(1, "ru", 390, { loseSchedule: true });
  await planner.goto(base + "/teams/" + teamId + "?tab=games");
  await planner
    .getByRole("heading", { name: "Ближайшие игры команды", exact: true })
    .waitFor();
  await planner
    .getByRole("link", { name: "Запланировать игру", exact: true })
    .last()
    .click();
  await planner
    .getByRole("heading", {
      name: "Где собирается ваша компания?",
      exact: true,
    })
    .waitFor();
  await planner
    .getByRole("link", { name: "Создать своё сообщество", exact: true })
    .click();
  await planner
    .getByLabel("Название сообщества", { exact: true })
    .fill("Team Friday");
  await planner
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .click();
  await planner.waitForURL("**/teams/" + teamId + "/games/create");
  await planner.getByLabel("Место", { exact: true }).waitFor();
  pass(
    "team planning creates a missing managed community and returns to the same team",
  );
  await planner.getByLabel("Дата", { exact: true }).fill("2099-01-08");
  await planner.getByLabel("Время начала", { exact: true }).fill("20:00");
  await planner
    .getByLabel("Место", { exact: true })
    .fill("Тестовая площадка без бронирования");
  await screenshot(planner, "team-schedule-form-390.png");
  await planner
    .getByRole("button", {
      name: "Создать игру и пригласить состав",
      exact: true,
    })
    .click();
  await planner
    .getByRole("button", { name: "Проверить создание", exact: true })
    .waitFor();
  await planner.reload();
  await planner
    .getByRole("button", { name: "Проверить создание", exact: true })
    .waitFor();
  assert.equal(
    await planner.getByLabel("Место", { exact: true }).inputValue(),
    "Тестовая площадка без бронирования",
  );
  assert.equal(
    await planner.getByLabel("Место", { exact: true }).isEnabled(),
    false,
  );
  await planner
    .getByRole("button", { name: "Проверить создание", exact: true })
    .click();
  await planner.waitForURL("**/play?tab=overview");
  const dayId = new URL(planner.url()).pathname.split("/")[2];
  await planner
    .getByRole("heading", { name: "Team Friday #1", exact: true })
    .waitFor();
  const created = await serial(async () => {
    await db.exec("RESET ROLE");
    return (
      await db.query(
        "SELECT (SELECT count(*)::int FROM ballers_team_games WHERE team_id=$1) days,(SELECT count(*)::int FROM game_participants WHERE game_day_id=$2) invited,(SELECT count(*)::int FROM game_participants WHERE game_day_id=$2 AND attendance_status='GOING') going",
        [teamId, dayId],
      )
    ).rows[0];
  });
  assert.deepEqual(created, { days: 1, invited: 3, going: 0 });
  assert.equal(
    await planner.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("ballers:team-schedule:"),
        ).length,
    ),
    0,
  );
  pass(
    "lost schedule response survives reload and retry creates one game with one invitation per active member",
  );
  await arsen.goto(base + "/teams/" + teamId + "?tab=games");
  await arsen
    .getByRole("link", { name: "Ответить на приглашение", exact: true })
    .click();
  await arsen
    .getByRole("heading", { name: "Будешь играть?", exact: true })
    .waitFor();
  await arsen.getByRole("button", { name: "✓ Иду", exact: true }).click();
  await planner.goto(base + "/teams/" + teamId + "?tab=games");
  await planner
    .getByText("Из команды подтвердились: 1", { exact: false })
    .waitFor();
  await screenshot(planner, "team-calendar-390.png");
  await planner.reload();
  await planner
    .getByRole("heading", { name: "Ближайшие игры команды", exact: true })
    .waitFor();
  pass(
    "team member follows a real invitation and the calendar shows their confirmed participation",
  );
  await serial(async () => {
    await db.exec("RESET ROLE");
    await db.query("UPDATE game_days SET status='COMPLETED' WHERE id=$1", [
      dayId,
    ]);
  });
  await planner.reload();
  await planner.getByRole("link", { name: "История", exact: true }).click();
  await planner
    .getByRole("heading", { name: "История игр команды", exact: true })
    .waitFor();
  await planner
    .getByRole("heading", { name: "Team Friday #1", exact: true })
    .waitFor();
  await planner.reload();
  assert.equal(new URL(planner.url()).searchParams.get("view"), "history");
  pass(
    "team calendar history survives reload and separates completed games from upcoming",
  );
  await planner.setViewportSize({ width: 320, height: 740 });
  await planner
    .getByLabel("Язык интерфейса", { exact: true })
    .selectOption("kk");
  await screenshot(planner, "team-calendar-kk-320.png");
  pass("team calendar and schedule navigation fit Kazakh labels at 320px");
  const communityId = await serial(async () => {
    await db.exec("RESET ROLE");
    return (
      await db.query("SELECT community_id FROM game_days WHERE id=$1", [dayId])
    ).rows[0].community_id;
  });
  await planner
    .getByLabel("Интерфейс тілі", { exact: true })
    .selectOption("ru");
  await planner.goto(base + "/communities/" + communityId);
  await planner
    .getByRole("heading", { name: "Ближайшие игры сообщества", exact: true })
    .waitFor();
  assert.equal(
    await planner
      .getByRole("link", { name: "Создать игру", exact: true })
      .count(),
    1,
  );
  await planner.getByRole("link", { name: "История", exact: true }).click();
  await planner
    .getByRole("heading", { name: "Team Friday #1", exact: true })
    .waitFor();
  await planner.reload();
  await planner
    .getByRole("heading", { name: "История игр сообщества", exact: true })
    .waitFor();
  assert.equal(new URL(planner.url()).searchParams.get("view"), "history");
  assert.equal(
    await planner
      .getByRole("link", { name: "К игре →", exact: true })
      .getAttribute("href"),
    "/games/" + dayId + "/play?tab=overview",
  );
  pass(
    "community has one creation action and persistent history with canonical game links",
  );
  await planner.getByRole("button", { name: "Люди", exact: true }).click();
  await planner
    .getByRole("heading", { name: "Участники сообщества", exact: true })
    .waitFor();
  await planner
    .getByRole("button", {
      name: "Пригласить игроков в сообщество",
      exact: true,
    })
    .click();
  await planner
    .getByRole("button", { name: "Создать ссылку приглашения", exact: true })
    .click();
  await planner.getByLabel("Ссылка", { exact: true }).waitFor();
  await planner
    .getByRole("button", { name: "Закрыть меню", exact: true })
    .click();
  pass(
    "community people section opens the working consent-based invitation flow",
  );
  await serial(async () => {
    await db.exec("RESET ROLE");
    await db.query("UPDATE communities SET default_capacity=NULL WHERE id=$1", [
      communityId,
    ]);
  });
  await planner.reload();
  await planner
    .getByRole("button", { name: "Управление", exact: true })
    .click();
  await planner
    .getByRole("button", { name: "Изменить настройки", exact: true })
    .click();
  assert.equal(
    await planner
      .getByRole("button", { name: "Создать ссылку приглашения", exact: true })
      .count(),
    0,
  );
  await planner
    .getByLabel("Название", { exact: true })
    .fill("Team Friday Updated");
  await planner
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await planner
    .getByRole("heading", { name: "Team Friday Updated", exact: true })
    .waitFor();
  await serial(async () => {
    await db.exec("RESET ROLE");
    assert.equal(
      (await db.query("SELECT title FROM game_days WHERE id=$1", [dayId]))
        .rows[0].title,
      "Team Friday #1",
    );
    assert.equal(
      (
        await db.query("SELECT default_capacity FROM communities WHERE id=$1", [
          communityId,
        ])
      ).rows[0].default_capacity,
      null,
    );
  });
  pass(
    "community settings update real data without renaming existing games or duplicating invitations",
  );
  await arsen.goto(base + "/communities/" + communityId + "?tab=people");
  await arsen
    .getByText(
      "Участники сообщества видят его игры и людей. Вступить можно по приглашению организатора.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await arsen
      .getByRole("heading", { name: "Участники сообщества", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await arsen
      .getByRole("link", { name: "Создать игру", exact: true })
      .count(),
    0,
  );
  pass(
    "a game guest cannot open the private community roster or organizer controls",
  );
  await serial(async () => {
    await db.exec("RESET ROLE");
    await db.query(
      "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MEMBER')",
      [communityId, pid(2)],
    );
  });
  await player.getByLabel("Интерфейс тілі", { exact: true }).selectOption("ru");
  await player.goto(base + "/communities/" + communityId + "?tab=settings");
  await player
    .getByRole("heading", { name: "Ближайшие игры сообщества", exact: true })
    .waitFor();
  assert.equal(
    await player
      .getByRole("button", { name: "Управление", exact: true })
      .count(),
    0,
  );
  await player.getByRole("button", { name: "Люди", exact: true }).click();
  await player
    .getByRole("heading", { name: "Участники сообщества", exact: true })
    .waitFor();
  assert.equal(
    await player
      .getByRole("button", {
        name: "Пригласить игроков в сообщество",
        exact: true,
      })
      .count(),
    0,
  );
  await player
    .getByLabel("Язык интерфейса", { exact: true })
    .selectOption("kk");
  await player.reload();
  await player
    .getByRole("heading", { name: "Қауымдастық мүшелері", exact: true })
    .waitFor();
  await player.setViewportSize({ width: 320, height: 740 });
  await screenshot(player, "community-people-kk-320.png");
  pass(
    "regular community member gets a private role-appropriate view with persisted Kazakh tabs at 320px",
  );
  await planner.goto(base + "/communities/" + communityId + "/games");
  await planner.waitForURL("**/communities/" + communityId + "?tab=games");
  await planner.getByRole("link", { name: "История", exact: true }).click();
  await planner
    .getByRole("heading", { name: "Team Friday #1", exact: true })
    .waitFor();
  await planner.setViewportSize({ width: 390, height: 844 });
  await screenshot(planner, "community-calendar-390.png");
  pass(
    "legacy community games bookmark opens the unified calendar and retains access to history",
  );
  await player.goto(base + "/discover");
  await player.getByLabel("Интерфейс тілі").selectOption("ru");
  await player.getByRole("heading", { name: "Найти", exact: true }).waitFor();
  await player.reload();
  await player.getByRole("heading", { name: "Найти", exact: true }).waitFor();
  assert.equal(await player.locator("#interface-language").inputValue(), "ru");
  pass("switching RU/KK on new pages persists after reload");
  const anonymous = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  contexts.push(anonymous);
  const anon = await anonymous.newPage();
  await anon.goto(base + "/teams/" + teamId);
  await anon
    .getByText("Твой футбол начинается здесь", { exact: true })
    .waitFor();
  await anon.getByRole("link", { name: "Войти", exact: true }).click();
  await anon.waitForURL(base + "/");
  assert.equal(
    await anon.evaluate(() => localStorage.getItem("ballers:network-return")),
    "/teams/" + teamId,
  );
  pass("shared team link preserves destination for login without auto-joining");
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} network browser checks passed; isolated SQL, simulated OAuth/HTTP, not live Supabase.`,
  );
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await db.close();
}
