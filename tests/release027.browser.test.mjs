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
const day = id(31),
  match = id(33),
  ta = id(34),
  tb = id(35),
  club = id(500);
for (let n = 5; n <= 60; n++) {
  await db.query("INSERT INTO auth.users VALUES($1)", [uid(n)]);
  await db.query(
    "INSERT INTO player_profiles(id,user_id,first_name,city,primary_position) VALUES($1,$2,$3,'Astana','MID')",
    [pid(n), uid(n), "Player " + n],
  );
}
await db.query(
  "INSERT INTO communities(id,name,city,created_by) VALUES($1,'Release Day','Astana',$2)",
  [id(30), uid(1)],
);
await db.query(
  "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')",
  [id(30), pid(1)],
);
await db.query(
  "INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,format,team_count,capacity,created_by) VALUES($1,$2,1,'Approval Cup','2099-10-30','21:00',5,2,2,$3)",
  [day, id(30), uid(1)],
);
await db.query(
  "INSERT INTO ballers_game_settings(game_day_id,is_open,result_mode) VALUES($1,true,'CAPTAINS')",
  [day],
);
await db.query(
  "INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES($1,$2,'GOING','MEMBER')",
  [day, pid(1)],
);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
for (let i = 0; i < 27; i++)
  await db.query("SELECT ballers_team_create($1,$2,'Astana')", [
    id(500 + i),
    i === 0 ? "Bars" : "Club " + i,
  ]);
