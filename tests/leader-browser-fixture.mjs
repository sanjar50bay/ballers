import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
import { init, id, pid, uid, day, actor } from "./trusted-fixture.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
export { id, pid, uid };
export const db = new PGlite();
await init(db);
const seeded = await day(db, 200);
export const game = seeded.g,
  community = id(1);
await db.exec("RESET ROLE");
await db.query("UPDATE game_days SET capacity=9,venue=$2 WHERE id=$1", [
  game,
  "Купол · тестовая площадка",
]);
await db.query(
  "UPDATE player_profiles SET first_name='Other manager' WHERE id=$1",
  [pid(5)],
);
await db.query(
  "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'MANAGER')",
  [community, pid(5)],
);
for (let n = 6; n <= 8; n++) {
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [uid(n)]);
  await db.query(
    "INSERT INTO player_profiles(id,user_id,first_name,primary_position) VALUES($1,$2,$3,'MID')",
    [pid(n), uid(n), "Viewer " + n],
  );
}
for (const n of [5, 6, 7, 8])
  await db.query(
    "INSERT INTO game_participants(game_day_id,player_id,attendance_status) VALUES($1,$2,'GOING')",
    [game, pid(n)],
  );
await db.exec(
  fs.readFileSync(
    new URL(
      "../supabase/migrations/20261117_009_game_leader.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  fs.readFileSync(
    new URL("../supabase/activate_009_game_leader.sql", import.meta.url),
    "utf8",
  ),
);
export const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
export const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3014";
export const errors = [],
  contexts = [];
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn);
  chain = next.catch(() => {});
  return next;
}
export const admin = (sql, args = []) =>
  serial(async () => {
    await db.exec("RESET ROLE");
    return (await db.query(sql, args)).rows;
  });
const sigs = new Map();
async function request(req, n) {
  const url = new URL(req.url());
  if (url.pathname === "/auth/v1/user")
    return {
      id: uid(n),
      aud: "authenticated",
      role: "authenticated",
      email: `test${n}@example.invalid`,
      app_metadata: { provider: "email" },
      user_metadata: {},
    };
  return serial(async () => {
    await actor(db, n);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      assert.match(name, /^[a-z_]+$/);
      let sig = sigs.get(name);
      if (!sig) {
        sig = (
          await db.query(
            "SELECT proargnames names,ARRAY(SELECT format_type(t,null) FROM unnest(proargtypes) t) types FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname=$1",
            [name],
          )
        ).rows[0];
        assert.ok(sig, "Unknown RPC " + name);
        sigs.set(name, sig);
      }
      const body = req.postDataJSON() || {},
        keys = Object.keys(body);
      assert.ok(
        keys.every((k) => sig.names?.includes(k)),
        name,
      );
      const values = keys.map((k) =>
        sig.types[sig.names.indexOf(k)] === "jsonb"
          ? JSON.stringify(body[k])
          : body[k],
      );
      return (
        await db.query(
          `SELECT public.${name}(${keys.map((k, i) => `${k}=>$${i + 1}::${sig.types[sig.names.indexOf(k)]}`).join(",")}) result`,
          values,
        )
      ).rows[0].result;
    }
    const table = url.pathname.split("/").at(-1);
    let rows;
    const single = (req.headers().accept || "").includes("vnd.pgrst.object");
    if (table === "player_profiles") {
      rows = (await db.query("SELECT * FROM player_profiles")).rows;
      for (const key of ["id", "user_id"])
        if (url.searchParams.has(key))
          rows = rows.filter(
            (p) => p[key] === url.searchParams.get(key).slice(3),
          );
    } else if (table === "game_days")
      rows = (await db.query("SELECT * FROM game_days WHERE id=$1", [game]))
        .rows;
    else if (table === "communities")
      rows = (
        await db.query("SELECT * FROM communities WHERE id=$1", [community])
      ).rows;
    else if (table === "community_members") {
      rows = (
        await db.query(
          "SELECT cm.*,to_jsonb(p) player_profiles FROM community_members cm JOIN player_profiles p ON p.id=cm.player_id WHERE cm.community_id=$1",
          [community],
        )
      ).rows;
      if (url.searchParams.has("player_id"))
        rows = rows.filter(
          (r) => r.player_id === url.searchParams.get("player_id").slice(3),
        );
    } else if (table === "game_participants")
      rows = (
        await db.query(
          "SELECT a.*,to_jsonb(p) player_profiles FROM game_participants a JOIN player_profiles p ON p.id=a.player_id WHERE a.game_day_id=$1",
          [game],
        )
      ).rows;
    else if (table === "game_day_teams") {
      rows = (
        await db.query(
          "SELECT * FROM game_day_teams WHERE game_day_id=$1 ORDER BY sort_order",
          [game],
        )
      ).rows;
      for (const team of rows)
        team.game_day_team_players = (
          await db.query(
            "SELECT a.*,to_jsonb(p) player_profiles FROM game_day_team_players a JOIN player_profiles p ON p.id=a.player_id WHERE a.team_id=$1",
            [team.id],
          )
        ).rows;
    } else throw Error("Unexpected REST table " + table);
    return single ? rows[0] : rows;
  });
}
export async function context(
  n,
  { width = 390, locale = "ru", loseStart = false } = {},
) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  contexts.push(ctx);
  const user = {
    id: uid(n),
    aud: "authenticated",
    role: "authenticated",
    email: `test${n}@example.invalid`,
    app_metadata: { provider: "email" },
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
      localStorage.setItem(
        "ballers:locale",
        localStorage.getItem("ballers:locale") || locale,
      );
      localStorage.setItem("ballers:welcome:disabled", "true");
      localStorage.setItem("ballers:coach:dismissed:" + user.id, "true");
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
    { user, token, locale },
  );
  let lost = false;
  await ctx.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname !== "example.supabase.co") return route.abort();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    try {
      const result = await request(req, n);
      if (
        loseStart &&
        !lost &&
        url.pathname.endsWith("/ballers_start_game_match")
      ) {
        lost = true;
        return route.abort("failed");
      }
      return route.fulfill({ status: 200, headers, json: result ?? null });
    } catch (e) {
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
  return { page, ctx };
}
export async function rpc(page, name, args) {
  return page.evaluate(
    async ({ name, args }) => {
      const r = await fetch("https://example.supabase.co/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      return { status: r.status, body: await r.json() };
    },
    { name, args },
  );
}
export async function close() {
  for (const c of contexts) await c.close();
  await browser.close();
  await db.close();
}
