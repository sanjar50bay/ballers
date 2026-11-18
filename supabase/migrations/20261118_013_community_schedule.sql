-- Explicit single-game planning and retry receipts; no recurring job or invitations.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_012') THEN RAISE EXCEPTION 'Apply 012 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_013') THEN RAISE EXCEPTION '013 already applied'; END IF;
END $$;
CREATE TABLE public.ballers_community_game_operations(
 operation_id uuid PRIMARY KEY,community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.player_profiles(id),request jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ballers_community_game_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_community_game_operations FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ballers_schedule_community_game(p_community uuid,p_operation uuid,p_source uuid,p_date date,p_time time,p_venue text,p_format integer,p_team_count integer,p_capacity integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;c public.communities%ROWTYPE;r public.ballers_community_game_operations%ROWTYPE;payload jsonb;game uuid;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO c FROM public.communities WHERE id=p_community FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(c.id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'INVALID_SCHEDULE_OPERATION'; END IF;
 payload:=jsonb_build_object('community',p_community,'source',p_source,'date',p_date,'time',p_time,'venue',trim(p_venue),'format',p_format,'teams',p_team_count,'capacity',p_capacity);
 SELECT * INTO r FROM public.ballers_community_game_operations WHERE operation_id=p_operation;
 IF FOUND THEN
  IF r.actor_id<>actor OR r.community_id<>c.id OR r.request<>payload THEN RAISE EXCEPTION 'SCHEDULE_OPERATION_REUSE'; END IF;
  RETURN jsonb_build_object('id',r.game_day_id,'created',true);
 END IF;
 IF p_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.game_days WHERE id=p_source AND community_id=c.id AND public.ballers_can_read_game(id)) THEN RAISE EXCEPTION 'INVALID_SCHEDULE_SOURCE'; END IF;
 IF p_date IS NULL OR p_date<current_date OR p_time IS NULL OR length(trim(coalesce(p_venue,''))) NOT BETWEEN 1 AND 160 OR p_format IS NULL OR p_format NOT BETWEEN 1 AND 11 OR p_team_count IS NULL OR p_team_count NOT BETWEEN 2 AND 8 OR (p_capacity IS NOT NULL AND p_capacity NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'INVALID_SCHEDULE_DETAILS'; END IF;
 SELECT id INTO game FROM public.game_days WHERE community_id=c.id AND game_date=p_date AND start_time=p_time AND status<>'CANCELLED' ORDER BY sequence_number LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('id',game,'created',false); END IF;
 game:=public.ballers_create_game_day(c.id,p_date,p_time,trim(p_venue),p_format,p_team_count,p_capacity);
 INSERT INTO public.ballers_game_settings(game_day_id) VALUES(game);
 INSERT INTO public.ballers_community_game_operations(operation_id,community_id,game_day_id,actor_id,request) VALUES(p_operation,c.id,game,actor,payload);
 RETURN jsonb_build_object('id',game,'created',true);
END $$;
REVOKE ALL ON FUNCTION public.ballers_schedule_community_game(uuid,uuid,uuid,date,time,text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_schedule_community_game(uuid,uuid,uuid,date,time,text,integer,integer,integer) TO authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261118_013');
NOTIFY pgrst,'reload schema';
COMMIT;
