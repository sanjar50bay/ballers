-- Team calendar and atomic scheduling. Existing days/results/clients are unchanged.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_010') THEN RAISE EXCEPTION 'Apply 010 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_011') THEN RAISE EXCEPTION '011 already applied'; END IF;
END $$;

CREATE TABLE public.ballers_team_games(
 operation_id uuid PRIMARY KEY,
 team_id uuid NOT NULL REFERENCES public.ballers_teams(id) ON DELETE CASCADE,
 game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.player_profiles(id),
 request jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(team_id,game_day_id)
);
CREATE INDEX ballers_team_games_day ON public.ballers_team_games(game_day_id);
ALTER TABLE public.ballers_team_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_team_games FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ballers_team_calendar(p_team uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; tm public.ballers_teams%ROWTYPE; member boolean; captain boolean; days jsonb;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO tm FROM public.ballers_teams WHERE id=p_team;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND'; END IF;
 member:=EXISTS(SELECT 1 FROM public.ballers_team_people WHERE team_id=p_team AND player_id=actor AND status='ACTIVE');
 captain:=member AND tm.created_by=actor;
 IF NOT member THEN RETURN jsonb_build_object('team_name',tm.name,'member',false,'can_plan',false,'communities','[]'::jsonb,'games','[]'::jsonb); END IF;
 WITH visible AS (
  SELECT g.*,c.name community_name,
   EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.game_day_id=g.id AND m.status IN('LIVE','PAUSED')) live,
   ((g.status='OPEN' AND g.game_date>=current_date) OR EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.game_day_id=g.id AND m.status IN('LIVE','PAUSED'))) upcoming
  FROM public.ballers_team_games tg JOIN public.game_days g ON g.id=tg.game_day_id JOIN public.communities c ON c.id=g.community_id
  WHERE tg.team_id=p_team AND public.ballers_can_read_game(g.id)
 ), ranked AS (
  SELECT v.*,row_number() OVER(PARTITION BY upcoming ORDER BY
   CASE WHEN upcoming THEN game_date END ASC,CASE WHEN NOT upcoming THEN game_date END DESC,start_time,id) rn FROM visible v
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'game_date',g.game_date,'start_time',g.start_time,'venue',g.venue,
  'community_id',g.community_id,'community_name',g.community_name,'format',g.format,'status',g.status,'upcoming',g.upcoming,'live',g.live,
  'attendance_status',(SELECT attendance_status FROM public.game_participants WHERE game_day_id=g.id AND player_id=actor),
  'going',(SELECT count(*) FROM public.game_participants gp JOIN public.ballers_team_people tp ON tp.player_id=gp.player_id AND tp.team_id=p_team AND tp.status='ACTIVE' WHERE gp.game_day_id=g.id AND gp.attendance_status='GOING'),
  'invited',(SELECT count(*) FROM public.game_participants gp JOIN public.ballers_team_people tp ON tp.player_id=gp.player_id AND tp.team_id=p_team AND tp.status='ACTIVE' WHERE gp.game_day_id=g.id AND gp.attendance_status='INVITED')
 ) ORDER BY g.upcoming DESC,CASE WHEN g.upcoming THEN g.game_date END ASC,CASE WHEN NOT g.upcoming THEN g.game_date END DESC,g.start_time,g.id),'[]'::jsonb)
 INTO days FROM ranked g WHERE rn<=20;
 RETURN jsonb_build_object('team_name',tm.name,'member',member,'can_plan',captain,'games',days,
  'communities',CASE WHEN captain THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'format',c.default_format,
   'team_count',c.default_team_count,'capacity',c.default_capacity,'linked',EXISTS(SELECT 1 FROM public.ballers_team_communities tc WHERE tc.team_id=p_team AND tc.community_id=c.id AND tc.status='ACTIVE')) ORDER BY c.name,c.id)
   FROM public.communities c WHERE public.ballers_is_manager(c.id)),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.ballers_team_calendar(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_team_calendar(uuid) TO authenticated;

CREATE FUNCTION public.ballers_schedule_team_game(p_team uuid,p_operation uuid,p_community uuid,p_date date,p_time time,p_venue text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; tm public.ballers_teams%ROWTYPE; c public.communities%ROWTYPE; receipt public.ballers_team_games%ROWTYPE; payload jsonb; game uuid;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO tm FROM public.ballers_teams WHERE id=p_team FOR UPDATE;
 IF NOT FOUND OR tm.created_by<>actor OR NOT EXISTS(SELECT 1 FROM public.ballers_team_people WHERE team_id=p_team AND player_id=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED'; END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'INVALID_SCHEDULE_OPERATION'; END IF;
 payload:=jsonb_build_object('team',p_team,'community',p_community,'date',p_date,'time',p_time,'venue',trim(p_venue));
 SELECT * INTO receipt FROM public.ballers_team_games WHERE operation_id=p_operation;
 IF FOUND THEN
  IF receipt.actor_id<>actor OR receipt.team_id<>p_team OR receipt.request<>payload THEN RAISE EXCEPTION 'SCHEDULE_OPERATION_REUSE'; END IF;
  IF NOT public.ballers_can_read_game(receipt.game_day_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN receipt.game_day_id;
 END IF;
 IF p_date IS NULL OR p_date<current_date OR p_time IS NULL OR length(trim(coalesce(p_venue,''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'INVALID_SCHEDULE_DETAILS'; END IF;
 SELECT * INTO c FROM public.communities WHERE id=p_community FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(c.id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 -- The actor represents both sides, so linking their own team needs no second approval.
 INSERT INTO public.ballers_team_communities(team_id,community_id,status) VALUES(p_team,c.id,'ACTIVE')
  ON CONFLICT(team_id,community_id) DO UPDATE SET status='ACTIVE',updated_at=now();
 game:=public.ballers_create_game_day(c.id,p_date,p_time,trim(p_venue),c.default_format,c.default_team_count,c.default_capacity);
 INSERT INTO public.ballers_game_settings(game_day_id) VALUES(game);
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type)
  SELECT game,tp.player_id,'INVITED','GUEST' FROM public.ballers_team_people tp WHERE tp.team_id=p_team AND tp.status='ACTIVE';
 -- Existing participant trigger creates invitations once; nobody is marked GOING automatically.
 INSERT INTO public.ballers_team_games(operation_id,team_id,game_day_id,actor_id,request) VALUES(p_operation,p_team,game,actor,payload);
 RETURN game;
END $$;
REVOKE ALL ON FUNCTION public.ballers_schedule_team_game(uuid,uuid,uuid,date,time,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_schedule_team_game(uuid,uuid,uuid,date,time,text) TO authenticated;

INSERT INTO public.ballers_migration_history(version) VALUES('20261118_011');
NOTIFY pgrst,'reload schema';
COMMIT;
