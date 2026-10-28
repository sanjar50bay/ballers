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
try {
  const { page: member } = await context(1);
  const { page: guest } = await context(2);
  const { page: owner } = await context(3);
  const { page: manager } = await context(4);
  await member.goto(base + "/discover?kind=teams");
  await member.getByText("Own Team", { exact: true }).waitFor();
  await member.getByText("Other Owner Team", { exact: true }).waitFor();
  await member.getByRole("button", { name: "Сообщества", exact: true }).click();
  await member.getByText("Other Owner Community", { exact: true }).waitFor();
  assert.equal(await member.getByText(/искусственных TEST/).count(), 0);
  assert.equal(
    await member.getByText("Название сообщества", { exact: true }).count(),
    1,
  );
  pass(
    "global catalog shows other creators teams/communities; contextual search labels have no developer text",
  );
  await member.goto(base + "/communities");
  await member
    .getByRole("heading", { name: "Мои сообщества", exact: true })
    .waitFor();
  assert.equal(
    await member.getByText("Other Owner Community", { exact: true }).count(),
    0,
  );
  await member
    .getByRole("link", { name: "Найти все сообщества →", exact: true })
    .click();
  await member.getByText("Other Owner Community", { exact: true }).waitFor();
  pass(
    "personal communities page is explicitly personal and links to the global catalog",
  );
  await member.goto(base + "/");
  await member
    .getByRole("heading", { name: "Nearest Community Day", exact: true })
    .waitFor();
  await member.getByText("Можно присоединиться", { exact: true }).waitFor();
  assert.equal(
    await member
      .getByText("Ты пока не записан на ближайшие игры", { exact: true })
      .count(),
    0,
  );
  pass("nearest community game appears before the member has joined");
  await guest.goto(base + "/");
  await guest
    .getByText("Ты пока не записан на ближайшие игры", { exact: true })
    .waitFor();
  assert.equal(await guest.locator('a[href="/open-games"]').count(), 1);
  await guest
    .getByRole("link", { name: "Создать игровой день →", exact: true })
    .waitFor();
  pass("no relevant game: one find action, create action, no duplicate panel");
  await member.goto(base + "/games/" + day + "/play");
  await member
    .getByText("Ты игрок: управляешь только своим участием", { exact: true })
    .waitFor();
  for (const label of [
    "Все участники → Иду",
    "Тестовые игроки +14",
    "Сохранить правила",
  ])
    assert.equal(
      await member
        .getByRole("button", { name: label, exact: true, includeHidden: true })
        .count(),
      0,
    );
  assert.equal(await member.locator('select[name="captain"]').count(), 0);
  pass("ordinary player has no bulk, test-player, rules or role-edit controls");
  await owner.goto(base + "/games/" + day + "/play");
  await owner
    .getByText("Ты организатор этого игрового дня", { exact: true })
    .waitFor();
  await owner
    .locator("summary")
    .filter({ hasText: "Участники и резерв" })
    .click();
  await owner
    .getByRole("button", { name: "Все участники → Иду", exact: true })
    .waitFor({ state: "attached" });
  await owner
    .getByRole("button", { name: "Тестовые игроки +14", exact: true })
    .waitFor({ state: "attached" });
  assert.equal(await owner.locator('select[name="captain"]').count(), 2);
  await manager.goto(base + "/games/" + day + "/play");
  await manager
    .getByText("Ты организатор этого игрового дня", { exact: true })
    .waitFor();
  assert.equal(
    await manager
      .getByRole("button", {
        name: "Тестовые игроки +14",
        exact: true,
        includeHidden: true,
      })
      .count(),
    0,
  );
  pass(
    "owner/manager controls are scoped, and only owner sees synthetic-player creation",
  );
  await guest.goto(base + "/open-games");
  await guest
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await guest.waitForURL("**/games/" + day + "/play");
  await guest
    .getByText("Ожидает решения организатора", { exact: true })
    .waitFor();
  await guest.goto(base + "/");
  await guest.getByText("Заявка ожидает решения", { exact: true }).waitFor();
  await guest
    .getByRole("heading", { name: "Nearest Community Day", exact: true })
    .waitFor();
  pass("pending guest request remains visible on home without false Going");
  const requests = owner.getByRole("region", {
    name: "Заявки на игровой день",
  });
  await owner.reload();
  await requests.getByRole("button", { name: "Принять", exact: true }).click();
  await requests.getByText("Нет ожидающих заявок.", { exact: true }).waitFor();
  await member.goto(base + "/open-games");
  await member
    .getByRole("button", { name: "Подать заявку", exact: true })
    .click();
  await member.waitForURL("**/games/" + day + "/play");
  await member
    .getByText("Ожидает решения организатора", { exact: true })
    .waitFor();
  await owner.reload();
  await requests.getByRole("button", { name: "Принять", exact: true }).click();
  await requests.getByText("Нет ожидающих заявок.", { exact: true }).waitFor();
  await member.goto(base + "/");
  await member.getByText("Ты в резерве", { exact: true }).waitFor();
  pass(
    "accepted first player fills last place and next accepted applicant sees reserve on home",
  );
  await guest.goto(base + "/games/" + day + "/play");
  await guest
    .getByLabel("Ответ Dana", { exact: true })
    .waitFor({ state: "attached" });
  await guest
    .locator("summary")
    .filter({ hasText: "Участники и резерв" })
    .click();
  await guest
    .getByLabel("Ответ Dana", { exact: true })
    .selectOption("DECLINED");
  await guest.waitForTimeout(400);
  await member.reload();
  await member
    .getByText("Место предложено — подтверди участие", { exact: true })
    .waitFor();
  await member.goto(base + "/games/" + day + "/play");
  await member
    .getByLabel("Ответ Sanzhar", { exact: true })
    .waitFor({ state: "attached" });
  await member
    .locator("summary")
    .filter({ hasText: "Участники и резерв" })
    .click();
  await member
    .getByLabel("Ответ Sanzhar", { exact: true })
    .selectOption("GOING");
  await member.waitForTimeout(400);
  await member.goto(base + "/");
  await member.getByText("● Ты идёшь", { exact: true }).waitFor();
  pass(
    "cancellation offers reserve a place; own explicit confirmation changes it to Going",
  );
  await member.setViewportSize({ width: 320, height: 900 });
  await screenshot(member, "reliability-home-320.png");
  await member.getByLabel("Язык интерфейса").selectOption("kk");
  await member.getByRole("button", { name: "Құру", exact: true }).click();
  const menu = member.getByRole("dialog");
  await menu
    .getByText("Белгілі бір күнге ойыншылар жинау", { exact: true })
    .waitFor();
  await screenshot(member, "reliability-menu-kk-320.png");
  await member.keyboard.press("Escape");
  pass("context explanations and localized main screen fit 320px");
  await guest.goto(base + "/open-games");
  await guest
    .getByRole("heading", { name: "Nearest Community Day", exact: true })
    .waitFor();
  await guest.getByLabel("Город игры", { exact: true }).selectOption("Almaty");
  await guest
    .getByText("В городе Алматы пока нет игр с открытым набором.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await guest
      .getByRole("link", { name: "Войти через Google", exact: true })
      .count(),
    0,
  );
  await guest.getByLabel("Город игры", { exact: true }).selectOption("");
  await guest
    .getByRole("heading", { name: "Nearest Community Day", exact: true })
    .waitFor();
  pass(
    "empty city filter does not pretend the authenticated player needs to sign in",
  );
  const failureRoute = "**/rest/v1/rpc/ballers_open_games";
  await guest.route(failureRoute, (route) =>
    route.fulfill({ status: 400, json: { message: "NETWORK_ERROR" } }),
  );
  await guest.reload();
  await guest.getByRole("alert").waitFor();
  assert.equal(
    await guest
      .getByText("Пока нет игр с открытым набором.", { exact: true })
      .count(),
    0,
  );
  await guest.unroute(failureRoute);
  await guest
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await guest
    .getByRole("heading", { name: "Nearest Community Day", exact: true })
    .waitFor();
  pass("open-game request error has retry, not a false empty state");
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} reliability browser checks passed; isolated SQL, simulated OAuth/HTTP, not live Supabase.`,
  );
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await db.close();
}
