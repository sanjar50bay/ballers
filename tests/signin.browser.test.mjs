// Local production UI with simulated Auth/HTTP. Never sends real emails.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3012";
const uid = "00000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "player@example.net",
  app_metadata: { provider: "email" },
  user_metadata: {},
};
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const token =
  b64({ alg: "HS256", typ: "JWT" }) +
  "." +
  b64({
    sub: uid,
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
  }) +
  ".dummy";
const session = {
  access_token: token,
  refresh_token: "dummy",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user,
};
const contexts = [];
let passed = 0;
function pass(s) {
  console.log("PASS " + s);
  passed++;
}
async function scenario({
  locale = "ru",
  authenticated = false,
  existing = false,
  delay = 0,
  failSend = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 740 },
  });
  contexts.push(ctx);
  await ctx.addInitScript(
    ({ locale, session, authenticated }) => {
      localStorage.setItem("ballers:locale", locale);
      if (authenticated && !localStorage.getItem("sb-example-auth-token"))
        localStorage.setItem("sb-example-auth-token", JSON.stringify(session));
    },
    { locale, session, authenticated },
  );
  const state = { sends: [], verifies: [], errors: [], external: [] };
  const profile = {
    id: uid,
    baller_id: 42,
    first_name: "Sanzhar",
    last_name: null,
    display_name: null,
    avatar_url: null,
    city: "Astana",
    primary_position: "MID",
  };
  await ctx.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.hostname !== "example.supabase.co") {
      state.external.push(req.url());
      return route.abort();
    }
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (req.method() === "OPTIONS") return reply({});
    if (url.pathname === "/auth/v1/otp") {
      state.sends.push(req.postDataJSON());
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return failSend
        ? reply(
            {
              code: "over_email_send_rate_limit",
              msg: "test delivery failure",
            },
            429,
          )
        : reply({});
    }
    if (url.pathname === "/auth/v1/verify") {
      const data = req.postDataJSON();
      state.verifies.push(data);
      return data.token === "123456"
        ? reply(session)
        : reply({ code: "otp_expired", msg: "Expired code" }, 403);
    }
    if (url.pathname === "/auth/v1/user") return reply(user);
    if (url.pathname === "/auth/v1/authorize")
      return route.fulfill({
        contentType: "text/html",
        body: "Simulated OAuth redirect",
      });
    if (url.pathname === "/rest/v1/player_profiles")
      return reply(existing ? profile : null);
    if (url.pathname.endsWith("/ballers_home"))
      return reply({
        profile: existing ? profile : null,
        stats: {},
        communities: [],
        games: [],
        history: [],
      });
    if (url.pathname.endsWith("/ballers_network"))
      return reply({ preferences: {}, teams: [], inbox: [] });
    if (url.pathname.endsWith("/ballers_notification_feed"))
      return reply({ unread: 0, active: [], history: [] });
    if (url.pathname.endsWith("/ballers_player_stats"))
      return reply({
        matches: 0,
        goals: 0,
        assists: 0,
        saves: 0,
        test_matches: 0,
        test_goals: 0,
      });
    if (url.pathname.endsWith("/get_invite_by_token"))
      return reply([
        {
          invite_id: uid,
          token: uid,
          invite_type: "COMMUNITY",
          community_id: uid,
          community_name: "Weekend football",
          is_active: true,
        },
      ]);
    throw Error("Unhandled simulated request " + url.pathname);
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => state.errors.push(e.message));
  return { page, state, ctx };
}
async function shot(page, name) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "320px overflow",
  );
  if (process.env.TEST_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.TEST_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.TEST_ARTIFACT_DIR, name),
      fullPage: true,
    });
  }
}
async function send(s) {
  await s.page
    .getByLabel("Электронная почта", { exact: true })
    .fill("player@example.net");
  await s.page
    .getByRole("button", { name: "Получить код", exact: true })
    .click();
  await s.page.getByLabel("Код из письма", { exact: true }).waitFor();
}
try {
  {
    const s = await scenario();
    await s.page.goto(base);
    await s.page.getByLabel("Электронная почта", { exact: true }).waitFor();
    await shot(s.page, "signin-email-320.png");
    await send(s);
    assert.equal(s.state.sends.length, 1);
    assert.equal(s.state.sends[0].email, "player@example.net");
    assert.equal(
      await s.page
        .getByRole("button", { name: /Повторить через/ })
        .isDisabled(),
      true,
    );
    await s.page.getByLabel("Код из письма").fill("000000");
    await s.page.getByRole("button", { name: "Войти", exact: true }).click();
    await s.page
      .getByRole("alert")
      .filter({ hasText: "Код не подошёл" })
      .waitFor();
    assert.equal(
      await s.page
        .getByRole("button", { name: "Войти", exact: true })
        .isEnabled(),
      true,
    );
    await shot(s.page, "signin-code-error-320.png");
    await s.page.getByLabel("Код из письма").fill("123456");
    await s.page.getByRole("button", { name: "Войти", exact: true }).click();
    await s.page.waitForURL(base + "/onboarding");
    await s.page.getByLabel("Имя", { exact: true }).waitFor();
    assert.equal(await s.page.getByLabel("Год рождения").isVisible(), false);
    await shot(s.page, "onboarding-simple-320.png");
    await s.page.getByText("Дополнить профиль", { exact: true }).click();
    await s.page.getByLabel("Год рождения").waitFor();
    assert.equal(s.state.verifies[1].type, "email");
    assert.deepEqual(s.state.errors, []);
    assert.deepEqual(s.state.external, []);
    pass(
      "email code login: send, cooldown, invalid code, recovery, session and short onboarding",
    );
  }
  {
    const s = await scenario();
    await s.page.goto(base + "/join/" + uid);
    await send(s);
    // A reload reaches the same invite even if the server has to read the session again.
    const target = s.page.waitForRequest(
      (r) => r.isNavigationRequest() && r.url() === base + "/join/" + uid,
    );
    await s.page.getByLabel("Код из письма").fill("123456");
    await s.page.getByRole("button", { name: "Войти", exact: true }).click();
    await target;
    pass("email sign-in returns to the original invitation");
  }
  {
    const s = await scenario({ failSend: true });
    await s.page.goto(base);
    await s.page.getByLabel("Электронная почта").fill("player@example.net");
    await s.page
      .getByRole("button", { name: "Получить код", exact: true })
      .click();
    await s.page
      .getByRole("alert")
      .filter({ hasText: "Не удалось отправить код" })
      .waitFor();
    assert.equal(await s.page.getByLabel("Код из письма").count(), 0);
    assert.equal(
      await s.page
        .getByRole("button", { name: "Продолжить с Google" })
        .isEnabled(),
      true,
    );
    pass(
      "delivery errors keep Google available and do not claim a code was sent",
    );
  }
  {
    const s = await scenario({ delay: 25000 });
    await s.page.goto(base);
    await s.page.getByLabel("Электронная почта").fill("player@example.net");
    await s.page.clock.install();
    await s.page
      .getByRole("button", { name: "Получить код", exact: true })
      .click();
    await s.page.clock.runFor(21000);
    await s.page
      .getByRole("alert")
      .filter({ hasText: "Не удалось отправить код" })
      .waitFor();
    assert.equal(s.state.sends.length, 1);
    assert.equal(
      await s.page
        .getByRole("button", { name: "Продолжить с Google" })
        .isEnabled(),
      true,
    );
    pass(
      "stalled sends time out without duplicate requests or an endless disabled form",
    );
    await s.ctx.close();
  }
  {
    const s = await scenario({ locale: "kk" });
    await s.page.goto(base);
    await s.page.getByLabel("Электрондық пошта").fill("player@example.net");
    await s.page.getByRole("button", { name: "Код алу", exact: true }).click();
    await s.page.getByLabel("Хаттағы код").waitFor();
    await shot(s.page, "signin-code-kk-320.png");
    pass("Kazakh email and code UI fits 320px");
  }
  {
    const s = await scenario({ authenticated: true, existing: true });
    await s.page.goto(base);
    await s.page
      .getByRole("heading", { name: "Sanzhar", exact: true })
      .waitFor();
    assert.equal(await s.page.locator(".welcome-backdrop").count(), 0);
    assert.equal(await s.page.locator(".home-more").getAttribute("open"), null);
    const game = await s.page
      .getByRole("heading", { name: "Ближайший игровой день" })
      .boundingBox();
    const guide = await s.page
      .getByRole("button", { name: "Показать шаги", exact: true })
      .boundingBox();
    assert.ok(game && guide && game.y < guide.y);
    await shot(s.page, "home-simple-320.png");
    assert.deepEqual(s.state.errors, []);
    pass(
      "home puts the game before guidance, folds stats and opens without a welcome overlay",
    );
  }
  console.log(
    `RESULT: ${passed} sign-in and entry checks passed; simulated delivery, not live Supabase.`,
  );
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
}
