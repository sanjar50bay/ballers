-- New days have no saved settings until the organizer changes them.
-- Initialize defaults atomically on the first authorized start; preserve custom rules.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261117_009') THEN RAISE EXCEPTION 'Apply 009 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_010') THEN RAISE EXCEPTION '010 already applied'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ballers_start_game_match(p_game uuid,p_operation uuid,p_expected_sequence integer,p_leader_version bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; l public.ballers_game_leaders%ROWTYPE; op public.ballers_start_operations%ROWTYPE;
 actor uuid; m uuid; seq integer; a uuid; b uuid; live public.ballers_matches%ROWTYPE; BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_can_read_game(g.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_operation IS NULL OR p_expected_sequence IS NULL OR p_expected_sequence<0 OR p_leader_version IS NULL THEN RAISE EXCEPTION 'INVALID_START_OPERATION'; END IF;
 SELECT * INTO op FROM public.ballers_start_operations WHERE operation_id=p_operation;
 IF FOUND THEN
  IF op.game_day_id<>g.id OR op.actor_user_id<>auth.uid() OR op.expected_sequence<>p_expected_sequence OR op.leader_version<>p_leader_version
   THEN RAISE EXCEPTION 'START_OPERATION_REUSE'; END IF;
  RETURN op.match_id;
 END IF;
 SELECT * INTO l FROM public.ballers_game_leaders WHERE game_day_id=g.id;
 IF actor IS DISTINCT FROM l.player_id THEN RAISE EXCEPTION 'LEADER_REQUIRED'; END IF;
 IF l.version<>p_leader_version THEN RAISE EXCEPTION 'LEADER_CHANGED'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 SELECT * INTO live FROM public.ballers_matches WHERE game_day_id=g.id AND status IN('LIVE','PAUSED');
 IF FOUND THEN
  IF live.sequence<>p_expected_sequence+1 THEN RAISE EXCEPTION 'MATCH_ALREADY_RUNNING'; END IF;
  m:=live.id;
 ELSE
  SELECT coalesce((SELECT sequence FROM public.ballers_sessions WHERE game_day_id=g.id),0) INTO seq;
  IF seq<>p_expected_sequence THEN RAISE EXCEPTION 'START_SEQUENCE_CHANGED'; END IF;
  INSERT INTO public.ballers_game_settings(game_day_id) VALUES(g.id) ON CONFLICT(game_day_id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.ballers_sessions WHERE game_day_id=g.id) THEN
   SELECT id INTO a FROM public.game_day_teams WHERE game_day_id=g.id ORDER BY sort_order,id LIMIT 1;
   SELECT id INTO b FROM public.game_day_teams WHERE game_day_id=g.id ORDER BY sort_order,id OFFSET 1 LIMIT 1;
   IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Сначала соберите минимум две команды'; END IF;
   PERFORM public.ballers_game_action_pre009(g.id,'LINEUP',jsonb_build_object('team_a',a,'team_b',b,'first_draw_out',a));
  END IF;
  m:=public.ballers_game_action_pre009(g.id,'START','{}'::jsonb);
 END IF;
 INSERT INTO public.ballers_start_operations(operation_id,game_day_id,actor_user_id,expected_sequence,leader_version,match_id)
  VALUES(p_operation,g.id,auth.uid(),p_expected_sequence,p_leader_version,m);
 RETURN m;
END $$;
-- CREATE OR REPLACE retains the existing authenticated-only execution grant.
INSERT INTO public.ballers_migration_history(version) VALUES('20261118_010');
NOTIFY pgrst,'reload schema';
COMMIT;
