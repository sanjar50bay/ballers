-- BALLERS 0.2.8 reliability. Apply ONCE after 006 in the same project.
-- No account, membership, participant or match is deleted or promoted.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.ballers_migration_history') IS NULL THEN RAISE EXCEPTION 'Wrong project: migration history missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261027_006') THEN RAISE EXCEPTION 'Apply 006 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261028_007') THEN RAISE EXCEPTION '007 already applied'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ballers_home() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.player_profiles%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO p FROM public.player_profiles WHERE user_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('profile',NULL,'communities','[]'::jsonb,'games','[]'::jsonb,'history','[]'::jsonb); END IF;
 WITH visible AS (
 SELECT g.*,gp.attendance_status,r.status request_status,w.player_id IS NOT NULL queued,coalesce(w.offered,false) place_offered,
 (SELECT count(*) FROM public.game_participants x WHERE x.game_day_id=g.id AND x.attendance_status='GOING') going,
 (SELECT count(*) FROM public.ballers_matches x WHERE x.game_day_id=g.id) match_count,
 EXISTS(SELECT 1 FROM public.ballers_matches x WHERE x.game_day_id=g.id AND x.status IN('LIVE','PAUSED')) live
 FROM public.game_days g LEFT JOIN public.game_participants gp ON gp.game_day_id=g.id AND gp.player_id=p.id
 LEFT JOIN public.ballers_day_requests r ON r.game_day_id=g.id AND r.player_id=p.id
 LEFT JOIN public.ballers_waitlist w ON w.game_day_id=g.id AND w.player_id=p.id
 WHERE gp.player_id IS NOT NULL OR r.status='PENDING' OR w.player_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.community_members c WHERE c.community_id=g.community_id AND c.player_id=p.id) OR public.ballers_is_manager(g.community_id)
 ), upcoming AS (SELECT * FROM visible WHERE status='OPEN' AND (game_date>=current_date OR live) ORDER BY live DESC,game_date,start_time NULLS LAST,id LIMIT 12),
 past AS (SELECT * FROM visible WHERE match_count>0 OR status<>'OPEN' OR game_date<current_date ORDER BY game_date DESC,start_time DESC NULLS LAST,id LIMIT 40)
 SELECT jsonb_build_object('profile',to_jsonb(p),'stats',public.ballers_player_stats(p.id),
 'communities',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT c.id,c.name,c.city,cm.role FROM public.communities c JOIN public.community_members cm ON cm.community_id=c.id WHERE cm.player_id=p.id AND cm.member_status='REGULAR' ORDER BY c.name) c),'[]'::jsonb),
 'games',COALESCE((SELECT jsonb_agg(to_jsonb(u)) FROM upcoming u),'[]'::jsonb),
 'history',COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM past h),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ballers_home() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_home() TO authenticated;

-- Restore the global authenticated directory, independent of personal membership.
CREATE OR REPLACE FUNCTION public.ballers_directory(p_kind text DEFAULT 'players',p_city text DEFAULT '',p_query text DEFAULT '',p_offset int DEFAULT 0,p_free boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; v_city text:=public.ballers_city(p_city); total_count bigint; q text:=lower(left(trim(coalesce(p_query,'')),80)); offn int:=greatest(0,least(coalesce(p_offset,0),10000));
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_kind='players' THEN
 SELECT count(1) INTO total_count FROM public.player_profiles p LEFT JOIN public.ballers_football_preferences f ON f.player_id=p.id
 WHERE p.user_id IS NOT NULL AND (v_city='' OR lower(public.ballers_city(p.city))=lower(v_city)) AND (NOT coalesce(p_free,false) OR f.search_status='LOOKING')
 AND (q='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name,p.display_name)),q)>0 OR p.baller_id::text=replace(q,'#',''));

 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT p.id,p.baller_id,p.first_name,p.last_name,p.display_name,p.avatar_url,p.city,p.primary_position,coalesce(f.search_status,'PLAY') search_status,f.available available
 FROM public.player_profiles p LEFT JOIN public.ballers_football_preferences f ON f.player_id=p.id
 WHERE p.user_id IS NOT NULL AND (v_city='' OR lower(public.ballers_city(p.city))=lower(v_city)) AND (NOT coalesce(p_free,false) OR f.search_status='LOOKING')
 AND (q='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name,p.display_name)),q)>0 OR p.baller_id::text=replace(q,'#',''))
 ORDER BY p.created_at DESC,p.id LIMIT 25 OFFSET offn) x;
 ELSIF p_kind='teams' THEN
 SELECT count(1) INTO total_count FROM public.ballers_teams t WHERE (v_city='' OR lower(public.ballers_city(t.city))=lower(v_city)) AND (q='' OR strpos(lower(t.name),q)>0);

 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT t.id,t.name,t.city,t.about,(SELECT count(1) FROM public.ballers_team_people m WHERE m.team_id=t.id AND m.status='ACTIVE') members
 FROM public.ballers_teams t WHERE (v_city='' OR lower(public.ballers_city(t.city))=lower(v_city)) AND (q='' OR strpos(lower(t.name),q)>0)
 ORDER BY t.created_at DESC,t.id LIMIT 25 OFFSET offn) x;
 ELSIF p_kind='communities' THEN
 SELECT count(1) INTO total_count FROM public.communities c WHERE (v_city='' OR lower(public.ballers_city(c.city))=lower(v_city)) AND (q='' OR strpos(lower(c.name),q)>0);

 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT c.id,c.name,c.city,(SELECT count(1) FROM public.ballers_team_communities tc WHERE tc.community_id=c.id AND tc.status='ACTIVE') teams,
 (SELECT count(1) FROM public.community_members cm WHERE cm.community_id=c.id AND cm.member_status='REGULAR') members
 FROM public.communities c WHERE (v_city='' OR lower(public.ballers_city(c.city))=lower(v_city)) AND (q='' OR strpos(lower(c.name),q)>0)
 ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET offn) x;
 ELSE RAISE EXCEPTION 'INVALID_KIND';END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(v),'[]'::jsonb) FROM jsonb_array_elements(result) WITH ORDINALITY e(v,n) WHERE n<=24),'has_more',offn+24<total_count,'total',total_count);
END $$;

REVOKE ALL ON FUNCTION public.ballers_directory(text,text,text,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_directory(text,text,text,integer,boolean) TO authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261028_007');
NOTIFY pgrst,'reload schema';
COMMIT;
