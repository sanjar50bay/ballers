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
const day = id(40),
  c3 = id(41);
await db.query(
  "INSERT INTO communities(id,name,city,created_by) VALUES($1,'Other Owner Community','Astana',$2)",
  [c3, uid(2)],
);
await db.query(
  "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MEMBER'),($1,$3,'MANAGER'),($4,$5,'OWNER')",
  [c1, pid(1), pid(4), c3, pid(2)],
);
await db.query(
  "INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,format,team_count,capacity,created_by) VALUES($1,$2,1,'Nearest Community Day','2099-10-28','20:00',5,2,1,$3)",
  [day, c1, uid(3)],
);
await db.query(
  "INSERT INTO ballers_game_settings(game_day_id,is_open) VALUES($1,true)",
  [day],
);
await db.query(
  "INSERT INTO game_day_teams(id,game_day_id,name,color_key,sort_order) VALUES($1,$3,'Blue','BLUE',1),($2,$3,'Red','RED',2)",
  [id(42), id(43), day],
);
for (const n of [1, 2]) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    uid(n),
  ]);
  await db.query("SELECT ballers_team_create($1,$2,'Astana')", [
    id(50 + n),
    n === 1 ? "Own Team" : "Other Owner Team",
  ]);
}
const rpc = {
  ballers_create_community: {
    p_name: "text",
    p_city: "text",
    p_team_mode: "team_mode",
    p_format: "integer",
    p_team_count: "integer",
    p_capacity: "integer",
  },
  ballers_open_games: {},
  ballers_join_open_game: { p_game: "uuid" },
  ballers_alpha_snapshot: { p_game: "uuid" },
  ballers_day_requests_feed: { p_game: "uuid" },
  ballers_day_join_mode: { p_game: "uuid", p_mode: "text" },
  ballers_answer_day: { p_request: "uuid", p_accept: "boolean" },
  ballers_set_attendance: {
    p_game_id: "uuid",
    p_player_id: "uuid",
    p_status: "attendance_status",
  },
  ballers_mark_read: { p_id: "uuid" },
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
        if (url.pathname === "/rest/v1/communities") {
          const community = url.searchParams.get("id")?.replace("eq.", "");
          const rows = (
            await db.query("SELECT * FROM communities WHERE id=$1", [community])
          ).rows;
          return rows[0] || null;
        }
        if (url.pathname === "/rest/v1/community_members") {
          const community = url.searchParams
            .get("community_id")
            ?.replace("eq.", "");
          return (
            await db.query(
              "SELECT cm.*,to_jsonb(p) AS player_profiles FROM community_members cm JOIN player_profiles p ON p.id=cm.player_id WHERE cm.community_id=$1",
              [community],
            )
          ).rows;
        }
        if (url.pathname === "/rest/v1/game_days") {
          const community = url.searchParams
            .get("community_id")
            ?.replace("eq.", "");
          const rows = (
            await db.query(
              "SELECT * FROM game_days WHERE community_id=$1 ORDER BY game_date LIMIT 1",
              [community],
            )
          ).rows;
          return rows[0] || null;
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
    return (await db.query(sql, args)).rows;
  });
}
const nRows = async (table) =>
  (await admin("SELECT count(1)::int n FROM " + table))[0].n;
