import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { init, uid, day, actor, start } from "./trusted-fixture.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const db = new PGlite();
await init(db);
const { g } = await day(db, 200);
await start(db, g);
let chain = Promise.resolve();
const serial = (fn) => {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
};
const rpc = {
  ballers_alpha_snapshot: { p_game: "uuid" },
  ballers_result_mode: { p_game: "uuid", p_mode: "text" },
  ballers_match_history: { p_match: "uuid" },
  ballers_start_match: { p_game: "uuid" },
  ballers_game_action: { p_game: "uuid", p_action: "text", p_payload: "jsonb" },
  ballers_match_action: {
    p_match: "uuid",
    p_version: "bigint",
    p_action: "text",
    p_payload: "jsonb",
  },
  ballers_day_requests_feed: { p_game: "uuid" },
  ballers_home: {},
  ballers_my_career: {},
  ballers_network: {},
  ballers_notification_feed: {},
  ballers_player_stats: { p_player: "uuid" },
};
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

async function shot(page, name) {
  await page.screenshot({ path: "docs/" + name });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
}
try {
  const { page: op } = await context(3);
  await op.goto(base + `/games/${g}/play`);
  await op
    .getByRole("button", { name: "Записать событие", exact: true })
    .waitFor();
  assert.equal(
    await op.getByLabel("Режим для новых матчей", { exact: true }).count(),
    0,
  );
  await op
    .getByRole("button", { name: "Записать событие", exact: true })
    .click();
  await op.getByRole("button", { name: "Завершить матч", exact: true }).click();
  await op.getByText("Учтён ведущим", { exact: true }).first().waitFor();
  assert.equal(
    await op
      .getByRole("button", { name: "Подтвердить результат", exact: true })
      .count(),
    0,
  );
  await op.locator(".day-table tbody tr").filter({ hasText: "Blue" }).waitFor();
  assert.equal(
    await op
      .locator(".day-table tbody tr")
      .filter({ hasText: "Blue" })
      .locator("td")
      .last()
      .innerText(),
    "3",
  );
  await op.getByRole("button", { name: "Бомбардиры", exact: true }).click();
  await op
    .locator(".day-results")
    .getByRole("rowheader", { name: /^Organizer/ })
    .waitFor();
  assert.equal(
    await op.getByText("Добавить пропущенное событие", { exact: true }).count(),
    0,
  );
  pass(
    "operator finishes: result, points and scorer appear without captain confirmations; no post-match correction privileges",
  );
  const { page: owner } = await context(1);
  await owner.goto(base + `/games/${g}/play`);
  await owner.getByText("Учтён ведущим", { exact: true }).first().waitFor();
  await owner
    .getByText("Добавить пропущенное событие", { exact: true })
    .click();
  const form = owner.locator("form").filter({
    has: owner.getByRole("button", {
      name: "Сохранить исправление",
      exact: true,
    }),
  });
  await form
    .getByLabel("Причина исправления (минимум 5 символов)", { exact: true })
    .fill("Пропущенный гол проверен");
  await form
    .getByRole("button", { name: "Сохранить исправление", exact: true })
    .click();
  await owner
    .getByRole("article")
    .filter({ hasText: "#1" })
    .getByText("#1 Blue 2:0 Red", { exact: true })
    .waitFor();
  await owner
    .getByText("История изменений результата", { exact: true })
    .click();
  await owner.getByText(/Пропущенный гол проверен/).waitFor();
  await shot(owner, "trusted-result-390.png");
  pass(
    "organizer correction updates score immediately and exposes author, time and reason in history",
  );
  await owner
    .getByLabel("Режим для новых матчей", { exact: true })
    .selectOption("CAPTAINS");
  await owner.waitForTimeout(300);
  await serial(async () => {
    await actor(db, 1);
    await start(db, g);
  });
  await owner.reload();
  await owner
    .getByRole("button", { name: "Завершить матч", exact: true })
    .waitFor();
  await owner
    .getByRole("button", { name: "Завершить матч", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .waitFor();
  pass(
    "strict mode remains selectable and finished strict match still requests captain approval",
  );
  await owner
    .getByRole("button", { name: "Учесть без подтверждений", exact: true })
    .click();
  // Existing dialog handler accepts prompts with an empty value; repeat with explicit reason handler.
  owner.removeAllListeners("dialog");
  owner.on("dialog", (d) => d.accept("Организатор проверил счёт"));
  await owner
    .getByRole("button", { name: "Учесть без подтверждений", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Учесть без подтверждений", exact: true })
    .waitFor({ state: "detached" });
  pass(
    "organizer can explicitly account an old pending result with a recorded reason",
  );
  await owner.goto(base + "/career");
  await owner.getByRole("heading",{name:"Учтённая статистика",exact:true}).waitFor();
  await owner.getByText("Учтён",{exact:true}).first().waitFor();
  pass("career includes accounted trusted matches with clear terminology");
  const { page: member } = await context(2, "kk", 320);
  await member.goto(base + `/games/${g}/play`);
  await member
    .getByText("Жүргізуші есепке алды", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await member
      .getByRole("button", { name: "Сохранить исправление", exact: true })
      .count(),
    0,
  );
  await member.locator(".day-results").scrollIntoViewIfNeeded();
  await shot(member, "trusted-result-kk-320.png");
  pass(
    "Kazakh result view fits 320px and ordinary member has no correction or policy controls",
  );
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} trusted-result browser checks passed; isolated SQL, simulated OAuth/HTTP, no production changes.`,
  );
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
  await db.close();
}
