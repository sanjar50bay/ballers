import catalog from "../lib/i18n/catalog.json" with { type: "json" };
const testLocale = process.env.TEST_LOCALE === "kk" ? "kk" : "ru";
const text = (s) => catalog[s.trim()]?.[testLocale] ?? s;
// Local-only browser test: fake OAuth/PostgREST transport, real SQL and RLS in PGlite.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const db = new PGlite();
const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
await db.exec(
  `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;`,
);
for (const p of [
  "supabase/test_project_baseline.sql",
  "supabase/migrations/20261012_001_pre_match_safety.sql",
  "supabase/migrations/20261012_002_integrated_alpha.sql",
  "supabase/migrations/20261013_003_navigation_community.sql",
  "supabase/migrations/20261019_004_mobile_notifications.sql",
  "supabase/migrations/20261024_005_directory_teams.sql",
])
  await db.exec(read(p));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const community = id(1),
  game = id(2),
  userId = id(1001),
  player = id(2001);
await db.query("INSERT INTO auth.users(id) VALUES($1)", [userId]);
await db.query(
  `INSERT INTO player_profiles(id,user_id,first_name,display_name,primary_position,city) VALUES($1,$2,'Organizer','Organizer','MID','Astana')`,
  [player, userId],
);
await db.query(
  `INSERT INTO communities(id,name,city,created_by) VALUES($1,'Browser Pilot','Astana',$2)`,
  [community, userId],
);
await db.query(
  `INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')`,
  [community, player],
);
await db.query(
  `INSERT INTO game_days(id,community_id,sequence_number,title,game_date,start_time,venue,format,team_count,capacity,created_by) VALUES($1,$2,1,'Integrated Pilot','2099-10-12','20:00','Test Arena',5,3,15,$3)`,
  [game, community, userId],
);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [userId]);
await db.exec("SET ROLE authenticated");
await db.query("SELECT ballers_add_test_players($1,14)", [community]);
await db.query(
  `INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) SELECT $1,p.id,'INVITED','MEMBER' FROM player_profiles p JOIN community_members c ON c.player_id=p.id WHERE c.community_id=$2`,
  [game, community],
);
let queue = Promise.resolve();
const serial = (fn) => {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
};
const rpcArgs = {
  ballers_directory: ["p_kind","p_city","p_query","p_offset","p_free"],
  ballers_network: [],
  ballers_public_player: ["p_player"],
  ballers_home: [],
  ballers_notification_feed: [],
  ballers_start_match: ["p_game"],
  ballers_alpha_snapshot: ["p_game"],
  ballers_game_action: ["p_game", "p_action", "p_payload"],
  ballers_match_action: ["p_match", "p_version", "p_action", "p_payload"],
  ballers_set_attendance: ["p_game_id", "p_player_id", "p_status"],
  ballers_team_action: [
    "p_game_id",
    "p_expected_version",
    "p_action",
    "p_payload",
  ],
  ballers_mark_read: ["p_id"],
  ballers_player_stats: ["p_player"],
  ballers_squad_action: ["p_game", "p_action"],
  ballers_add_test_players: ["p_community", "p_count"],
  ballers_community_action: ["p_community", "p_action", "p_payload"],
  ballers_my_career: [],
  ballers_join_community_invite: ["p_token"],
  get_invite_by_token: ["invite_token"],
  ballers_open_games: [],
  ballers_join_open_game: ["p_game"],
};
const profileRows = async () =>
  (await db.query("SELECT * FROM player_profiles")).rows;
