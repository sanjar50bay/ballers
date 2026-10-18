import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const exports = JSON.parse(fs.readFileSync(new URL('./schema-metadata.json',import.meta.url),'utf8'));
const schemaColumns = JSON.parse(fs.readFileSync(new URL('./schema-columns.json',import.meta.url),'utf8'));
const q = s => '"'+s.replaceAll('"','""')+'"';
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`);
for(const name of new Set(exports.enums.map(x=>x.type))){
 const values=exports.enums.filter(x=>x.type===name).sort((a,b)=>a.order-b.order).map(x=>"'"+x.value.replaceAll("'","''")+"'").join(',');
 await db.exec(`CREATE TYPE public.${q(name)} AS ENUM (${values});`);
}
for(const name of new Set(schemaColumns.map(x=>x.table_name))){
 const cols=schemaColumns.filter(x=>x.table_name===name).map(x=>`${q(x.column_name)} ${q(x.database_type)} ${x.is_nullable==='NO'?'NOT NULL':''} ${x.column_default && x.column_default!=='null'?'DEFAULT '+x.column_default:''}`).join(',');
 await db.exec(`CREATE TABLE public.${q(name)}(${cols});`);
}
for(const c of exports.constraints.filter(x=>!x.definition.startsWith('FOREIGN'))) await db.exec(`ALTER TABLE ${c.table} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
for(const c of exports.constraints.filter(x=>x.definition.startsWith('FOREIGN'))) await db.exec(`ALTER TABLE ${c.table} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
for(const f of exports.functions) await db.exec(f.definition);
for(const r of exports.rls_status) if(r.enabled) await db.exec(`ALTER TABLE ${q(r.table)} ENABLE ROW LEVEL SECURITY;`);
for(const p of exports.policies) await db.exec(`CREATE POLICY ${q(p.policyname)} ON ${q(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(q).join(',')} ${p.qual?'USING ('+p.qual+')':''} ${p.with_check?'WITH CHECK ('+p.with_check+')':''}`);
await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261012_001_pre_match_safety.sql',import.meta.url),'utf8');
await db.exec(migration);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=n=>id(1000+n), pid=n=>id(2000+n);
const community=id(1), game=id(2);
await db.query(`INSERT INTO auth.users(id) SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid FROM generate_series(1,40) n`);
await db.query(`INSERT INTO public.player_profiles(id,user_id,first_name,primary_position)
 SELECT ('00000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'P'||n,'MID' FROM generate_series(1,40) n`);
await db.query(`INSERT INTO communities(id,name,created_by) VALUES($1,'Pilot',$2)`,[community,uid(1)]);
await db.query(`INSERT INTO community_members(community_id,player_id,role) SELECT $1,id,CASE WHEN user_id=$2 THEN 'OWNER'::community_role ELSE 'MEMBER'::community_role END FROM player_profiles WHERE first_name IN (SELECT 'P'||n FROM generate_series(1,20)n)`,[community,uid(1)]);
await db.query(`INSERT INTO game_days(id,community_id,sequence_number,title,game_date,format,team_count,capacity,created_by) VALUES($1,$2,1,'Pilot','2026-10-17',5,3,30,$3)`,[game,community,uid(1)]);
await db.query(`INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) SELECT $1,id,'GOING','MEMBER' FROM player_profiles WHERE first_name IN (SELECT 'P'||n FROM generate_series(1,15)n)`,[game]);
async function actor(n){await db.exec('RESET ROLE'); await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[uid(n)]); await db.exec('SET ROLE authenticated');}
async function admin(){await db.exec('RESET ROLE');}
async function scalar(sql,params=[]){const r=await db.query(sql,params);return Object.values(r.rows[0])[0];}
async function action(type,payload={}){const v=await scalar('SELECT roster_version FROM game_days WHERE id=$1',[game]);return await scalar('SELECT ballers_team_action($1,$2,$3,$4)',[game,v,type,JSON.stringify(payload)]);}
let passed=0;
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
async function rejects(sql,params,pattern){await assert.rejects(()=>db.query(sql,params),pattern);}
await actor(1);
await test('build unique teams',async()=>{await action('BUILD');assert.equal(await scalar('SELECT count(*) FROM game_day_teams'),3);});
let teams=(await db.query('SELECT id FROM game_day_teams ORDER BY sort_order')).rows.map(x=>x.id);
for(const total of [15,17,18]){
 await admin();await db.query(`INSERT INTO game_participants(game_day_id,player_id,attendance_status,participant_type) SELECT $1,id,'GOING','MEMBER' FROM player_profiles WHERE first_name IN (SELECT 'P'||n FROM generate_series(1,$2)n) ON CONFLICT(game_day_id,player_id) DO UPDATE SET attendance_status='GOING'`,[game,total]);
 await actor(1);
 await test('balance '+total,async()=>{await action('RANDOMIZE');const counts=(await db.query('SELECT count(*)::int n FROM game_day_team_players GROUP BY team_id ORDER BY n')).rows.map(x=>x.n);assert.deepEqual(counts,total===15?[5,5,5]:total===17?[5,6,6]:[6,6,6]);assert.equal(await scalar('SELECT count(DISTINCT player_id) FROM game_day_team_players'),total);});
}
await test('no-op assignment preserves core',async()=>{const a=(await db.query('SELECT * FROM game_day_team_players LIMIT 1')).rows[0];await action('CORE',{assignment_id:a.id,is_core:true});await action('ASSIGN',{player_id:a.player_id,team_id:a.team_id});assert.equal(await scalar('SELECT is_core FROM game_day_team_players WHERE id=$1',[a.id]),true);});
await test('full team move does not lose original row',async()=>{const a=(await db.query('SELECT * FROM game_day_team_players LIMIT 1')).rows[0];const other=teams.find(t=>t!==a.team_id);await assert.rejects(()=>action('ASSIGN',{player_id:a.player_id,team_id:other}),/TEAM_ROSTER_FULL/);assert.equal(await scalar('SELECT team_id FROM game_day_team_players WHERE id=$1',[a.id]),a.team_id);});
await test('stale roster version rejected',()=>rejects(`SELECT ballers_team_action($1,-1,'RESET','{}')`,[game],/ROSTER_CHANGED_REFRESH/));
await test('duplicate color rejected',()=>assert.rejects(()=>action('UPDATE_TEAM',{team_id:teams[1],color_key:'BLUE'}),/ballers_team_color_unique/));
await test('invalid mode rejected',()=>assert.rejects(()=>action('UPDATE_TEAM',{team_id:teams[0],team_mode:'ANY'}),/INVALID_TEAM_MODE/));
await test('reset preserves attendance',async()=>{const before=await scalar('SELECT count(*) FROM game_participants');await action('RESET');assert.equal(await scalar('SELECT count(*) FROM game_day_team_players'),0);assert.equal(await scalar('SELECT count(*) FROM game_participants'),before);});
await test('restore 15 participants for Saturday',async()=>{for(let n=16;n<=18;n++) await db.query('SELECT ballers_set_attendance($1,$2,$3)',[game,pid(n),'DECLINED']);});
await test('Saturday fixed + core fill',async()=>{
 for(let n=1;n<=5;n++) await action('ASSIGN',{player_id:pid(n),team_id:teams[0]});
 await action('UPDATE_TEAM',{team_id:teams[0],team_mode:'FIXED'});
 for(let n=6;n<=9;n++) {await action('ASSIGN',{player_id:pid(n),team_id:teams[1]});const aid=await scalar('SELECT id FROM game_day_team_players WHERE player_id=$1',[pid(n)]);await action('CORE',{assignment_id:aid,is_core:true});}
 await action('UPDATE_TEAM',{team_id:teams[1],team_mode:'CORE_PLUS_FILL'});
 await action('RANDOMIZE');
 assert.equal(await scalar('SELECT count(*) FROM game_day_team_players WHERE team_id=$1',[teams[0]]),5);
 assert.equal(await scalar('SELECT count(*) FROM game_day_team_players WHERE team_id=$1 AND is_core',[teams[1]]),4);
 assert.equal(await scalar('SELECT count(*) FROM game_day_team_players WHERE team_id=$1',[teams[1]]),5);
 assert.equal(await scalar('SELECT count(*) FROM game_day_team_players WHERE team_id=$1',[teams[2]]),5);
 for(let n=1;n<=5;n++)assert.equal(await scalar('SELECT team_id FROM game_day_team_players WHERE player_id=$1',[pid(n)]),teams[0]);
});
await test('protected fixed player cannot move silently',()=>assert.rejects(()=>action('ASSIGN',{player_id:pid(1),team_id:null}),/PLAYER_PROTECTED/));
await test('protected core cannot move silently',()=>assert.rejects(()=>action('ASSIGN',{player_id:pid(6),team_id:null}),/PLAYER_PROTECTED/));
await test('injected insert failure rolls back all deleted assignments',async()=>{
 await admin();
 await db.exec(`CREATE FUNCTION public.ballers_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_INSERT_FAILURE'; END $$;
 CREATE TRIGGER ballers_test_failure BEFORE INSERT ON public.game_day_team_players FOR EACH ROW EXECUTE FUNCTION public.ballers_test_fail();`);
 await actor(1);
 const before=JSON.stringify((await db.query('SELECT * FROM game_day_team_players ORDER BY id')).rows);
 const version=await scalar('SELECT roster_version FROM game_days WHERE id=$1',[game]);
 await assert.rejects(()=>action('RANDOMIZE'),/INJECTED_INSERT_FAILURE/);
 assert.equal(JSON.stringify((await db.query('SELECT * FROM game_day_team_players ORDER BY id')).rows),before);
 assert.equal(await scalar('SELECT roster_version FROM game_days WHERE id=$1',[game]),version);
 await admin();await db.exec('DROP TRIGGER ballers_test_failure ON game_day_team_players; DROP FUNCTION ballers_test_fail();');await actor(1);
});
await test('all fixed preserves rows',async()=>{for(const t of teams)await action('UPDATE_TEAM',{team_id:t,team_mode:'FIXED'});const old=await scalar('SELECT count(*) FROM game_day_team_players');await assert.rejects(()=>action('RANDOMIZE'),/ALL_TEAMS_FIXED/);assert.equal(await scalar('SELECT count(*) FROM game_day_team_players'),old);});
await actor(2);
await test('nonmanager RPC rejected',()=>rejects(`SELECT ballers_team_action($1,0,'RESET','{}')`,[game],/MANAGER_REQUIRED/));
await test('self escalation OWNER denied by RLS',()=>rejects(`INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')`,[community,pid(21)],/row-level security/));
await test('nonmanager creates game denied',()=>rejects(`INSERT INTO game_days(community_id,sequence_number,title,game_date,format,team_count,created_by) VALUES($1,2,'bad','2026-10-18',5,3,$2)`,[community,uid(2)],/row-level security/));
await test('nonmanager creates invite denied',()=>rejects(`INSERT INTO invites(invite_type,community_id,game_day_id,created_by) VALUES('GAME_GUEST',$1,$2,$3)`,[community,game,uid(2)],/row-level security/));
await test('direct participant UPDATE cannot change game',async()=>{const r=await db.query(`UPDATE game_participants SET game_day_id=$1 WHERE player_id=$2 RETURNING id`,[id(999),pid(2)]);assert.equal(r.rows.length,0);});
await test('cannot change other player attendance',()=>rejects('SELECT ballers_set_attendance($1,$2,$3)',[game,pid(3),'DECLINED'],/ATTENDANCE_FORBIDDEN/));
await test('self Out atomically removes assignment',async()=>{await db.query('SELECT ballers_set_attendance($1,$2,$3)',[game,pid(2),'DECLINED']);assert.equal(await scalar('SELECT count(*) FROM game_day_team_players WHERE player_id=$1',[pid(2)]),0);});
await test('direct team DELETE is denied even to managers',async()=>{await actor(1);const r=await db.query('DELETE FROM game_day_team_players RETURNING id');assert.equal(r.rows.length,0);});
await test('non-GOING cannot be assigned',()=>assert.rejects(()=>action('ASSIGN',{player_id:pid(2),team_id:teams[0]}),/PLAYER_NOT_GOING/));
await admin();await db.query(`INSERT INTO game_days(id,community_id,sequence_number,title,game_date,format,team_count,created_by) VALUES($1,$2,2,'Other','2026-10-18',5,3,$3)`,[id(3),community,uid(1)]);await db.query(`INSERT INTO game_day_teams(id,game_day_id,name,color_key) VALUES($1,$2,'Other','RED')`,[id(4),id(3)]);await actor(1);
await test('cross-game assignment rejected',()=>assert.rejects(()=>action('ASSIGN',{player_id:pid(2),team_id:id(4)}),/TEAM_GAME_MISMATCH/));
await test('creator can bootstrap only own new community',async()=>{const c=id(10);await db.query('INSERT INTO communities(id,name,created_by) VALUES($1,$2,$3)',[c,'New',uid(1)]);await db.query(`INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')`,[c,pid(1)]);});
await test('community plus owner created atomically',async()=>{
 const c=await scalar(`SELECT ballers_create_community('Atomic','Astana','RANDOM',5,3,15)`);
 assert.equal(await scalar(`SELECT count(*) FROM community_members WHERE community_id=$1 AND player_id=$2 AND role='OWNER'`,[c,pid(1)]),1);
});
await test('server-generated Game Day numbering',async()=>{
 const x=await scalar(`SELECT ballers_create_game_day($1,'2026-10-19','20:00','Field',5,3,15)`,[community]);
 assert.equal(await scalar('SELECT sequence_number FROM game_days WHERE id=$1',[x]),3);
});
await test('invalid new game rejected',()=>rejects(`SELECT ballers_create_game_day($1,'2026-10-19','20:00','Field',5,9,15)`,[community],/INVALID_GAME_SETTINGS/));
await actor(2);
await test('nonmanager game creation RPC rejected',()=>rejects(`SELECT ballers_create_game_day($1,'2026-10-19','20:00','Field',5,3,15)`,[community],/MANAGER_REQUIRED/));
await actor(21);
await test('new authenticated outsider cannot become OWNER',()=>rejects(`INSERT INTO community_members(community_id,player_id,role) VALUES($1,$2,'OWNER')`,[community,pid(21)],/row-level security/));
await test('guest cannot join without invitation',()=>rejects('SELECT ballers_set_attendance($1,$2,$3)',[game,pid(21),'GOING'],/INVITATION_REQUIRED/));
await actor(1);const token=await scalar(`INSERT INTO invites(invite_type,community_id,game_day_id,created_by,max_uses) VALUES('GAME_GUEST',$1,$2,$3,1) RETURNING token`,[community,game,uid(1)]);
await actor(21);
await test('valid invite join',async()=>{assert.equal(await scalar('SELECT ballers_join_game_invite($1)',[token]),game);});
await test('repeat invite join consumes once',async()=>{await db.query('SELECT ballers_join_game_invite($1)',[token]);await admin();assert.equal(await scalar('SELECT uses_count FROM invites WHERE token=$1',[token]),1);await actor(21);});
await actor(22);
await test('exhausted invite rejected',()=>rejects('SELECT ballers_join_game_invite($1)',[token],/INVITE_UNAVAILABLE/));
await test('exhausted invite not publicly discoverable',async()=>{await db.exec('RESET ROLE; SET ROLE anon');assert.equal((await db.query('SELECT * FROM get_invite_by_token($1)',[token])).rows.length,0);});
await test('anonymous cannot run mutations',()=>rejects('SELECT ballers_join_game_invite($1)',[token],/permission denied/));
await admin();const expired=await scalar(`INSERT INTO invites(invite_type,community_id,game_day_id,created_by,expires_at) VALUES('GAME_GUEST',$1,$2,$3,now()-interval '1 day') RETURNING token`,[community,game,uid(1)]);await actor(22);
await test('expired invite rejected',()=>rejects('SELECT ballers_join_game_invite($1)',[expired],/INVITE_UNAVAILABLE/));
await admin();const valid=await scalar(`INSERT INTO invites(invite_type,community_id,game_day_id,created_by) VALUES('GAME_GUEST',$1,$2,$3) RETURNING token`,[community,game,uid(1)]);await db.exec(`UPDATE game_days SET capacity=(SELECT count(*) FROM game_participants WHERE game_day_id='${game}' AND attendance_status='GOING') WHERE id='${game}'`);await actor(22);
await test('capacity enforced, no invitation consumed',async()=>{await rejects('SELECT ballers_join_game_invite($1)',[valid],/GAME_FULL/);await admin();assert.equal(await scalar('SELECT uses_count FROM invites WHERE token=$1',[valid]),0);await actor(22);});
await actor(2);
await test('capacity enforced for own attendance',()=>rejects('SELECT ballers_set_attendance($1,$2,$3)',[game,pid(2),'GOING'],/GAME_FULL/));
await admin();await db.query(`UPDATE game_days SET status='CANCELLED' WHERE id=$1`,[game]);await actor(1);
await test('closed game mutation rejected',()=>assert.rejects(()=>action('RESET'),/GAME_NOT_OPEN/));
await admin();
await test('all mutations audited',async()=>assert.ok((await scalar('SELECT count(*) FROM ballers_pre_match_audit'))>20));
await test('Baller ID generation unique',async()=>{const r=await db.query('SELECT count(*)::int total,count(DISTINCT baller_id)::int unique_ids FROM player_profiles');assert.equal(r.rows[0].total,r.rows[0].unique_ids);});
await test('migration reapplication rejected',async()=>{await assert.rejects(()=>db.exec(migration),/already applied/);await db.exec('ROLLBACK');});
console.log(`RESULT: ${passed} passed; isolated PGlite PostgreSQL, not production Supabase.`);
await db.close();
