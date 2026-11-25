import assert from "node:assert/strict";
import { artifactPath } from "./artifact-path.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3014";
const contexts = [],
  errors = [];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const games = [1, 2, 3, 4].map((n) => ({
  id: id(n),
  title: "Open game " + n,
  city: "Astana",
  game_date: "2099-12-01",
  start_time: "18:00",
  venue: "Купол",
  format: 5,
  going: n === 4 ? 10 : 7,
  capacity: 10,
  join_mode: "AUTO",
}));
const profile = {
  id: id(20),
  user_id: id(21),
  first_name: "Public Tester",
  city: "Astana",
  primary_position: "MID",
  baller_id: 20,
};
const stats = {
  matches: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  test_matches: 0,
  test_goals: 0,
};
let passed = 0;
const pass = (name) => {
  passed++;
  console.log("PASS " + name);
};
async function context({
  auth = false,
  hasProfile = true,
  locale = "ru",
  fail = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  contexts.push(ctx);
  const requests = [];
  const user = {
    id: id(21),
    aud: "authenticated",
    role: "authenticated",
    email: "public@example.invalid",
    app_metadata: { provider: "google" },
    user_metadata: {},
  };
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const token =
    b64({ alg: "HS256", typ: "JWT" }) +
    "." +
    b64({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
      aud: "authenticated",
    }) +
    ".dummy";
  await ctx.addInitScript(
    ({ auth, user, token, locale }) => {
      localStorage.setItem("ballers:locale", locale);
      localStorage.setItem("ballers:welcome:disabled", "true");
      localStorage.setItem("ballers:coach:dismissed:" + user.id, "true");
      if (auth)
        localStorage.setItem(
          "sb-example-auth-token",
          JSON.stringify({
            access_token: token,
            token_type: "bearer",
            refresh_token: "test-only",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user,
          }),
        );
    },
    { auth, user, token, locale },
  );
  await ctx.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.hostname !== "example.supabase.co") return route.abort();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    const name = url.pathname.split("/").at(-1);
    requests.push({ name, args: req.postDataJSON() });
    if (name === "authorize")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Simulated Google login</h1>",
      });
    if (name === "user")
      return route.fulfill({ status: 200, headers, json: user });
    let data = {};
    if (name === "ballers_public_open_games") {
      if (fail)
        return route.fulfill({
          status: 503,
          headers,
          json: { message: "TEST_FAILURE" },
        });
      const args = req.postDataJSON();
      data = games
        .filter(
          (g) =>
            (!args.p_city || args.p_city === g.city) &&
            (!args.p_game || args.p_game === g.id),
        )
        .slice(0, args.p_limit ?? 24);
    } else if (name === "ballers_home")
      data = {
        profile: hasProfile ? profile : null,
        stats,
        communities: [],
        games: [],
        history: [],
      };
    else if (name === "ballers_open_games") data = games;
    else if (name === "ballers_network")
      data = { preferences: {}, teams: [], inbox: [] };
    else if (name === "ballers_notification_feed")
      data = { unread: 0, active: [], history: [] };
    else if (name === "ballers_player_stats") data = stats;
    else if (name === "player_profiles") data = hasProfile ? profile : null;
    return route.fulfill({ status: 200, headers, json: data });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return {
    page,
    requests,
    setProfile: () => {
      hasProfile = true;
    },
    recover: () => {
      fail = false;
    },
  };
}
try {
  const guest = await context();
  await guest.page.goto(base);
  await guest.page.locator(".public-game-preview-card").first().waitFor();
  assert.equal(
    await guest.page.locator(".public-game-preview-card").count(),
    3,
  );
  assert.equal(
    guest.requests.filter((r) => r.name === "ballers_join_open_game").length,
    0,
  );
  await guest.page.setViewportSize({ width: 320, height: 850 });
  assert.ok(
    await guest.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await guest.page.screenshot({
    path: artifactPath("docs/public-games-320.png"),
  });
  pass(
    "a visitor sees three upcoming games and a catalogue link before signing in, including on a narrow phone",
  );
  await guest.page
    .getByLabel("Город игры", { exact: true })
    .selectOption("Almaty");
  await guest.page
    .getByText("В этом городе пока нет игр с открытым набором.", {
      exact: true,
    })
    .waitFor();
  await guest.page
    .getByLabel("Город игры", { exact: true })
    .selectOption("Astana");
  await guest.page.locator(".public-game-preview-card").first().waitFor();
  await guest.page
    .getByRole("link", { name: "Посмотреть игры →", exact: true })
    .click();
  await guest.page.waitForURL("**/open-games?city=Astana");
  await guest.page
    .getByRole("heading", { name: "Open game 1", exact: true })
    .waitFor();
  assert.equal(await guest.page.locator("main article").count(), 4);
  await guest.page
    .getByRole("link", { name: "Войти и записаться", exact: true })
    .first()
    .click();
  await guest.page
    .getByRole("heading", {
      name: "Войди, чтобы записаться на эту игру",
      exact: true,
    })
    .waitFor();
  assert.equal(await guest.page.locator("main article").count(), 1);
  await guest.page
    .getByRole("button", { name: "Продолжить с Google", exact: true })
    .click();
  await guest.page.waitForURL(
    "https://example.supabase.co/auth/v1/authorize**",
  );
  assert.equal(
    new URL(guest.page.url()).searchParams.get("redirect_to"),
    base + "/open-games?game=" + games[0].id,
  );
  await guest.page.goto(base + "/open-games?game=" + games[0].id);
  assert.equal(
    await guest.page.evaluate(() =>
      localStorage.getItem("ballers:network-return"),
    ),
    "/open-games?game=" + games[0].id,
  );
  pass(
    "city selection works and Google login preserves the selected public game without enrolling the visitor",
  );
  const member = await context({ auth: true, hasProfile: false });
  await member.page.goto(base + "/open-games?game=" + games[0].id);
  await member.page
    .getByRole("button", {
      name: "Создать профиль и вернуться к игре",
      exact: true,
    })
    .click();
  await member.page.waitForURL("**/onboarding");
  member.setProfile();
  await member.page.goto(base);
  await member.page.waitForURL("**/open-games?game=" + games[0].id);
  await member.page
    .getByRole("button", { name: "Присоединиться", exact: true })
    .waitFor();
  assert.equal(
    member.requests.filter((r) => r.name === "ballers_join_open_game").length,
    0,
  );
  pass(
    "after profile creation the saved game is restored and joining still requires an explicit action",
  );
  const failed = await context({ fail: true });
  await failed.page.goto(base);
  await failed.page
    .getByText("Не удалось загрузить игры.", { exact: true })
    .waitFor();
  assert.equal(
    await failed.page
      .getByText("В этом городе пока нет игр с открытым набором.", {
        exact: true,
      })
      .count(),
    0,
  );
  failed.recover();
  await failed.page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await failed.page.locator(".public-game-preview-card").first().waitFor();
  await failed.page.goto(base + "/open-games?game=" + id(999));
  await failed.page
    .getByText("Эта игра больше не принимает заявки в открытом каталоге.", {
      exact: true,
    })
    .waitFor();
  pass(
    "an API error is distinct from an empty catalogue, retry works, and unavailable game links are handled",
  );
  const kk = await context({ locale: "kk" });
  await kk.page.goto(base);
  await kk.page
    .getByRole("heading", { name: "Алдағы ашық ойындар", exact: true })
    .waitFor();
  await kk.page.locator(".public-game-preview-card").first().waitFor();
  assert.ok(
    await kk.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  pass("the public preview supports Kazakh without horizontal overflow");
  assert.deepEqual(errors, []);
  console.log(
    `RESULT: ${passed} public-games browser checks passed; simulated auth/RPC, no live data.`,
  );
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
}
