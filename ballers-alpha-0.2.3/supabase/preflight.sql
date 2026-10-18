-- READ ONLY. Run before migration in your current project.
SELECT 'duplicate_team_colors' AS check_name,game_day_id::text AS context,color_key AS detail,count(*) AS affected
FROM public.game_day_teams GROUP BY game_day_id,color_key HAVING count(*)>1
UNION ALL
SELECT 'cross_game_assignments',a.game_day_id::text,a.id::text,1
FROM public.game_day_team_players a JOIN public.game_day_teams t ON t.id=a.team_id WHERE a.game_day_id<>t.game_day_id
UNION ALL
SELECT 'non_going_assignments',a.game_day_id::text,a.player_id::text,1
FROM public.game_day_team_players a WHERE NOT EXISTS(
 SELECT 1 FROM public.game_participants p WHERE p.game_day_id=a.game_day_id AND p.player_id=a.player_id AND p.attendance_status='GOING')
UNION ALL
SELECT 'duplicate_game_numbers',community_id::text,sequence_number::text,count(*)
FROM public.game_days GROUP BY community_id,sequence_number HAVING count(*)>1;

-- Review OWNER/MANAGER identities yourself; these are not automatically rewritten.
SELECT cm.community_id,cm.role,pp.display_name,pp.first_name,pp.baller_id
FROM public.community_members cm JOIN public.player_profiles pp ON pp.id=cm.player_id
WHERE cm.role IN ('OWNER','MANAGER') ORDER BY cm.community_id,cm.role;

SELECT schemaname,tablename,policyname,cmd,roles FROM pg_policies WHERE schemaname='public' ORDER BY tablename,cmd;
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated') ORDER BY table_name,grantee,privilege_type;
