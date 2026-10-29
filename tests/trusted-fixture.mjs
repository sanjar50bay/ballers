import fs from "node:fs";
export const id = (n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const uid = (n) => id(1000 + n),
  pid = (n) => id(2000 + n),
  community = id(1);
export async function init(db, before008 = false) {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;",
  );
  for (const file of [
    "supabase/test_project_baseline.sql",
    ...fs
      .readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql") && (!before008 || !x.includes("_008_")))
      .sort()
      .map((x) => "supabase/migrations/" + x),
  ])
    await db.exec(fs.readFileSync(file, "utf8"));
  for (let n = 1; n <= 5; n++) {
    await db.query("INSERT INTO auth.users VALUES($1)", [uid(n)]);
    await db.query(
      "INSERT INTO player_profiles(id,user_id,first_name,primary_position) VALUES($1,$2,$3,'MID')",
      [
        pid(n),
        uid(n),
        ["", "Organizer", "Captain", "Operator", "Outsider", "Guest"][n],
      ],
    );
  }
  await db.query(
    "INSERT INTO communities(id,name,city,created_by) VALUES($1,'Trusted Cup','Astana',$2)",
    [community, uid(1)],
  );
  await db.query(
    "INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER'),($1,$4,'MEMBER')",
    [community, pid(1), pid(2), pid(3)],
  );
}
export async function actor(db, n) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    n ? uid(n) : "",
  ]);
  await db.exec(n ? "SET ROLE authenticated" : "SET ROLE anon");
}
export async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
export async function day(db, n) {
  await db.exec("RESET ROLE");
  const g = id(n),
    teams = [id(n + 1), id(n + 2), id(n + 3)];
  await db.query(
    "INSERT INTO game_days(id,community_id,title,game_date,start_time,sequence_number,format,team_count,capacity,created_by) VALUES($1,$2,'Trusted Match Day','2099-12-01','20:00',$3,1,3,3,$4)",
    [g, community, n, uid(1)],
  );
  await db.query(
    "INSERT INTO ballers_game_settings(game_day_id,duration_seconds,goal_limit,end_mode) VALUES($1,420,2,'FIRST_REACHED')",
    [g],
  );
  for (let i = 0; i < 3; i++) {
    await db.query(
      "INSERT INTO game_participants(game_day_id,player_id,attendance_status) VALUES($1,$2,'GOING')",
      [g, pid(i + 1)],
    );
    await db.query(
      "INSERT INTO game_day_teams(id,game_day_id,name,color_key,sort_order) VALUES($1,$2,$3,$4,$5)",
      [
        teams[i],
        g,
        ["Blue", "Red", "Yellow"][i],
        ["BLUE", "RED", "YELLOW"][i],
        i + 1,
      ],
    );
    await db.query(
      "INSERT INTO game_day_team_players(game_day_id,team_id,player_id) VALUES($1,$2,$3)",
      [g, teams[i], pid(i + 1)],
    );
    await db.query(
      "INSERT INTO ballers_team_roles(team_id,captain_id,responsible_id) VALUES($1,$2,$2)",
      [teams[i], pid(i + 1)],
    );
  }
  await actor(db, 1);
  await db.query("SELECT ballers_game_action($1,'LINEUP',$2)", [
    g,
    JSON.stringify({
      team_a: teams[0],
      team_b: teams[1],
      first_draw_out: teams[0],
    }),
  ]);
  return { g, teams };
}
export const start = (db, g) =>
  scalar(db, "SELECT ballers_start_match($1)", [g]);
export async function act(db, m, action, payload = {}, n = 3, version = null) {
  await db.exec("RESET ROLE");
  const v =
    version ??
    (await scalar(db, "SELECT version FROM ballers_matches WHERE id=$1", [m]));
  await actor(db, n);
  return db.query("SELECT ballers_match_action($1,$2,$3,$4)", [
    m,
    v,
    action,
    JSON.stringify(payload),
  ]);
}
