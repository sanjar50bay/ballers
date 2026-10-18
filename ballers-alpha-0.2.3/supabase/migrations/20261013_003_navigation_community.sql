-- BALLERS Test only. Requires 001 and 002; does not reset data.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261012_002') THEN RAISE EXCEPTION 'Apply 002 first';END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261013_003') THEN RAISE EXCEPTION 'Migration 003 already applied';END IF;
END $$;
CREATE TABLE public.ballers_community_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,community_id uuid NOT NULL REFERENCES public.communities(id),actor_id uuid NOT NULL REFERENCES auth.users(id),action text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ballers_community_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY ballers_community_audit_read ON public.ballers_community_audit FOR SELECT TO authenticated USING(public.ballers_is_manager(community_id));
GRANT SELECT ON public.ballers_community_audit TO authenticated;
CREATE FUNCTION public.ballers_community_action(p_community uuid,p_action text,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.communities%ROWTYPE; tok uuid;BEGIN
 IF auth.uid() IS NULL OR NOT public.ballers_is_manager(p_community) THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
 SELECT * INTO c FROM public.communities WHERE id=p_community FOR UPDATE;
 IF p_action='UPDATE' THEN
  IF length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 80 OR length(COALESCE(p_payload->>'city',''))>80 OR (p_payload->>'format')::int NOT BETWEEN 1 AND 11 OR (p_payload->>'teams')::int NOT BETWEEN 2 AND 8 OR (p_payload->>'capacity')::int NOT BETWEEN 1 AND 200 OR p_payload->>'mode' NOT IN('RANDOM','FIXED','MIXED') OR NOT p_payload ?& ARRAY['name','format','teams','capacity','mode'] THEN RAISE EXCEPTION 'INVALID_SETTINGS';END IF;
  UPDATE public.communities SET name=trim(p_payload->>'name'),city=nullif(trim(p_payload->>'city'),''),default_format=(p_payload->>'format')::int,default_team_count=(p_payload->>'teams')::int,default_capacity=(p_payload->>'capacity')::int,team_mode=(p_payload->>'mode')::public.team_mode WHERE id=c.id;
 ELSIF p_action='INVITE' THEN
  INSERT INTO public.invites(invite_type,community_id,created_by,expires_at,max_uses) VALUES('COMMUNITY',c.id,auth.uid(),now()+interval '7 days',50) RETURNING token INTO tok;
 ELSE RAISE EXCEPTION 'UNKNOWN_ACTION';END IF;
 INSERT INTO public.ballers_community_audit(community_id,actor_id,action,details) VALUES(c.id,auth.uid(),p_action,CASE WHEN tok IS NULL THEN p_payload ELSE jsonb_build_object('expires_in_days',7,'max_uses',50) END);
 RETURN jsonb_build_object('community_id',c.id,'token',tok);
END $$;
CREATE OR REPLACE FUNCTION public.get_invite_by_token(invite_token uuid)
RETURNS TABLE(invite_id uuid,token uuid,invite_type public.invite_type,community_id uuid,community_name text,game_day_id uuid,game_title text,game_date date,start_time time without time zone,venue text,format integer,capacity integer,is_active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.id,i.token,i.invite_type,i.community_id,c.name,i.game_day_id,gd.title,gd.game_date,gd.start_time,gd.venue,gd.format,gd.capacity,i.is_active
 FROM public.invites i JOIN public.communities c ON c.id=i.community_id LEFT JOIN public.game_days gd ON gd.id=i.game_day_id AND gd.community_id=i.community_id
 WHERE i.token=invite_token AND i.is_active AND (i.expires_at IS NULL OR i.expires_at>now()) AND (i.max_uses IS NULL OR i.uses_count<i.max_uses)
 AND ((i.invite_type='COMMUNITY' AND i.game_day_id IS NULL) OR (i.invite_type='GAME_GUEST' AND gd.status='OPEN')) LIMIT 1;
$$;
CREATE FUNCTION public.ballers_join_community_invite(p_token uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.invites%ROWTYPE;p uuid;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT id INTO p FROM public.player_profiles WHERE user_id=auth.uid();IF p IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED';END IF;
 SELECT * INTO i FROM public.invites WHERE token=p_token FOR UPDATE;
 IF NOT FOUND OR i.invite_type<>'COMMUNITY' OR i.community_id IS NULL OR i.game_day_id IS NOT NULL THEN RAISE EXCEPTION 'INVITE_UNAVAILABLE';END IF;
 IF NOT i.is_active OR (i.expires_at IS NOT NULL AND i.expires_at<=now()) THEN RAISE EXCEPTION 'INVITE_UNAVAILABLE';END IF;
 PERFORM 1 FROM public.communities WHERE id=i.community_id FOR UPDATE;
 -- Retry / existing member never spends a second use or changes their role.
 IF EXISTS(SELECT 1 FROM public.community_members WHERE community_id=i.community_id AND player_id=p) THEN RETURN i.community_id;END IF;
 IF i.max_uses IS NOT NULL AND i.uses_count>=i.max_uses THEN RAISE EXCEPTION 'INVITE_UNAVAILABLE';END IF;
 INSERT INTO public.community_members(community_id,player_id,role,member_status) VALUES(i.community_id,p,'MEMBER','REGULAR');
 UPDATE public.invites SET uses_count=uses_count+1 WHERE id=i.id;
 INSERT INTO public.ballers_community_audit(community_id,actor_id,action,details) VALUES(i.community_id,auth.uid(),'JOIN',jsonb_build_object('player_id',p));
 RETURN i.community_id;
END $$;
CREATE FUNCTION public.ballers_my_career() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('player_id',p.id,'stats',public.ballers_player_stats(p.id),'matches',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'game_id',g.id,'title',g.title,'date',g.game_date,'sequence',m.sequence,'score_a',m.score_a,'score_b',m.score_b,'status',m.status,'is_test',m.is_test,'team_a',a.name,'team_b',b.name) ORDER BY g.game_date DESC,m.sequence DESC) FROM public.ballers_match_rosters r JOIN public.ballers_matches m ON m.id=r.match_id JOIN public.game_days g ON g.id=m.game_day_id JOIN public.game_day_teams a ON a.id=m.team_a JOIN public.game_day_teams b ON b.id=m.team_b WHERE r.player_id=p.id),'[]'::jsonb)) END FROM public.player_profiles p WHERE p.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.ballers_community_action(uuid,text,jsonb),public.ballers_join_community_invite(uuid),public.ballers_my_career() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_community_action(uuid,text,jsonb),public.ballers_join_community_invite(uuid),public.ballers_my_career() TO authenticated;
REVOKE ALL ON FUNCTION public.get_invite_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(uuid) TO anon,authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261013_003');
NOTIFY pgrst,'reload schema';
COMMIT;
