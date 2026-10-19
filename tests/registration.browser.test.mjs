// Local PostgreSQL/RLS + real browser; OAuth/PostgREST transport simulated.
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
  "supabase/migrations/20261012_001_pre_match_safety.sql",
  "supabase/migrations/20261012_002_integrated_alpha.sql",
  "supabase/migrations/20261013_003_navigation_community.sql",
  "supabase/migrations/20261019_004_mobile_notifications.sql",
])
  await db.exec(read(p));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let tail = Promise.resolve(),
  sequence = 0,
  passed = 0;
const serial = (fn) => {
  const n = tail.then(fn);
  tail = n.catch(() => {});
  return n;
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3012";
const buggy = process.env.EXPECT_BUG === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (msg) => {
  console.log("PASS " + msg);
  passed++;
};
async function scenario(options = {}) {
  const uid = id(++sequence + 9000);
  await serial(async () => {
    await db.exec("RESET ROLE");
    await db.query("INSERT INTO auth.users VALUES($1)", [uid]);
  });
  const inviteToken = id(12000 + sequence),
    communityId = id(13000 + sequence);
  if (options.invite)
    await serial(async () => {
      await db.exec("RESET ROLE");
      await db.query(
        "INSERT INTO communities(id,name,city,created_by) VALUES($1,'Registration Invite','Astana',$2)",
        [communityId, uid],
      );
      await db.query(
        "INSERT INTO invites(token,invite_type,community_id,created_by,max_uses) VALUES($1,'COMMUNITY',$2,$3,10)",
        [inviteToken, communityId, uid],
      );
    });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const user = {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email: "registration-test@example.invalid",
    app_metadata: { provider: "google" },
    user_metadata: {},
    created_at: "2026-10-01T00:00:00Z",
  };
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const token =
    b64({ alg: "HS256", typ: "JWT" }) +
    "." +
    b64({
      sub: uid,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
      aud: "authenticated",
    }) +
    ".dummy";
  if (!options.anonymous)
    await ctx.addInitScript(
      ({ user, token }) => {
        localStorage.setItem(
          "sb-example-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "test-only",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user,
          }),
        );
        localStorage.setItem("ballers:welcome:disabled", "true");
      },
      { user, token },
    );
  const state = {
    posts: 0,
    reads: 0,
    homes: 0,
    dialogs: [],
    pageErrors: [],
    failReads: false,
    mode: options.mode || "normal",
  };
  const profile = () =>
    serial(async () => {
      await db.exec("RESET ROLE");
      return (
        await db.query("SELECT * FROM player_profiles WHERE user_id=$1", [uid])
      ).rows[0];
    });
  const insert = (first) =>
    serial(async () => {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
        uid,
      ]);
      await db.exec("SET ROLE authenticated");
      return (
        await db.query(
          "INSERT INTO player_profiles(user_id,first_name,city,primary_position,dominant_foot) VALUES($1,$2,'Astana','MID','RIGHT') RETURNING *",
          [uid, first],
        )
      ).rows[0];
    });
  if (options.existing) await insert("Original");
  await ctx.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "127.0.0.1") {
      if (options.invite && url.pathname === "/communities/" + communityId)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<h1>Invite destination</h1>",
        });
      return route.continue();
    }
    if (url.hostname !== "example.supabase.co") return route.abort();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    const respond = (status, body) =>
      route.fulfill({
        status,
        headers,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (url.pathname === "/auth/v1/user") return respond(200, user);
    try {
      if (url.pathname === "/rest/v1/player_profiles") {
        if (req.method() === "POST") {
          state.posts++;
          const input = req.postDataJSON();
          if (state.mode === "slow") await sleep(1800);
          if (state.mode === "race") {
            state.mode = "normal";
            await insert("Other tab");
          }
          if (state.mode === "lost-unread") {
            await insert(input.first_name);
            state.mode = "normal";
            state.failReads = true;
            return route.abort("failed");
          }
          if (state.mode === "foreign-conflict")
            return respond(409, {
              code: "23505",
              message: "duplicate key violates some_other_constraint",
            });
          if (state.mode === "forbidden")
            return respond(403, {
              code: "42501",
              message: "new row violates row-level security policy",
            });
          const row = await serial(async () => {
            await db.exec("RESET ROLE");
            await db.query(
              "SELECT set_config('request.jwt.claim.sub',$1,false)",
              [uid],
            );
            await db.exec("SET ROLE authenticated");
            const keys = Object.keys(input);
            assert.ok(keys.every((k) => /^[a-z_]+$/.test(k)));
            return (
              await db.query(
                `INSERT INTO player_profiles(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
                Object.values(input),
              )
            ).rows[0];
          });
          if (state.mode === "lost") {
            state.mode = "normal";
            return route.abort("failed");
          }
          if (state.mode === "timeout") {
            state.mode = "normal";
            await sleep(17000);
          }
          return respond(
            201,
            (req.headers().accept || "").includes("vnd.pgrst.object")
              ? row
              : [row],
          );
        }
        state.reads++;
        if (state.failReads)
          return respond(503, {
            code: "OFFLINE",
            message: "Network unavailable",
          });
        assert.equal(
          url.searchParams.get("user_id"),
          "eq." + uid,
          "read must be own account",
        );
        const row = await profile();
        return respond(
          200,
          (req.headers().accept || "").includes("vnd.pgrst.object")
            ? row || null
            : row
              ? [row]
              : [],
        );
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").at(-1);
        assert.ok(
          [
            "ballers_home",
            "ballers_notification_feed",
            "ballers_player_stats",
            "get_invite_by_token",
            "ballers_join_community_invite",
          ].includes(name),
          "unexpected RPC " + name,
        );
        if (name === "ballers_home") state.homes++;
        const args =
          name === "ballers_player_stats"
            ? [req.postDataJSON().p_player]
            : name === "get_invite_by_token"
              ? [req.postDataJSON().invite_token]
              : name === "ballers_join_community_invite"
                ? [req.postDataJSON().p_token]
                : [];
        const data = await serial(async () => {
          await db.exec("RESET ROLE");
          await db.query(
            "SELECT set_config('request.jwt.claim.sub',$1,false)",
            [uid],
          );
          await db.exec("SET ROLE authenticated");
          if (name === "get_invite_by_token")
            return (
              await db.query("SELECT * FROM get_invite_by_token($1)", args)
            ).rows;
          return (
            await db.query(
              `SELECT ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
              args,
            )
          ).rows[0].result;
        });
        return respond(200, data);
      }
      throw Error("Unhandled " + url.pathname);
    } catch (e) {
      return respond(e.code === "23505" ? 409 : 400, {
        code: e.code || "TEST_ERROR",
        message: e.message,
        details: null,
        hint: null,
      });
    }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", async (d) => {
    state.dialogs.push(d.message());
    await d.accept();
  });
  page.on("pageerror", (e) => state.pageErrors.push(e.message));
  const open = () => page.goto(base + "/onboarding");
  const fill = async () => {
    if (buggy)
      await page
        .getByPlaceholder("First name", { exact: true })
        .fill("New Player");
    else await page.getByLabel("Имя", { exact: true }).fill("New Player");
  };
  const submit = () =>
    page.getByRole("button", {
      name: buggy ? "Create Baller profile" : "Создать профиль",
      exact: true,
    });
  const home = () =>
    page
      .getByRole("heading", {
        name: options.existing ? "Original" : /New Player|Other tab/,
      })
      .waitFor();
  return {
    ctx,
    page,
    state,
    profile,
    open,
    fill,
    submit,
    home,
    insert,
    inviteToken,
    communityId,
    uid,
  };
}
try {
  if (buggy) {
    const s = await scenario();
    await s.page.goto(base);
    await s.page.waitForURL("**/onboarding");
    await s.fill();
    await s.submit().click();
    await s.page.waitForTimeout(1800);
    assert.ok(await s.profile(), "profile committed");
    assert.ok(
      s.page.url().endsWith("/onboarding"),
      "stale home state returned to onboarding",
    );
    await s.fill();
    await s.submit().click();
    await s.page.waitForTimeout(600);
    assert.ok(
      s.state.dialogs.some((x) => x.includes("player_profiles_user_id_key")),
    );
    pass(
      "REPRODUCED 0.2.3: successful INSERT -> stale home -> onboarding -> duplicate user_id on retry",
    );
    await s.ctx.close();
  } else {
    for (const mode of ["normal", "slow", "lost", "timeout", "race"]) {
      const s = await scenario({ mode });
      await s.page.goto(base);
      await s.page.waitForURL("**/onboarding");
      await s.fill();
      // Two synchronous submit events also exercise the ref lock, not just disabled rendering.
      await s.page.locator("form").evaluate((form) => {
        form.requestSubmit();
        form.requestSubmit();
      });
      await s.home();
      assert.equal(s.state.posts, 1);
      assert.equal(s.state.dialogs.length, 0);
      assert.equal(s.state.pageErrors.length, 0);
      const p = await s.profile();
      assert.ok(p.baller_id);
      assert.equal(p.first_name, mode === "race" ? "Other tab" : "New Player");
      await s.page.waitForTimeout(800);
      assert.equal(new URL(s.page.url()).pathname, "/");
      if (mode === "normal") {
        await s.page.screenshot({
          path: new URL("../docs/hotfix-registration-home.png", import.meta.url)
            .pathname,
        });
        await s.page.reload();
        await s.home();
        assert.equal((await s.profile()).baller_id, p.baller_id);
        pass("reload keeps session and Baller ID");
      }
      pass(mode + ": one profile, no duplicate alert, no return to onboarding");
      await s.ctx.close();
    }
    {
      const s = await scenario({ existing: true });
      await s.open();
      await s.home();
      assert.equal(s.state.posts, 0);
      assert.equal((await s.profile()).first_name, "Original");
      pass("existing profile bypasses onboarding without overwrite");
      await s.ctx.close();
    }
    {
      const s = await scenario();
      s.state.failReads = true;
      await s.open();
      await s.page
        .getByRole("button", { name: "Повторить проверку" })
        .waitFor();
      assert.equal(s.state.posts, 0);
      await s.page.screenshot({
        path: new URL("../docs/hotfix-registration-error.png", import.meta.url)
          .pathname,
      });
      s.state.failReads = false;
      await s.page.getByRole("button", { name: "Повторить проверку" }).click();
      await s.fill();
      await s.submit().click();
      await s.home();
      pass(
        "failed initial read does not mean no profile; explicit retry recovers",
      );
      await s.ctx.close();
    }
    {
      const s = await scenario({ mode: "forbidden" });
      await s.open();
      await s.fill();
      await s.submit().click();
      await s.page
        .getByRole("alert")
        .filter({ hasText: "Нет доступа" })
        .waitFor();
      assert.equal(await s.profile(), undefined);
      await s
        .submit()
        .isEnabled()
        .then((x) => assert.equal(x, true));
      await s.page.screenshot({
        path: new URL(
          "../docs/hotfix-registration-submit-error.png",
          import.meta.url,
        ).pathname,
      });
      s.state.mode = "normal";
      await s.submit().click();
      await s.home();
      pass("rejected INSERT is not treated as success; controls recover");
      await s.ctx.close();
    }
    {
      const s = await scenario({ anonymous: true });
      await s.open();
      await s.page.getByRole("link", { name: "Войти через Google" }).waitFor();
      assert.equal(s.state.posts, 0);
      pass("unauthenticated onboarding cannot create a profile");
      await s.ctx.close();
    }
    {
      const s = await scenario();
      await s.open();
      await s.fill();
      await s.page.getByLabel("Год рождения").fill("1");
      await s.submit().click();
      assert.equal(s.state.posts, 0);
      pass("invalid year blocked before write");
      await s.page.getByLabel("Год рождения").fill("2000");
      await s.page.getByLabel("Основная позиция").selectOption("ATT");
      await s.page.getByLabel("Дополнительная позиция").selectOption("ATT");
      await s.submit().click();
      await s.page
        .getByRole("alert")
        .filter({ hasText: "Дополнительная позиция" })
        .waitFor();
      assert.equal(s.state.posts, 0);
      pass("same primary and secondary position rejected clearly");
      await s.page.getByLabel("Дополнительная позиция").selectOption("");
      await s.page.getByLabel("Год рождения").fill("");
      await s.page.screenshot({
        path: new URL("../docs/hotfix-registration-form.png", import.meta.url)
          .pathname,
        fullPage: true,
      });
      assert.ok(
        await s.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await s.ctx.close();
    }
  }
  if (!buggy) {
    {
      const s = await scenario({ mode: "lost-unread" });
      await s.open();
      await s.fill();
      await s.submit().click();
      await s.page
        .getByRole("alert")
        .filter({ hasText: "Не удалось проверить" })
        .waitFor();
      assert.equal(s.state.posts, 1);
      assert.ok(await s.profile());
      s.state.failReads = false;
      await s.submit().click();
      await s.home();
      assert.equal(s.state.posts, 1);
      pass(
        "write committed but response and verification failed: manual retry reads existing row, no second INSERT",
      );
      await s.ctx.close();
    }
    {
      const s = await scenario({ mode: "foreign-conflict" });
      await s.open();
      await s.fill();
      await s.submit().click();
      await s.page
        .getByRole("alert")
        .filter({ hasText: "Не удалось завершить" })
        .waitFor();
      assert.equal(await s.profile(), undefined);
      assert.ok(s.page.url().endsWith("/onboarding"));
      pass("unrelated unique violation is not accepted as a saved profile");
      await s.ctx.close();
    }
    {
      const s = await scenario();
      await s.open();
      await s.fill();
      assert.equal(
        await s.page.getByRole("button", { name: /Уведомления/ }).count(),
        0,
      );
      await s.page.screenshot({
        path: new URL("../docs/hotfix-registration-form.png", import.meta.url)
          .pathname,
        fullPage: true,
      });
      await s.page.setViewportSize({ width: 320, height: 740 });
      assert.ok(
        await s.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      pass(
        "onboarding at 320px: no horizontal overflow or floating bell over fields",
      );
      await s.ctx.close();
    }
    for (const existing of [false, true]) {
      const s = await scenario({
        invite: true,
        existing,
        mode: existing ? "normal" : "lost",
      });
      await s.page.goto(base + "/join/" + s.inviteToken);
      if (!existing) {
        const section = s.page.locator("section").filter({
          has: s.page.getByRole("heading", {
            name: "Complete your Baller profile",
          }),
        });
        await section.locator("input").fill("Invited Player");
        await s.page
          .getByRole("button", { name: "Join Game", exact: true })
          .click();
      }
      await s.page
        .getByRole("heading", { name: "Invite destination" })
        .waitFor();
      assert.equal(
        new URL(s.page.url()).pathname,
        "/communities/" + s.communityId,
      );
      assert.equal(s.state.posts, existing ? 0 : 1);
      assert.equal(s.state.dialogs.length, 0);
      const row = await serial(async () => {
        await db.exec("RESET ROLE");
        return (
          await db.query(
            "SELECT cm.role,i.uses_count FROM community_members cm JOIN player_profiles p ON p.id=cm.player_id JOIN invites i ON i.community_id=cm.community_id WHERE p.user_id=$1 AND cm.community_id=$2",
            [s.uid, s.communityId],
          )
        ).rows[0];
      });
      assert.equal(row.role, "MEMBER");
      assert.equal(row.uses_count, 1);
      pass(
        (existing ? "existing" : "new, lost INSERT response") +
          ": invite preserved; one membership and one use, no elevated role",
      );
      await s.ctx.close();
    }
  }
  console.log(
    `RESULT: ${passed} registration browser checks passed. Isolated PostgreSQL/RLS; simulated OAuth/HTTP, not live Supabase.`,
  );
} finally {
  await browser.close();
  await db.close();
}
