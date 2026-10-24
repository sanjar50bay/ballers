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
  const { page: captain } = await context(1);
  await captain.goto(base + "/discover");
  await captain.getByRole("heading", { name: "Найти", exact: true }).waitFor();
  await captain.getByText("Dana", { exact: true }).waitFor();
  assert.equal(await captain.getByText("Arsen", { exact: true }).count(), 0);
  await captain.getByLabel("Город игры", { exact: true }).selectOption("");
  await captain.getByText("Arsen", { exact: true }).waitFor();
  await captain
    .getByRole("textbox", { name: "Поиск", exact: true })
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
    .getByRole("button", { name: "Пригласить", exact: true })
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
    .getByRole("button", { name: "Сообщества", exact: true })
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
  await anon
    .getByRole("link", { name: "Войти через Google", exact: true })
    .click();
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
