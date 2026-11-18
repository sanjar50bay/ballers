-- Read-only workspace; existing write permissions are unchanged.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_011') THEN RAISE EXCEPTION 'Apply 011 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_012') THEN RAISE EXCEPTION '012 already applied'; END IF;
END $$;
CREATE FUNCTION public.ballers_community_workspace(p_community uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; c public.communities%ROWTYPE; member boolean; days jsonb;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO c FROM public.communities WHERE id=p_community;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMUNITY_NOT_FOUND'; END IF;
 member:=EXISTS(SELECT 1 FROM public.community_members WHERE community_id=c.id AND player_id=actor);
 IF NOT member THEN RETURN jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'member',false,'can_manage',false,'members','[]'::jsonb,'games','[]'::jsonb); END IF;
 WITH visible AS (
  SELECT g.*,EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.game_day_id=g.id AND m.status IN('LIVE','PAUSED')) live,
   ((g.status='OPEN' AND g.game_date>=current_date) OR EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.game_day_id=g.id AND m.status IN('LIVE','PAUSED'))) upcoming
  FROM public.game_days g WHERE g.community_id=c.id AND public.ballers_can_read_game(g.id)
 ), ranked AS (
  SELECT v.*,row_number() OVER(PARTITION BY upcoming ORDER BY CASE WHEN upcoming THEN game_date END ASC,CASE WHEN NOT upcoming THEN game_date END DESC,start_time,id) rn FROM visible v
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'game_date',g.game_date,'start_time',g.start_time,'venue',g.venue,
  'format',g.format,'team_count',g.team_count,'capacity',g.capacity,'status',g.status,'upcoming',g.upcoming,'live',g.live,
  'attendance_status',(SELECT attendance_status FROM public.game_participants WHERE game_day_id=g.id AND player_id=actor),
  'going',(SELECT count(*) FROM public.game_participants WHERE game_day_id=g.id AND attendance_status='GOING')
 ) ORDER BY g.upcoming DESC,CASE WHEN g.upcoming THEN g.game_date END ASC,CASE WHEN NOT g.upcoming THEN g.game_date END DESC,g.start_time,g.id),'[]'::jsonb)
 INTO days FROM ranked g WHERE rn<=20;
 RETURN jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'member',true,'can_manage',public.ballers_is_manager(c.id),
  'team_mode',c.team_mode,'default_format',c.default_format,'default_team_count',c.default_team_count,'default_capacity',c.default_capacity,
  'member_count',(SELECT count(*) FROM public.community_members WHERE community_id=c.id),
  'members',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.role_order,p.first_name,p.id) FROM (
   SELECT pp.id,pp.baller_id,pp.first_name,pp.last_name,pp.display_name,pp.city,pp.primary_position,pp.avatar_url,cm.role,cm.member_status,
    CASE cm.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END role_order
   FROM public.community_members cm JOIN public.player_profiles pp ON pp.id=cm.player_id WHERE cm.community_id=c.id
   ORDER BY role_order,pp.first_name,pp.id LIMIT 100
  ) p),'[]'::jsonb),'games',days);
END $$;
REVOKE ALL ON FUNCTION public.ballers_community_workspace(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_community_workspace(uuid) TO authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261118_012');
NOTIFY pgrst,'reload schema';
COMMIT;