let failHome = false;
async function request(req) {
  const url = new URL(req.url());
  if (url.pathname === "/auth/v1/user") return user;
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = url.pathname.split("/").at(-1),
      keys = rpcArgs[name];
    assert.ok(keys, "Unknown RPC " + name);
    if (failHome && name === "ballers_home")
      throw new Error("Simulated offline");
    const p = req.postDataJSON() || {};
    const params = keys.map((k) =>
      typeof p[k] === "object" && p[k] !== null
        ? JSON.stringify(p[k])
        : (p[k] ?? null),
    );
    const r = await db.query(
      `SELECT public.${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) AS result`,
      params,
    );
    return r.rows[0].result;
  }
  const table = url.pathname.split("/").at(-1);
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  let rows;
  if (table === "player_profiles") {
    rows = await profileRows();
    if (url.searchParams.has("user_id"))
      rows = rows.filter(
        (p) => p.user_id === url.searchParams.get("user_id").slice(3),
      );
  } else if (table === "ballers_notifications")
    rows = (
      await db.query(
        "SELECT * FROM ballers_notifications ORDER BY created_at DESC,id LIMIT 40",
      )
    ).rows;
  else if (table === "ballers_waitlist")
    rows = (
      await db.query("SELECT * FROM ballers_waitlist WHERE game_day_id=$1", [
        game,
      ])
    ).rows;
  else if (table === "communities")
    rows = (
      await db.query("SELECT * FROM communities WHERE id=$1", [community])
    ).rows;
  else if (table === "game_days")
    rows = (await db.query("SELECT * FROM game_days WHERE id=$1", [game])).rows;
  else if (table === "game_day_teams") {
    assert.ok(
      url.searchParams
        .get("select")
        .includes("!game_day_team_players_team_id_fkey"),
    );
    const all = await profileRows();
    rows = (
      await db.query(
        "SELECT * FROM game_day_teams WHERE game_day_id=$1 ORDER BY sort_order",
        [game],
      )
    ).rows;
    for (const t of rows)
      t.game_day_team_players = (
        await db.query("SELECT * FROM game_day_team_players WHERE team_id=$1", [
          t.id,
        ])
      ).rows.map((a) => ({
        ...a,
        player_profiles: all.find((p) => p.id === a.player_id),
      }));
  } else if (table === "game_participants") {
    const all = await profileRows();
    rows = (
      await db.query("SELECT * FROM game_participants WHERE game_day_id=$1", [
        game,
      ])
    ).rows.map((a) => ({
      ...a,
      player_profiles: all.find((p) => p.id === a.player_id),
    }));
  } else if (table === "community_members") {
    const all = await profileRows();
    const communityRow = (
      await db.query("SELECT * FROM communities WHERE id=$1", [community])
    ).rows[0];
    rows = (
      await db.query("SELECT * FROM community_members WHERE community_id=$1", [
        community,
      ])
    ).rows.map((a) => ({
      ...a,
      player_profiles: all.find((p) => p.id === a.player_id),
      communities: communityRow,
    }));
    if (url.searchParams.has("player_id"))
      rows = rows.filter(
        (a) => a.player_id === url.searchParams.get("player_id").slice(3),
      );
  } else throw new Error("Unexpected REST table " + table);
  return single ? rows[0] : rows;
}
const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "browser-test@example.invalid",
  app_metadata: { provider: "google" },
  user_metadata: {},
  created_at: "2026-10-01T00:00:00Z",
};
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
  token =
    b64({ alg: "HS256", typ: "JWT" }) +
    "." +
    b64({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
      aud: "authenticated",
    }) +
    ".dummy";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
