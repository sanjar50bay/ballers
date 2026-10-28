-- READ ONLY: optional live-project diagnostics; no auth emails/keys or impersonation.
SELECT version FROM public.ballers_migration_history ORDER BY version;
SELECT
 (SELECT count(1) FROM public.ballers_teams) AS permanent_teams,
 (SELECT count(1) FROM public.communities) AS communities,
 (SELECT count(1) FROM public.player_profiles WHERE user_id IS NOT NULL) AS profiles_with_account;
SELECT p.oid::regprocedure AS function_signature,p.prosecdef AS security_definer,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute,
 md5(pg_get_functiondef(p.oid)) AS definition_hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('ballers_home','ballers_directory');
SELECT id,name,city FROM public.ballers_teams ORDER BY created_at DESC LIMIT 30;
SELECT id,name,city FROM public.communities ORDER BY created_at DESC LIMIT 30;
SELECT id,community_id,title,game_date,start_time FROM public.game_days ORDER BY game_date DESC LIMIT 30;
-- Optional: change Baller #1 below if investigating another player's home.
-- This reads visibility inputs without impersonating an auth session.
WITH me AS (SELECT id FROM public.player_profiles WHERE baller_id=1)
SELECT g.id,g.title,g.game_date,g.start_time,g.status,
 g.game_date>=current_date AS today_or_future,
 cm.role,cm.member_status,gp.attendance_status,r.status AS request_status,
 w.player_id IS NOT NULL AS queued,coalesce(w.offered,false) AS place_offered
FROM public.game_days g CROSS JOIN me
LEFT JOIN public.community_members cm ON cm.community_id=g.community_id AND cm.player_id=me.id
LEFT JOIN public.game_participants gp ON gp.game_day_id=g.id AND gp.player_id=me.id
LEFT JOIN public.ballers_day_requests r ON r.game_day_id=g.id AND r.player_id=me.id
LEFT JOIN public.ballers_waitlist w ON w.game_day_id=g.id AND w.player_id=me.id
ORDER BY g.game_date DESC,g.start_time LIMIT 30;