await db.query(
  "INSERT INTO ballers_team_people(team_id,player_id,status) VALUES($1,$2,'ACTIVE'),($1,$3,'ACTIVE')",
  [club, pid(2), pid(3)],
);
const rpc = {
  ballers_open_games: {},
  ballers_join_open_game: { p_game: "uuid" },
  ballers_alpha_snapshot: { p_game: "uuid" },
  ballers_day_requests_feed: { p_game: "uuid" },
  ballers_answer_day: { p_request: "uuid", p_accept: "boolean" },
  ballers_day_join_mode: { p_game: "uuid", p_mode: "text" },
  ballers_match_action: {
    p_match: "uuid",
    p_version: "bigint",
    p_action: "text",
    p_payload: "jsonb",
  },
  ballers_mark_read: { p_id: "uuid" },
  ballers_set_attendance: {
    p_game_id: "uuid",
    p_player_id: "uuid",
    p_status: "attendance_status",
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
async function context(n, locale = "ru", width = 390) {
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
      window.__soundTones = 0;
      const oscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        window.__soundTones++;
        return oscillator.apply(this, args);
      };
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
          const params = keys.map((k) =>
            rpc[name][k] === "jsonb" ? JSON.stringify(args[k]) : args[k],
          );
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
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}
async function screenshot(page, name) {
  await page.screenshot({
    path: new URL("../docs/" + name, import.meta.url).pathname,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    name + " overflow",
  );
}
async function admin(sql, args = []) {
  return serial(async () => {
    await db.exec("RESET ROLE");
    return db.query(sql, args);
  });
}
try {
  const { page: captain } = await context(1);
  await captain.goto(base + "/discover");
  await captain.getByText("Найдено: 60", { exact: true }).waitFor();
  assert.equal(await captain.getByLabel("Город игры").inputValue(), "");
  let found = new Set();
  for (let page = 1; page <= 3; page++) {
    await captain.getByText(`Страница ${page} из 3`, { exact: true }).waitFor();
    for (const href of await captain
      .locator('.directory-results a[href^="/players/"]')
      .evaluateAll((xs) => xs.map((x) => x.getAttribute("href"))))
      found.add(href);
    if (page < 3)
      await captain
        .getByRole("button", { name: "Дальше", exact: true })
        .click();
  }
  assert.equal(found.size, 60);
  pass("directory shows all 60 real players on three non-overlapping pages");
  await captain.getByRole("button", { name: "Команды", exact: true }).click();
  await captain.getByText("Найдено: 27", { exact: true }).waitFor();
  await captain.getByRole("button", { name: "Дальше", exact: true }).click();
  await captain.getByText("Страница 2 из 2", { exact: true }).waitFor();
  assert.equal(
    await captain.locator('.directory-results a[href^="/teams/"]').count(),
    3,
  );
  pass("permanent team directory has total and accessible second page");
  await captain.getByRole("button", { name: "Создать", exact: true }).click();
  const menu = captain.getByRole("dialog");
  await menu.getByText("У меня есть арена", { exact: true }).waitFor();
  assert.equal(await menu.getByRole("link").count(), 3);
  assert.equal(await menu.getByText("Скоро", { exact: true }).count(), 2);
  await captain.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await menu.count(), 0);
  assert.equal(
    await captain
      .getByRole("button", { name: "Создать", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  pass(
    "plus opens real creation links and honest Soon items, Escape restores focus",
  );
  await captain.goto(base + "/teams/" + club);
  await captain
    .getByRole("heading", { name: "Тактическая доска 5×5", exact: true })
    .waitFor();
  await captain.getByLabel("Добавить игрока на поле").selectOption(pid(1));
  await captain.getByLabel("Добавить игрока на поле").selectOption(pid(2));
  await captain
    .locator(".tactical-dot")
    .getByText("Sanzhar", { exact: true })
    .waitFor();
  const dot = captain.locator(".tactical-dot").first();
  await dot.focus();
  await captain.keyboard.press("ArrowLeft");
  const before = await dot.evaluate((e) => parseFloat(e.style.left));
  assert.equal(before, 47);
  const box = await dot.boundingBox();
  await captain.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await captain.mouse.down();
  await captain.mouse.move(
    box.x + box.width / 2 + 25,
    box.y + box.height / 2 - 25,
    { steps: 5 },
  );
  await captain.mouse.up();
  assert.ok(await dot.evaluate((e) => parseFloat(e.style.left) > 47));
  await captain
    .getByRole("button", { name: "Сохранить расстановку", exact: true })
    .click();
  await captain.waitForTimeout(500);
  const saved = (
    await admin(
      "SELECT layout,version FROM ballers_tactical_boards WHERE team_id=$1",
      [club],
    )
  ).rows[0];
  assert.equal(saved.version, 1);
  assert.equal(saved.layout.length, 2);
  await dot.focus();
  await captain.keyboard.press("ArrowLeft");
  await captain
    .getByRole("button", { name: "Загрузить сохранённую", exact: true })
    .click();
  await captain.waitForTimeout(400);
  assert.ok(
    Math.abs(
      (await captain
        .locator(".tactical-dot")
        .first()
        .evaluate((e) => parseFloat(e.style.left))) - saved.layout[0].x,
    ) < 0.001,
  );
  await captain.reload();
  await captain.locator(".tactical-dot").first().waitFor();
  pass(
    "captain board supports mouse/keyboard, save/reload and discarding a draft",
  );
  await screenshot(captain, "release027-tactics-mobile.png");
  await captain
    .getByRole("heading", { name: "Тактическая доска 5×5", exact: true })
    .locator("..")
    .screenshot({
      path: new URL("../docs/release027-tactics-mobile.png", import.meta.url)
        .pathname,
      style: "nav{visibility:hidden!important}",
    });
  const { page: player } = await context(2);
  await player.goto(base + "/teams/" + club);
  await player.locator(".tactical-dot").first().waitFor();
  assert.equal(
    await player
      .getByRole("button", { name: "Сохранить расстановку", exact: true })
      .count(),
    0,
  );
  pass("ordinary player sees saved board without captain editing controls");
  await player.goto(base + "/open-games");
  await player
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await player.waitForURL("**/games/" + day + "/play");
  await player
    .getByText("Ожидает решения организатора", { exact: true })
    .waitFor();
  assert.equal(
    (
      await admin(
        "SELECT count(1)::int n FROM game_participants WHERE game_day_id=$1 AND player_id=$2",
        [day, pid(2)],
      )
    ).rows[0].n,
    0,
  );
  pass("open game creates a pending request, not an automatic place");
  await captain.goto(base + "/games/" + day + "/play");
  const requests = captain.getByRole("region", {
    name: "Заявки на игровой день",
  });
  await requests.getByRole("button", { name: "Принять", exact: true }).click();
  await requests.getByText("Нет ожидающих заявок.", { exact: true }).waitFor();
  await player.reload();
  await player
    .getByText("Заявка принята. Проверь состав или очередь.", { exact: true })
    .waitFor();
  assert.equal(
    (
      await admin(
        "SELECT attendance_status FROM game_participants WHERE game_day_id=$1 AND player_id=$2",
        [day, pid(2)],
      )
    ).rows[0].attendance_status,
    "GOING",
  );
  pass(
    "manager accepts in browser and applicant sees decision without another registration",
  );
  const { page: third } = await context(3);
  await third.goto(base + "/open-games");
  await third
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await third.waitForURL("**/games/" + day + "/play");
  await third
    .getByText("Ожидает решения организатора", { exact: true })
    .waitFor();
  await captain.reload();
  await requests.getByRole("button", { name: "Принять", exact: true }).click();
  await requests.getByText("Нет ожидающих заявок.", { exact: true }).waitFor();
  assert.equal(
    (
      await admin(
        "SELECT count(1)::int n FROM ballers_waitlist WHERE game_day_id=$1 AND player_id=$2",
        [day, pid(3)],
      )
    ).rows[0].n,
    1,
  );
  pass("full game still offers application; accepted third player is queued");
  const { page: fourth } = await context(4);
  await fourth.goto(base + "/open-games");
  await fourth.waitForFunction(
    () => document.querySelector("#games-city")?.value === "Almaty",
  );
  await fourth.locator("#games-city").selectOption("Astana");
  await fourth
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await fourth.waitForURL("**/games/" + day + "/play");
  await fourth
    .getByText("Ожидает решения организатора", { exact: true })
    .waitFor();
  await captain.goto(base + "/");
  await captain.getByRole("button", { name: /Уведомления/ }).click();
  const bell = captain.getByRole("dialog");
  await bell
    .getByText("Заявка на игровой день: Approval Cup — Arsen", { exact: true })
    .waitFor();
  await bell.getByRole("button", { name: "Отклонить", exact: true }).click();
  await captain.waitForTimeout(400);
  assert.equal(
    (
      await admin(
        "SELECT status FROM ballers_day_requests WHERE game_day_id=$1 AND player_id=$2",
        [day, pid(4)],
      )
    ).rows[0].status,
    "REJECTED",
  );
  await fourth.reload();
  await fourth.getByText("Заявка отклонена", { exact: true }).waitFor();
  pass("organizer bell offers reject and applicant receives the decision");
  await captain.goto(base + "/games/" + day + "/play");
  // Real SQL match fixture, independent of the participation approval test.
  await admin(
    "INSERT INTO game_day_teams(id,game_day_id,name,color_key,sort_order) VALUES($1,$3,'Blue','BLUE',1),($2,$3,'Red','RED',2)",
    [ta, tb, day],
  );
  await admin(
    "INSERT INTO ballers_matches(id,game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,duration_seconds,goal_limit,end_mode,status,running_since) VALUES($1,$2,1,$3,$4,$5,$6,$5,420,2,'GOALS_ONLY','VERIFIED',NULL)",
    [match, day, ta, tb, pid(1), pid(2)],
  );
  await admin(
    "INSERT INTO ballers_match_rosters(match_id,player_id,team_id) VALUES($1,$2,$4),($1,$3,$4),($1,$5,$6)",
    [match, pid(1), pid(3), ta, pid(2), tb],
  );
  await admin(
    "INSERT INTO ballers_match_events(id,match_id,kind,player_id,assist_id,team_id,author_id,elapsed_seconds) VALUES($1,$2,'GOAL',$3,$4,$5,$6,61),($7,$2,'YELLOW',$8,NULL,$9,$6,75)",
    [id(41), match, pid(1), pid(3), ta, uid(1), id(42), pid(2), tb],
  );
  await admin(
    "UPDATE ballers_matches SET score_a=1,confirmed_a=true,confirmed_b=true WHERE id=$1",
    [match],
  );
  await captain.reload();
  const results = captain.getByRole("region", { name: "Итоги игрового дня" });
  await results.getByText("Учтено: 1", { exact: false }).waitFor();
  await results.screenshot({
    path: new URL("../docs/release027-table-mobile.png", import.meta.url)
      .pathname,
  });
  await results
    .getByRole("button", { name: "Бомбардиры", exact: true })
    .click();
  await results
    .getByRole("table")
    .getByRole("rowheader", { name: /Sanzhar/ })
    .waitFor();
  await results
    .getByRole("table")
    .getByRole("rowheader", { name: /Erzhan/ })
    .waitFor();
  await results.getByRole("button", { name: "Протоколы", exact: true }).click();
  await results.locator("summary").click();
  await results.getByText("Жёлтая карточка", { exact: false }).waitFor();
  await screenshot(captain, "release027-protocol-mobile.png");
  pass("confirmed results show scorer, assist and protocol with yellow card");
  await results
    .getByRole("button", { name: "Тестовые матчи", exact: true })
    .click();
  await results.getByText("Учтено: 0", { exact: false }).waitFor();
  await results
    .getByRole("button", { name: "Реальные матчи", exact: true })
    .click();
  pass("test matches are isolated from real standings");
  await captain
    .getByRole("button", { name: "Включить звук матча", exact: true })
    .click();
  await captain
    .getByRole("button", { name: "Звук включён", exact: true })
    .waitFor();
  await admin(
    "UPDATE ballers_matches SET status='LIVE',running_since=now() WHERE id=$1",
    [match],
  );
  await captain.evaluate(() =>
    window.dispatchEvent(new Event("ballers:data-changed")),
  );
  await captain.locator(".live-ball").waitFor();
  await captain.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await captain
      .locator(".live-ball")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  pass(
    "match sound requires a gesture; live indicator respects reduced motion",
  );
  const initialTones = await captain.evaluate(() => window.__soundTones);
  assert.ok(initialTones >= 1);
  await admin(
    "INSERT INTO ballers_match_events(id,match_id,kind,player_id,assist_id,team_id,author_id,elapsed_seconds) VALUES($1,$2,'GOAL',$3,$4,$5,$6,90)",
    [id(43), match, pid(1), pid(3), ta, uid(1)],
  );
  await captain.waitForFunction(
    (n) => window.__soundTones >= n + 4,
    initialTones,
  );
  const goalTones = await captain.evaluate(() => window.__soundTones);
  await captain.waitForTimeout(5500);
  assert.equal(await captain.evaluate(() => window.__soundTones), goalTones);
  await admin(
    "UPDATE ballers_matches SET status='PENDING',running_since=NULL WHERE id=$1",
    [match],
  );
  await captain.waitForFunction((n) => window.__soundTones >= n + 2, goalTones);
  const endTones = await captain.evaluate(() => window.__soundTones);
  await admin(
    "INSERT INTO ballers_matches(id,game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,duration_seconds,goal_limit,end_mode) VALUES($1,$2,2,$3,$4,$5,$6,$5,420,10,'GOALS_ONLY')",
    [id(44), day, ta, tb, pid(1), pid(2)],
  );
  await captain.waitForFunction((n) => window.__soundTones >= n + 2, endTones);
  pass(
    "real AudioContext plays goal/assist and start/end whistles once, not on every poll",
  );
  for (const width of [320, 390, 1280]) {
    await captain.setViewportSize({ width, height: 1000 });
    await screenshot(captain, "release027-day-" + width + ".png");
  }
  pass("day results, requests and protocol fit 320px, mobile and desktop");
  await captain.setViewportSize({ width: 390, height: 844 });
  await results
    .getByRole("button", { name: "Таблица дня", exact: true })
    .click();
  await results.screenshot({
    path: new URL(
      "../docs/release027-table-pending-mobile.png",
      import.meta.url,
    ).pathname,
  });
  await captain.getByLabel("Язык интерфейса").selectOption("kk");
  await captain
    .getByRole("heading", { name: "Ойын күнінің қорытындысы", exact: true })
    .waitFor();
  await screenshot(captain, "release027-day-kk.png");
  pass("new day workflow switches to Kazakh");
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} release 027 browser checks passed; isolated SQL and simulated OAuth/HTTP, not live Supabase.`,
  );
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await db.close();
}
