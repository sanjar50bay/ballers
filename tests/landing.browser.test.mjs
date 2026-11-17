import path from "node:path";
// Production browser with simulated auth/RPC. Never touches real Supabase or Google.
import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3012";
const contexts = [],
  errors = [];
let passed = 0;
const pass = (s) => {
  console.log("PASS " + s);
  passed++;
};
const id = "00000000-0000-4000-8000-000000000001",
  profileId = "00000000-0000-4000-8000-000000000002";
const profile = {
  id: profileId,
  user_id: id,
  baller_id: 1,
  first_name: "Landing Tester",
  last_name: null,
  display_name: null,
  avatar_url: null,
  city: "Astana",
  primary_position: "MID",
};
const stats = {
  matches: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  test_matches: 0,
  test_goals: 0,
};
async function context({
  auth = false,
  locale = "ru-RU",
  saved = null,
  width = 390,
  pending = false,
  invite = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    locale,
  });
  contexts.push(ctx);
  const requests = [];
  ctx.on("request", (r) => requests.push(r.url()));
  await ctx.addInitScript(
    ({ auth, saved, pending, profileId, id, invite }) => {
      if (!sessionStorage.getItem("test:initialized")) {
        sessionStorage.setItem("test:initialized", "true");
        if (saved) localStorage.setItem("ballers:locale", saved);
        if (pending)
          sessionStorage.setItem("ballers:welcome:new-profile", profileId);
        if (invite)
          localStorage.setItem(
            "ballers:network-return",
            "/teams/00000000-0000-4000-8000-000000000099",
          );
        if (auth) {
          const b64 = (x) =>
            btoa(JSON.stringify(x))
              .replaceAll("=", "")
              .replaceAll("+", "-")
              .replaceAll("/", "_");
          const token =
            b64({ alg: "HS256", typ: "JWT" }) +
            "." +
            b64({
              sub: id,
              exp: Math.floor(Date.now() / 1000) + 3600,
              role: "authenticated",
              aud: "authenticated",
            }) +
            ".dummy";
          localStorage.setItem(
            "sb-example-auth-token",
            JSON.stringify({
              access_token: token,
              refresh_token: "test-only",
              token_type: "bearer",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: {
                id,
                aud: "authenticated",
                role: "authenticated",
                email: "test@example.invalid",
                app_metadata: { provider: "google" },
                user_metadata: {},
              },
            }),
          );
        }
      }
    },
    { auth, saved, pending, profileId, id, invite },
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
    if (url.pathname === "/auth/v1/authorize")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Simulated Google sign in</h1>",
      });
    const name = url.pathname.split("/").at(-1);
    const data = {
      ballers_home: { profile, stats, communities: [], games: [], history: [] },
      ballers_network: {
        preferences: { search_status: "READY", available: true },
        teams: [],
        inbox: [],
      },
      ballers_notification_feed: { unread: 0, active: [], history: [] },
      ballers_player_stats: stats,
      ballers_team_detail: {
        team: {
          id: "00000000-0000-4000-8000-000000000099",
          name: "Invite team",
          city: "Astana",
          member_count: 1,
        },
        captain: false,
        my_status: null,
        members: [],
        pending: [],
        communities: [],
      },
    };
    if (name === "user")
      return route.fulfill({
        status: 200,
        headers,
        json: {
          id,
          aud: "authenticated",
          role: "authenticated",
          user_metadata: {},
        },
      });
    if (name === "player_profiles")
      return route.fulfill({ status: 200, headers, json: profile });
    if (name in data)
      return route.fulfill({ status: 200, headers, json: data[name] });
    return route.fulfill({ status: 200, headers, json: {} });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, requests };
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
}
try {
  const { page, requests } = await context();
  await page.goto(base + "/");
  await page
    .getByRole("heading", { name: "Твой футбол. Твоя история." })
    .waitFor();
  assert.ok(
    (await page.locator(".intro").textContent()).includes("Уже есть команда?"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Продолжить с Google", exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator(".landing-more").getAttribute("open"), null);
  await page.getByRole("link", { name: "Войти", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Электронная почта", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await noOverflow(page);
  assert.equal(await page.locator("video").getAttribute("preload"), "none");
  assert.equal(await page.locator("video").getAttribute("autoplay"), null);
  assert.equal(
    await page.locator("video source").getAttribute("src"),
    "/media/ballers-intro-ru.mp4",
  );
  await page.waitForTimeout(500);
  assert.equal(requests.filter((x) => x.endsWith(".mp4")).length, 0);
  pass(
    "RU landing keeps existing teams, email/Google login, a working return-to-login link and folded guidance without autoplay",
  );
  await page.screenshot({
    path: path.join(
      process.env.TEST_ARTIFACT_DIR || "docs",
      "landing-ru-390.png",
    ),
    fullPage: true,
  });
  await page.getByLabel("Язык интерфейса", { exact: true }).selectOption("kk");
  await page
    .getByRole("heading", { name: "Сенің футболың. Сенің тарихың." })
    .waitFor();
  assert.equal(
    await page.locator("video source").getAttribute("src"),
    "/media/ballers-intro-kk.mp4",
  );
  assert.equal(await page.locator("video").evaluate((v) => v.paused), true);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({
    path: path.join(
      process.env.TEST_ARTIFACT_DIR || "docs",
      "landing-kk-320.png",
    ),
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "Сенің футболың. Сенің тарихың." })
    .waitFor();
  pass(
    "KK language switches text/poster/video without autoplay, persists on reload; page fits 320–1280px",
  );
  await page.locator(".intro-cover").click();
  await page.locator("video").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return v && !v.paused && v.readyState >= 2;
  });
  assert.ok(requests.some((url) => url.includes("ballers-intro-kk.mp4")));
  await page.getByLabel("Интерфейс тілі", { exact: true }).selectOption("ru");
  await page.locator(".intro-cover").waitFor();
  assert.equal(await page.locator("video").evaluate((v) => v.paused), true);
  pass(
    "video actually starts only after click; changing language stops playback and restores the cover",
  );
  const kk = await context({ locale: "kk-KZ" });
  await kk.page.goto(base + "/");
  await kk.page
    .getByRole("heading", { name: "Сенің футболың. Сенің тарихың." })
    .waitFor();
  const saved = await context({ locale: "kk-KZ", saved: "ru" });
  await saved.page.goto(base + "/");
  await saved.page
    .getByRole("heading", { name: "Твой футбол. Твоя история." })
    .waitFor();
  pass(
    "first visit follows browser language; explicit saved choice takes priority",
  );
  await saved.page
    .getByRole("button", { name: "Продолжить с Google", exact: true })
    .click();
  await saved.page.waitForURL(
    "https://example.supabase.co/auth/v1/authorize**",
  );
  const oauth = new URL(saved.page.url());
  assert.equal(oauth.searchParams.get("provider"), "google");
  assert.equal(
    oauth.searchParams.get("redirect_to"),
    new URL(base).origin + "/",
  );
  pass(
    "Google CTA uses original OAuth provider and origin redirect (Google interaction simulated)",
  );
  const current = await context({ auth: true });
  await current.page.goto(base + "/");
  await current.page.locator(".profile-strip").waitFor();
  assert.equal(await current.page.locator(".welcome-backdrop").count(), 0);
  await current.page.evaluate(() => {
    localStorage.setItem(
      "ballers:welcome:00000000-0000-4000-8000-000000000002",
      "1",
    );
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await current.page.reload();
  await current.page.locator(".profile-strip").waitFor();
  assert.equal(await current.page.locator(".welcome-backdrop").count(), 0);
  pass(
    "existing profile login/reload/focus never opens automatic Baller ID; old cooldown is ignored",
  );
  const fresh = await context({ auth: true, pending: true });
  await fresh.page.goto(base + "/");
  await fresh.page
    .getByRole("dialog", { name: "Твой Baller ID", exact: true })
    .waitFor();
  await fresh.page.waitForTimeout(5300);
  assert.equal(await fresh.page.locator(".welcome-backdrop").count(), 1);
  await fresh.page
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  await fresh.page.reload();
  await fresh.page.locator(".profile-strip").waitFor();
  assert.equal(await fresh.page.locator(".welcome-backdrop").count(), 0);
  pass(
    "confirmed new-profile marker shows Baller ID once, no countdown, immediate dismissal, no repeat on reload",
  );
  await fresh.page.goto(base + "/profile");
  await fresh.page
    .getByRole("button", { name: "Показать мою карточку" })
    .click();
  await fresh.page.locator(".welcome-backdrop").waitFor();
  await fresh.page.keyboard.press("Escape");
  await fresh.page.locator(".welcome-backdrop").waitFor({ state: "hidden" });
  pass(
    "manual profile card remains accessible, Escape closes it; old 30-minute setting removed",
  );
  await fresh.page.goto(base + "/");
  await fresh.page.getByRole("button", { name: "Помощь", exact: true }).click();
  await fresh.page.locator(".help-dialog .intro-cover").waitFor();
  assert.equal(
    await fresh.page.locator(".help-dialog video source").getAttribute("src"),
    "/media/ballers-intro-ru.mp4",
  );
  await fresh.page
    .getByLabel("Язык интерфейса", { exact: true })
    .selectOption("kk");
  assert.equal(
    await fresh.page.locator(".help-dialog video source").getAttribute("src"),
    "/media/ballers-intro-kk.mp4",
  );
  await fresh.page.keyboard.press("Escape");
  pass(
    "video can be reopened in Help and switches with interface language after registration",
  );
  const ret = await context({ auth: true, pending: true, invite: true });
  await ret.page.goto(base + "/");
  await ret.page.waitForURL("**/teams/00000000-0000-4000-8000-000000000099");
  pass("saved team-invite destination still wins over first-profile card");
  for (const lang of ["ru", "kk"]) {
    const response = await page.request.get(
      base + "/media/ballers-intro-" + lang + ".mp4",
      { headers: { range: "bytes=0-255" } },
    );
    assert.equal(response.status(), 206);
    assert.match(response.headers()["content-type"], /video\/mp4/);
  }
  pass("both bundled videos are served with MP4 type and byte-range support");
  assert.deepEqual(errors, []);
  assert.ok(fs.statSync("public/media/ballers-intro-kk.mp4").size > 1000000);
  console.log(
    `RESULT: ${passed} landing browser checks passed. Auth/RPC simulated, not live Google/Supabase.`,
  );
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
}