async function step(page, title) {
  await page.getByRole("dialog", { name: title, exact: true }).waitFor();
  await page.locator(".coach-highlight").waitFor();
}
async function help(page) {
  await page.getByRole("button", { name: "Помощь", exact: true }).click();
  await page.getByRole("dialog", { name: "Помощь", exact: true }).waitFor();
}
try {
  const { page } = await context(1);
  await page.goto(base + "/");
  await page
    .getByRole("button", { name: "Показать шаги", exact: true })
    .waitFor();
  assert.equal(await page.locator(".coach-tip").count(), 0);
  pass("first visit offers, but never forces, a player guide");
  const initialCommunities = await nRows("communities"),
    initialRequests = await nRows("ballers_day_requests");
  await page
    .getByRole("button", { name: "Показать шаги", exact: true })
    .click();
  await step(page, "Твой профиль");
  assert.equal(await page.locator(".welcome-backdrop").count(), 0);
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await step(page, "Найди своих");
  await page.getByText("Other Owner Community", { exact: true }).waitFor();
  assert.ok(page.url().includes("/discover?kind=communities"));
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Назад", exact: true })
    .click();
  await step(page, "Твой профиль");
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await step(page, "Найди своих");
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await step(page, "Запишись на игру");
  await page.waitForFunction(() => {
    const target = document
      .querySelector('[data-coach="join-game"]')
      ?.getBoundingClientRect();
    const highlight = document
      .querySelector(".coach-highlight")
      ?.getBoundingClientRect();
    return target && highlight && Math.abs(highlight.top - target.top) < 8;
  });
  await screenshot(page, "ux-guide-join-390.png");
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await step(page, "Проверь ответ");
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Готово", exact: true })
    .click();
  assert.equal(await nRows("communities"), initialCommunities);
  assert.equal(await nRows("ballers_day_requests"), initialRequests);
  pass(
    "four highlighted steps navigate/back correctly and do not create communities or applications",
  );
  await page.reload();
  await page.getByRole("heading", { name: "Sanzhar", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Показать шаги", exact: true })
      .count(),
    0,
  );
  pass(
    "completion persists per account in this browser and never auto-replays",
  );
  await help(page);
  await page
    .getByRole("dialog", { name: "Помощь", exact: true })
    .getByRole("link", { name: /Все сообщества/ })
    .click();
  await page.getByText("Other Owner Community", { exact: true }).waitFor();
  await page
    .getByRole("link", { name: "Мои сообщества →", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Мои сообщества", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Other Owner Community", { exact: true }).count(),
    0,
  );
  pass(
    "help clearly separates personal communities from other creators in the global catalog",
  );
  await help(page);
  await page
    .getByRole("button", { name: "Пройти обучение", exact: true })
    .click();
  await step(page, "Твой профиль");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".coach-tip").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Помощь", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  pass(
    "guide is skippable with Escape and restores focus to a connected help control",
  );
  await help(page);
  await page
    .getByRole("button", { name: "Пройти обучение", exact: true })
    .click();
  await step(page, "Твой профиль");
  await page.keyboard.press("Tab");
  const focusWithin = await page.evaluate(
    () =>
      !!document.activeElement?.closest('.coach-tip,[data-coach="profile"]'),
  );
  assert.equal(focusWithin, true);
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Пропустить", exact: true })
    .click();
  pass("keyboard focus remains in the instruction or highlighted control");
  // Missing data never blocks all navigation: show a dismissible fallback after 8 seconds.
  await page.evaluate(() =>
    document
      .querySelector('[data-coach="profile"]')
      ?.removeAttribute("data-coach"),
  );
  await help(page);
  await page
    .getByRole("button", { name: "Пройти обучение", exact: true })
    .click();
  await page
    .getByText(
      "Элемент пока недоступен. Можно перейти дальше или закрыть обучение.",
      { exact: true },
    )
    .waitFor({ timeout: 12000 });
  await page
    .locator(".coach-tip")
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await step(page, "Найди своих");
  await page.keyboard.press("Escape");
  pass(
    "missing target times out to an accessible skip/next instead of trapping the user",
  );
  const { page: other } = await context(2);
  await other.addInitScript(
    ({ key }) =>
      localStorage.setItem(key, JSON.stringify({ state: "done", step: 3 })),
    { key: "ballers:guide:v1:" + uid(1) },
  );
  await other.goto(base + "/");
  await other
    .getByRole("button", { name: "Показать шаги", exact: true })
    .waitFor();
  await other.getByRole("button", { name: "Не сейчас", exact: true }).click();
  await other.reload();
  await other.getByRole("heading", { name: "Dana", exact: true }).waitFor();
  assert.equal(
    await other
      .getByRole("button", { name: "Показать шаги", exact: true })
      .count(),
    0,
  );
  pass(
    "another account is not marked trained by the first account; declining is remembered",
  );
  await page.goto(base + "/communities/create");
  await page
    .getByRole("heading", { name: "Создать сообщество", exact: true })
    .waitFor();
  assert.equal(await page.locator(".ballers-wordmark").count(), 1);
  const name = page.getByLabel("Название сообщества", { exact: true });
  assert.equal(await name.inputValue(), "");
  assert.equal(
    await name.getAttribute("placeholder"),
    "Назови своё сообщество",
  );
  await page
    .getByLabel("Мест на игровой день по умолчанию", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .click();
  assert.equal(await nRows("communities"), initialCommunities);
  await name.fill("   ");
  await page
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .click();
  await page
    .getByRole("alert")
    .getByText("Введи название сообщества.", { exact: true })
    .waitFor();
  assert.equal(await nRows("communities"), initialCommunities);
  await screenshot(page, "ux-community-form-390.png");
  pass(
    "community name starts empty, remains labelled, and whitespace cannot be submitted",
  );
  await name.fill("  Достар — среда и суббота  ");
  let creates = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/rpc/ballers_create_community")) creates++;
  });
  await page
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .dblclick();
  await page.waitForURL("**/communities/*");
  await page
    .getByRole("heading", { name: "Достар — среда и суббота", exact: true })
    .waitFor();
  assert.equal(creates, 1);
  assert.equal(await nRows("communities"), initialCommunities + 1);
  await page
    .getByText("15 мест на игру по умолчанию", { exact: true })
    .waitFor();
  assert.ok(
    (
      await admin("SELECT name FROM communities WHERE name LIKE 'Достар%'")
    ).some((x) => x.name === "Достар — среда и суббота"),
  );
  pass(
    "one double-click creates one trimmed community and capacity is not labelled as member count",
  );
  // Response lost after real SQL commit: never auto-repeat the write.
  const lost = "**/rest/v1/rpc/ballers_create_community";
  await other.goto(base + "/communities/create");
  await other
    .getByLabel("Название сообщества", { exact: true })
    .fill("Сохранено без ответа");
  let lostWrites = 0;
  await other.route(lost, async (route) => {
    lostWrites++;
    await serial(async () => {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
        uid(2),
      ]);
      await db.exec("SET ROLE authenticated");
      await db.query(
        "SELECT ballers_create_community('Сохранено без ответа','Astana','RANDOM',5,3,15)",
      );
    });
    await route.abort("failed");
  });
  await other
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .click();
  await other.locator(".error-panel[role=alert]").waitFor();
  assert.equal(
    await other
      .getByRole("button", { name: "Создать сообщество", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(lostWrites, 1);
  await other
    .getByRole("link", { name: "Проверить мои сообщества →", exact: true })
    .click();
  await other.getByText("Сохранено без ответа", { exact: true }).waitFor();
  assert.equal(
    (
      await admin(
        "SELECT id FROM communities WHERE name='Сохранено без ответа'",
      )
    ).length,
    1,
  );
  pass(
    "lost creation response preserves the draft, prevents duplicate retries and leads to the saved record",
  );
  await page.goto(base + "/");
  await page.getByLabel("Язык интерфейса", { exact: true }).selectOption("kk");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Көмек", exact: true }).click();
  await page
    .getByRole("button", { name: "Нұсқаулықтан өту", exact: true })
    .click();
  await step(page, "Сенің профилің");
  await screenshot(page, "ux-guide-kk-320.png");
  await page.keyboard.press("Escape");
  await page.goto(base + "/communities/create");
  await page.getByLabel("Қауымдастық атауы", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Қауымдастық атауы", { exact: true }).inputValue(),
    "",
  );
  await screenshot(page, "ux-community-kk-320.png");
  assert.equal(
    await page
      .locator(".network-input")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    "16px",
  );
  pass(
    "Kazakh labels, optional guide and form fit 320px; form text is at least 16px",
  );
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} UX browser checks passed; isolated SQL, simulated OAuth/HTTP, not live Supabase.`,
  );
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
  await db.close();
}