let passed = 0;
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (d) => {
    await d.accept(
      d.type() === "prompt"
        ? "Проверено менеджером в локальном тесте"
        : undefined,
    );
  });
  await ctx.addInitScript(
    ({ user, token }) =>
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
      ),
    { user, token },
  );
  await ctx.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }
    if (url.hostname !== "example.supabase.co") {
      await route.abort();
      return;
    }
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    try {
      const body = await serial(() => request(req));
      await route.fulfill({
        status: 200,
        headers,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.log("RPC/REST ERROR", e.message);
      await route.fulfill({
        status: 400,
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          code: e.code || "TEST_ERROR",
          message: e.message,
          details: null,
          hint: null,
        }),
      });
    }
  });
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3012";

  page.setDefaultTimeout(15000);
  await ctx.addInitScript(() =>
    localStorage.setItem("ballers:welcome:disabled", "true"),
  );
  const shot = async (name) => {
    await page.screenshot({
      path: new URL("../docs/" + name, import.meta.url).pathname,
      fullPage: false,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  };
  const pass = (message) => {
    console.log("PASS " + message);
    passed++;
  };
  await page.goto(`${base}/games/${game}/play`);
  await page
    .getByText(text("Участники и резерв"), { exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: text("Все участники → Иду") }).click();
  await page
    .getByText(text("Ответы обновлены. Проверьте пул и очередь."))
    .waitFor();
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM game_participants WHERE attendance_status='GOING'",
      )
    ).rows[0].n,
    15,
  );
  pass("UI bulk attendance uses authorized SQL for 15 players");
  await page
    .getByRole("link", { name: text("← Составы и приглашения") })
    .click();
  await page.getByRole("button", { name: text("Build Teams") }).click();
  await page.getByRole("button", { name: /Перемешать/ }).click();
  await page
    .getByText(/Состав: 5\/5/)
    .first()
    .waitFor();
  pass("existing Team Builder remains functional");
  await page.getByRole("link", { name: /Игровой центр:/ }).click();
  await page
    .locator("summary")
    .filter({ hasText: text("Капитаны и ответственные") })
    .click();
  for (const name of ["Blue", "Red", "Yellow"])
    await page
      .getByRole("button", { name: text("Сохранить роли") + " " + name })
      .click();
  await page
    .locator("summary")
    .filter({ hasText: text("Правила новых матчей") })
    .click();
  await page
    .getByRole("button", { name: text("Сохранить правила"), exact: true })
    .click();
  await page.getByRole("button", { name: text("Начать первый матч") }).click();
  await page.getByText(/Матч #1 · Идёт матч/).waitFor();
  pass("START saves default pair atomically without separate LINEUP click");
  await page.getByRole("button", { name: text("Пауза"), exact: true }).click();
  await page
    .getByRole("button", { name: text("Продолжить"), exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: text("Продолжить"), exact: true })
    .click();
  pass("session and paused server timer survive reload");
  await page.getByRole("button", { name: text("Записать событие") }).click();
  await page.getByText("1:0", { exact: true }).waitFor();
  await page.getByRole("button", { name: text("Записать событие") }).click();
  await page
    .getByRole("button", { name: text("Подтвердить тест с причиной") })
    .click();
  await page.getByText("Подтверждён · тест", { exact: true }).waitFor();
  assert.equal(
    (await db.query("SELECT status FROM ballers_matches")).rows[0].status,
    "VERIFIED",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM ballers_notifications WHERE match_id IS NOT NULL AND completed_at IS NULL",
      )
    ).rows[0].n,
    0,
  );
  pass(
    "test resolution verifies result and retires linked confirmation requests",
  );
  await page
    .getByRole("button", { name: text("Начать следующий матч") })
    .click();
  await page.getByText(/Матч #2 · Идёт матч/).waitFor();
  await page
    .getByRole("button", { name: text("Завершить матч"), exact: true })
    .click();
  await page
    .getByRole("button", { name: text("Завершить матч"), exact: true })
    .waitFor({ state: "hidden" });
  await page.goto(`${base}/my-game`);
  await page
    .getByRole("heading", { name: text("Твоя игра"), exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: text("Завершить игровой день"), exact: true })
    .click();
  await page
    .getByText(text("Игровой день завершён. Результаты сохранены в истории."))
    .waitFor();
  assert.equal(
    (await db.query("SELECT status FROM game_days WHERE id=$1", [game])).rows[0]
      .status,
    "COMPLETED",
  );
  pass("second match and explicit day completion preserve pending results");
  await shot("release-history-mobile.png");
  await page
    .getByRole("link", { name: text("Результаты и подтверждения →") })
    .click();
  await page.locator("#results").waitFor();
  await page
    .getByRole("button", { name: text("Подтвердить тест с причиной") })
    .click();
  await page.getByText("Подтверждён · тест", { exact: true }).first().waitFor();
  pass("pending result can be resolved after day closed");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("release-center-mobile.png");
  const stats = (
    await db.query("SELECT ballers_player_stats($1) result", [player])
  ).rows[0].result;
  assert.equal(stats.matches, 0);
  pass("test results never enter real career statistics");
  // Create a new upcoming day, using the same real SQL API rather than fake UI data.
  const next = (
    await db.query(
      "SELECT ballers_create_game_day($1,'2099-10-18','21:00','Anfield',5,3,15) id",
      [community],
    )
  ).rows[0].id;
  await db.query("SELECT ballers_set_attendance($1,$2,$3)", [
    next,
    player,
    "GOING",
  ]);
  await db.query(
    "INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) SELECT $1,p.id,'INVITED','MEMBER' FROM player_profiles p JOIN community_members cm ON cm.player_id=p.id WHERE cm.community_id=$2 AND p.id<>$3",
    [next, community, player],
  );
  for (const r of (
    await db.query(
      "SELECT player_id FROM game_participants WHERE game_day_id=$1",
      [next],
    )
  ).rows)
    await db.query("SELECT ballers_set_attendance($1,$2,$3)", [
      next,
      r.player_id,
      "GOING",
    ]);
  for (const action of ["BUILD", "RANDOMIZE"])
    await db.query(
      "SELECT ballers_team_action($1,(SELECT roster_version FROM game_days WHERE id=$1),$2,$3)",
      [next, action, "{}"],
    );
  await page.goto(base + "/");
  await page
    .getByRole("heading", { name: text("Ближайший игровой день"), exact: true })
    .waitFor();
  await page
    .getByText("Baller #1 · Astana · Полузащитник", { exact: true })
    .waitFor();
  await shot("release-home-mobile.png");
  pass("compact home displays upcoming day with persisted session");
  await page.locator(".stats-disclosure summary").click();
  await page.getByText(/В тестах:/).waitFor();
  await shot("release-stats-mobile.png");
  await page.locator(".stats-disclosure summary").click();
  await page.getByRole("button", { name: /^Уведомления/ }).click();
  await page.getByRole("dialog", { name: text("Уведомления") }).waitFor();
  await page
    .getByRole("button", { name: text("История"), exact: true })
    .click();
  await shot("release-notifications-mobile.png");
  await page.getByRole("button", { name: text("Закрыть уведомления") }).click();
  pass("single top bell exposes completed notification history");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Игра"), exact: true })
    .click();
  await page
    .getByRole("button", { name: text("Возможно"), exact: true })
    .click();
  await page.getByText(text("Ответ сохранён.")).waitFor();
  assert.equal(
    (
      await db.query(
        "SELECT attendance_status FROM game_participants WHERE game_day_id=$1 AND player_id=$2",
        [next, player],
      )
    ).rows[0].attendance_status,
    "MAYBE",
  );
  await page.getByRole("button", { name: text("✓ Иду"), exact: true }).click();
  await page.getByText(text("Ответ сохранён.")).waitFor();
  await shot("release-game-mobile.png");
  await page.locator(".team-row summary").first().click();
  await shot("release-team-expanded-mobile.png");
  pass("game tab attendance is saved and shared with home");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Профиль"), exact: true })
    .click();
  await page.getByRole("heading", { name: text("Твой Baller ID") }).waitFor();
  await shot("release-profile-mobile.png");
  await page.getByRole("link", { name: text("Моя история матчей →") }).click();
  await page.getByRole("heading", { name: text("История матчей") }).waitFor();
  pass("profile has direct personal match history");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Найти"), exact: true })
    .click();
  await page.getByRole("heading", {name:text("Найти"),exact:true}).waitFor();
  await page.getByRole("button",{name:text("Сообщества"),exact:true}).click();
  await page.getByText("Browser Pilot",{exact:true}).waitFor();
  await shot("release-communities-mobile.png");
  pass("discovery navigation preserves access to city communities");
  await page.getByRole("link", { name: text("Создать"), exact: true }).click();
  await page
    .getByRole("heading", { name: text("Игровой день"), exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: text("Создать игровой день →"), exact: true })
    .click();
  await page.waitForURL("**/game-days/create");
  pass("header plus preserves authorized game creation");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(base + "/");
  await page
    .getByRole("heading", { name: text("Ближайший игровой день") })
    .waitFor();
  await shot("release-home-desktop.png");
  pass("desktop home has no horizontal overflow");
  // Welcome card: enable explicitly in a separate context; original settings remain isolated.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem("ballers:welcome:disabled", "false");
    for (const k of Object.keys(localStorage))
      if (k.startsWith("ballers:welcome:") && k !== "ballers:welcome:disabled")
        localStorage.removeItem(k);
  });
  // Manual profile preview is available even when automatic entry is disabled.
  await page.goto(base + "/profile");
  await page.evaluate(() => {
    localStorage.setItem("ballers:welcome:disabled", "false");
    for (const k of Object.keys(localStorage))
      if (k.startsWith("ballers:welcome:") && k !== "ballers:welcome:disabled")
        localStorage.removeItem(k);
  });
  await page
    .getByRole("button", { name: text("Показать мою карточку") })
    .click();
  await page
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor();
  await page.waitForTimeout(1300);
  await shot("release-welcome-mobile.png");
  await page.getByRole("button", { name: /Скрыть карточку/ }).click();
  await page
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor({ state: "hidden" });
  pass(
    "player-card profile preview is skippable and uses verified profile data",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Главная"), exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Профиль"), exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Главная"), exact: true })
    .click();
  await page.waitForTimeout(300);
  assert.equal(
    await page
      .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
      .count(),
    0,
  );
  pass("welcome does not repeat on every home navigation");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: text("Профиль"), exact: true })
    .click();
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("ballers:welcome:") && k !== "ballers:welcome:disabled")
        localStorage.removeItem(k);
  });
  await page
    .getByRole("button", { name: text("Показать мою карточку") })
    .click();
  await page
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor();
  await page
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor({ state: "hidden", timeout: 6500 });
  pass("welcome automatically exits after five seconds");
  // Empty inbox state is still usable and does not disable the bell.
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM ballers_notifications WHERE player_id=$1", [
    player,
  ]);
  await db.exec("SET ROLE authenticated");
  await page.reload();
  await page.getByRole("button", { name: /^Уведомления/ }).click();
  await page
    .getByText(text("Всё прочитано. Нет незавершённых запросов."))
    .waitFor();
  await shot("release-inbox-empty-mobile.png");
  await page.keyboard.press("Escape");
  assert.match(
    await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") || "",
    ),
    /^Уведомления/,
  );
  pass("empty inbox, Escape and focus restoration work");
  // Error and empty-game states are exercised without touching external services.
  await db.query("SELECT ballers_game_action($1,'CLOSE','{}')", [next]);
  await page.goto(base + "/my-game");
  await page
    .getByRole("heading", { name: text("Пока нет ближайшей игры") })
    .waitFor();
  await shot("release-game-empty-mobile.png");
  pass("completed days never masquerade as upcoming days");
  for (const route of ["/", "/my-game", "/profile", "/communities"]) {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(base + route);
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  pass("navigation and content have no horizontal overflow at 320px");
  await page.setViewportSize({ width: 390, height: 844 });
  failHome = true;
  await page.goto(base + "/");
  await page
    .getByRole("button", { name: text("Повторить загрузку"), exact: true })
    .waitFor();
  await shot("release-error-mobile.png");
  failHome = false;
  await page
    .getByRole("button", { name: text("Повторить загрузку"), exact: true })
    .click();
  await page
    .getByRole("heading", { name: text("Ближайший игровой день"), exact: true })
    .waitFor();
  pass("failed home load has a working retry instead of an endless spinner");
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const login = await guest.newPage();
  await guest.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await login.goto(base + "/");
  await login
    .getByRole("button", { name: text("Продолжить с Google"), exact: true })
    .waitFor();
  assert.equal(
    await login.getByRole("button", { name: /Apple|VK/ }).count(),
    0,
  );
  await login.screenshot({
    path: new URL("../docs/release-login-mobile.png", import.meta.url).pathname,
    fullPage: false,
  });
  await login.getByLabel(text("Язык интерфейса")).selectOption("kk");
  await login
    .getByRole("button", { name: "Google арқылы жалғастыру", exact: true })
    .waitFor();
  await login.reload();
  await login
    .getByRole("button", { name: "Google арқылы жалғастыру", exact: true })
    .waitFor();
  assert.equal(await login.locator("html").getAttribute("lang"), "kk");
  await login.screenshot({
    path: new URL("../docs/release-025-login-kk.png", import.meta.url).pathname,
  });
  pass("Kazakh is selectable before login and persists after reload");
  await guest.close();
  pass("unconfigured Apple and VK providers are not falsely offered on login");

  // Kazakh labels across every route family. User-generated names must stay intact.
  await page.goto(base + "/");
  await page.getByLabel(text("Язык интерфейса")).selectOption("kk");
  await page
    .getByRole("heading", { name: "Ең жақын ойын күні", exact: true })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "kk");
  assert.ok((await page.textContent("body")).includes("Organizer"));
  const routes = [
    ["/", "Ең жақын ойын күні"],
    ["/my-game", "Сенің ойының"],
    ["/communities", "Қауымдастықтар"],
    ["/create", "Ойын күні"],
    ["/communities/create", "Қауымдастық құру"],
    [`/communities/${community}`, "Қауымдастыққа шолу"],
    [`/communities/${community}/game-days/create`, "Жаңа ойын күні"],
    [`/communities/${community}/games`, "Ойын күндері"],
    [`/communities/${community}/game-days/${game}`, "Командалар"],
    [`/games/${game}/play`, "Ойын орталығы"],
    ["/open-games", "Ашық ойындар"],
    ["/career", "Матчтар тарихы"],
    ["/profile", "Сенің Baller ID"],
    ["/profile/edit", "Профильді өңдеу"],
    [`/players/${player}`, "Baller ID"],
  ];
  for (const [path, label] of routes) {
    await page.goto(base + path);
    await page
      .getByText(label, { exact: true })
      .first()
      .waitFor({ timeout: 15000 });
    assert.equal(
      await page.locator("#interface-language").inputValue(),
      "kk",
      path,
    );
    assert.ok(
      !(await page.textContent("body")).match(
        /Create Community|First name|Will you attend|Loading player|Save changes|Invite Members/,
      ),
      path,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      path + " overflow",
    );
  }
  pass(
    "15 route families have Kazakh labels, persistent choice and no horizontal overflow",
  );
  await page.goto(base + "/");
  await page
    .getByRole("heading", { name: "Ең жақын ойын күні", exact: true })
    .waitFor();
  await page.screenshot({
    path: new URL("../docs/release-025-home-kk.png", import.meta.url).pathname,
  });
  await page.getByRole("button", { name: /^Хабарландырулар/ }).click();
  await page.getByText("Бәрі оқылды. Аяқталмаған сұраулар жоқ.").waitFor();
  await page.keyboard.press("Escape");
  pass("Kazakh notifications and empty-state are localized");
  await page.goto(base + "/profile");
  await page.getByRole("button", { name: "Менің карточкамды көрсету" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: new URL("../docs/release-025-card-kk.png", import.meta.url).pathname,
  });
  await page.keyboard.press("Escape");
  await page.getByLabel("Интерфейс тілі").selectOption("ru");
  await page
    .getByRole("heading", { name: text("Твой Baller ID"), exact: true })
    .waitFor();
  pass("switching back restores Russian without changing user names");
  // A fresh document can show the card after a 30-minute absence, not on every route.
  const state = await ctx.storageState();
  const stored = state.origins.find((o) => o.origin === base).localStorage;
  for (const key of ["ballers:welcome:disabled", `ballers:welcome:${player}`]) {
    const i = stored.findIndex((x) => x.name === key);
    if (i >= 0) stored.splice(i, 1);
  }
  stored.push(
    { name: "ballers:welcome:disabled", value: "false" },
    {
      name: `ballers:welcome:${player}`,
      value: String(Date.now() - 31 * 60 * 1000),
    },
  );
  const returnCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: state,
  });
  await returnCtx.route("https://example.supabase.co/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        },
      });
    try {
      const data = await serial(() => request(route.request()));
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        json: data,
      });
    } catch (e) {
      await route.fulfill({ status: 400, json: { message: e.message } });
    }
  });
  const returned = await returnCtx.newPage();
  await returned.goto(base + "/");
  await returned
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor();
  await returned.keyboard.press("Escape");
  await returned.reload();
  await returned
    .getByRole("heading", { name: text("Ближайший игровой день"), exact: true })
    .waitFor();
  assert.equal(
    await returned
      .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
      .count(),
    0,
  );
  await returned.evaluate(
    (id) =>
      localStorage.setItem(
        `ballers:welcome:${id}`,
        String(Date.now() - 31 * 60 * 1000),
      ),
    player,
  );
  await returned.reload();
  await returned
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor();
  await returned
    .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
    .waitFor({ state: "hidden", timeout: 6500 });
  pass(
    "automatic card returns after 30-minute cooldown, suppresses immediate reload and exits after 5 seconds",
  );
  await returned.emulateMedia({ reducedMotion: "reduce" });
  await returned.evaluate(
    (id) =>
      localStorage.setItem(
        `ballers:welcome:${id}`,
        String(Date.now() - 31 * 60 * 1000),
      ),
    player,
  );
  await returned.reload();
  await returned
    .getByRole("heading", { name: text("Ближайший игровой день"), exact: true })
    .waitFor();
  assert.equal(
    await returned
      .getByRole("dialog", { name: text("Твой Baller ID"), exact: true })
      .count(),
    0,
  );
  await returned.goto(base + "/profile");
  await returned
    .getByRole("button", { name: text("Показать мою карточку") })
    .click();
  assert.equal(
    await returned
      .locator(".collectible-card")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await returned.keyboard.press("Escape");
  pass("reduced motion disables auto card and keeps manual preview static");
  await returnCtx.close();

  assert.deepEqual(errors, []);
  await ctx.close();
  console.log(
    `RESULT: ${passed} browser checks passed. Real isolated PostgreSQL RPCs; OAuth and network transport simulated, not live Supabase.`,
  );
} finally {
  await browser.close();
  await db.close();
}
