-- BALLERS 0.2.12: deploy with the matching client. No historical score changes.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261029_008') THEN RAISE EXCEPTION 'Apply 008 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261117_009') THEN RAISE EXCEPTION '009 already applied'; END IF;
END $$;

CREATE TABLE public.ballers_game_leaders(
 game_day_id uuid PRIMARY KEY REFERENCES public.game_days(id) ON DELETE CASCADE,
 player_id uuid NOT NULL REFERENCES public.player_profiles(id),
 enabled boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ballers_leader_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 previous_player_id uuid REFERENCES public.player_profiles(id),
 player_id uuid NOT NULL REFERENCES public.player_profiles(id),
 action text NOT NULL CHECK(action IN('ASSIGN','TRANSFER','RECOVER')),
 reason text, version bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ballers_start_operations(
 operation_id uuid PRIMARY KEY,
 game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 expected_sequence integer NOT NULL, leader_version bigint NOT NULL,
 match_id uuid NOT NULL REFERENCES public.ballers_matches(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ballers_leader_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.ballers_leader_policy DEFAULT VALUES;
ALTER TABLE public.ballers_game_leaders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ballers_leader_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ballers_start_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ballers_leader_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_game_leaders, public.ballers_leader_audit, public.ballers_start_operations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ballers_leader_policy FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.ballers_leader_audit_id_seq FROM PUBLIC,anon,authenticated;
-- Preserve the person already operating an unfinished match. Other days require explicit choice.
INSERT INTO public.ballers_game_leaders(game_day_id,player_id,enabled)
 SELECT game_day_id,operator_id,false FROM public.ballers_matches WHERE status IN('LIVE','PAUSED');
-- Install safely beside the old client. Assignment opts in one day; release activation enables all days.
CREATE FUNCTION public.ballers_leader_required(p_game uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM public.ballers_leader_policy WHERE singleton),false) OR coalesce((SELECT enabled FROM public.ballers_game_leaders WHERE game_day_id=p_game),false);
$$;
REVOKE ALL ON FUNCTION public.ballers_leader_required(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ballers_game_control(p_game uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; l public.ballers_game_leaders%ROWTYPE; BEGIN
 IF NOT public.ballers_can_read_game(p_game) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 SELECT * INTO l FROM public.ballers_game_leaders WHERE game_day_id=p_game;
 RETURN jsonb_build_object('required',public.ballers_leader_required(p_game),'leader_id',l.player_id,'version',coalesce(l.version,0),
  'leader_name',(SELECT coalesce(display_name,first_name) FROM public.player_profiles WHERE id=l.player_id),
  'sequence',coalesce((SELECT sequence FROM public.ballers_sessions WHERE game_day_id=p_game),0),
  'is_leader',coalesce(actor=l.player_id,false),
  'history',coalesce((SELECT jsonb_agg(x ORDER BY x.id DESC) FROM (
    SELECT a.id,a.action,a.reason,a.version,a.created_at,coalesce(p.display_name,p.first_name) leader_name,
      coalesce(b.display_name,b.first_name) previous_name,coalesce(c.display_name,c.first_name) actor_name
    FROM public.ballers_leader_audit a JOIN public.player_profiles p ON p.id=a.player_id
      LEFT JOIN public.player_profiles b ON b.id=a.previous_player_id
      LEFT JOIN public.player_profiles c ON c.user_id=a.actor_user_id
    WHERE a.game_day_id=p_game ORDER BY a.id DESC LIMIT 20
  ) x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ballers_game_control(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_game_control(uuid) TO authenticated;

CREATE FUNCTION public.ballers_set_game_leader(p_game uuid,p_player uuid,p_version bigint,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; l public.ballers_game_leaders%ROWTYPE; actor uuid; manager boolean; v bigint; action text; BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL OR NOT public.ballers_can_read_game(g.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO l FROM public.ballers_game_leaders WHERE game_day_id=g.id;
 manager:=public.ballers_is_manager(g.community_id);
 IF NOT manager AND actor IS DISTINCT FROM l.player_id THEN RAISE EXCEPTION 'LEADER_TRANSFER_FORBIDDEN'; END IF;
 IF p_version IS NULL OR p_version<>coalesce(l.version,0) THEN RAISE EXCEPTION 'LEADER_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.player_profiles p WHERE p.id=p_player AND p.user_id IS NOT NULL
   AND (EXISTS(SELECT 1 FROM public.game_participants a WHERE a.game_day_id=g.id AND a.player_id=p.id AND a.attendance_status='GOING')
     OR EXISTS(SELECT 1 FROM public.community_members c WHERE c.community_id=g.community_id AND c.player_id=p.id AND c.role IN('OWNER','MANAGER'))))
 THEN RAISE EXCEPTION 'LEADER_MUST_PARTICIPATE'; END IF;
 IF l.player_id=p_player THEN RETURN public.ballers_game_control(g.id); END IF;
 IF l.player_id IS NOT NULL AND actor IS DISTINCT FROM l.player_id AND length(trim(coalesce(p_reason,'')))<5
 THEN RAISE EXCEPTION 'LEADER_RECOVERY_REASON_REQUIRED'; END IF;
 v:=coalesce(l.version,0)+1;
 action:=CASE WHEN l.player_id IS NULL THEN 'ASSIGN' WHEN actor=l.player_id THEN 'TRANSFER' ELSE 'RECOVER' END;
 INSERT INTO public.ballers_game_leaders(game_day_id,player_id,version) VALUES(g.id,p_player,v)
  ON CONFLICT(game_day_id) DO UPDATE SET player_id=excluded.player_id,enabled=true,version=excluded.version,updated_at=now();
 -- Bump the match version too: in-flight writes from the previous leader become stale.
 UPDATE public.ballers_matches SET operator_id=p_player,version=version+1 WHERE game_day_id=g.id AND status IN('LIVE','PAUSED');
 INSERT INTO public.ballers_leader_audit(game_day_id,actor_user_id,previous_player_id,player_id,action,reason,version)
  VALUES(g.id,auth.uid(),l.player_id,p_player,action,nullif(trim(p_reason),''),v);
 RETURN public.ballers_game_control(g.id);
END $$;
REVOKE ALL ON FUNCTION public.ballers_set_game_leader(uuid,uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_set_game_leader(uuid,uuid,bigint,text) TO authenticated;

-- Private implementations retain the existing rotation and result policy logic.
ALTER FUNCTION public.ballers_game_action(uuid,text,jsonb) RENAME TO ballers_game_action_pre009;
ALTER FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) RENAME TO ballers_match_action_pre009;
ALTER FUNCTION public.ballers_alpha_snapshot(uuid) RENAME TO ballers_alpha_snapshot_pre009;
ALTER FUNCTION public.ballers_start_match(uuid) RENAME TO ballers_start_match_pre009;
REVOKE ALL ON FUNCTION public.ballers_game_action_pre009(uuid,text,jsonb),public.ballers_match_action_pre009(uuid,bigint,text,jsonb),public.ballers_alpha_snapshot_pre009(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ballers_start_match_pre009(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ballers_game_action_pre009(p_game uuid,p_action text,p_payload jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; ss public.ballers_game_settings%ROWTYPE; se public.ballers_sessions%ROWTYPE; t uuid; a uuid; b uuid; ca uuid; cb uuid; op uuid; result uuid; num int; actor uuid; ids uuid[];
BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT (public.ballers_is_manager(g.community_id) OR (p_action IN('START','LINEUP') AND EXISTS(SELECT 1 FROM public.ballers_game_leaders l JOIN public.player_profiles p ON p.id=l.player_id WHERE l.game_day_id=g.id AND p.user_id=auth.uid()))) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 CASE p_action
 WHEN 'SETTINGS' THEN
  INSERT INTO public.ballers_game_settings(game_day_id,duration_seconds,goal_limit,end_mode,max_streak,is_open)
  VALUES(g.id,(p_payload->>'duration_seconds')::int,(p_payload->>'goal_limit')::int,p_payload->>'end_mode',(p_payload->>'max_streak')::int,COALESCE((p_payload->>'is_open')::boolean,false))
  ON CONFLICT(game_day_id) DO UPDATE SET duration_seconds=excluded.duration_seconds,goal_limit=excluded.goal_limit,end_mode=excluded.end_mode,max_streak=excluded.max_streak,is_open=excluded.is_open;
 WHEN 'SETUP' THEN
  IF EXISTS(SELECT 1 FROM public.ballers_matches WHERE game_day_id=g.id) THEN RAISE EXCEPTION 'Формат и вместимость меняются до первого матча';END IF;
  IF (p_payload->>'format')::int NOT BETWEEN 1 AND 11 OR (p_payload->>'format') IS NULL OR (p_payload->>'capacity')::int<1 OR (p_payload->>'capacity') IS NULL THEN RAISE EXCEPTION 'Неверный формат или вместимость'; END IF;
  IF (p_payload->>'capacity')::int<(SELECT count(*) FROM public.game_participants WHERE game_day_id=g.id AND attendance_status='GOING')+(SELECT count(*) FROM public.ballers_waitlist WHERE game_day_id=g.id AND offered) THEN RAISE EXCEPTION 'Нельзя уменьшить вместимость ниже допущенных игроков и предложенных мест';END IF;
  UPDATE public.game_days SET format=(p_payload->>'format')::int,capacity=(p_payload->>'capacity')::int WHERE id=g.id;
  PERFORM public.ballers_offer_next(g.id);
 WHEN 'CLOSE' THEN
  IF EXISTS(SELECT 1 FROM public.ballers_matches WHERE game_day_id=g.id AND status IN('LIVE','PAUSED')) THEN RAISE EXCEPTION 'Сначала завершите текущий матч';END IF;
  UPDATE public.game_days SET status='COMPLETED' WHERE id=g.id;
 WHEN 'ROLES' THEN
  t:=(p_payload->>'team_id')::uuid;ca:=(p_payload->>'captain_id')::uuid;op:=(p_payload->>'responsible_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.game_day_teams WHERE id=t AND game_day_id=g.id) THEN RAISE EXCEPTION 'TEAM_GAME_MISMATCH'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.game_day_team_players WHERE team_id=t AND player_id=ca) OR NOT EXISTS(SELECT 1 FROM public.game_day_team_players WHERE team_id=t AND player_id=op) THEN RAISE EXCEPTION 'Капитан и ответственный должны быть в составе команды'; END IF;
  INSERT INTO public.ballers_team_roles(team_id,captain_id,responsible_id,can_manage_attendance) VALUES(t,ca,op,COALESCE((p_payload->>'can_manage_attendance')::boolean,false))
  ON CONFLICT(team_id) DO UPDATE SET captain_id=excluded.captain_id,responsible_id=excluded.responsible_id,can_manage_attendance=excluded.can_manage_attendance;
 WHEN 'LINEUP' THEN
  IF EXISTS(SELECT 1 FROM public.ballers_matches WHERE game_day_id=g.id) THEN RAISE EXCEPTION 'Очередь уже запущена; история не переписывается'; END IF;
  a:=(p_payload->>'team_a')::uuid;b:=(p_payload->>'team_b')::uuid;t:=(p_payload->>'first_draw_out')::uuid;
  IF a IS NULL OR b IS NULL OR a=b OR t IS NULL OR t NOT IN(a,b) THEN RAISE EXCEPTION 'Выберите две разные команды и уходящую при первой ничьей'; END IF;
  IF (SELECT count(*) FROM public.game_day_teams WHERE game_day_id=g.id AND id IN(a,b))<>2 THEN RAISE EXCEPTION 'TEAM_GAME_MISMATCH'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY sort_order),'{}') INTO ids FROM public.game_day_teams WHERE game_day_id=g.id AND id NOT IN(a,b);
  INSERT INTO public.ballers_sessions(game_day_id,team_a,team_b,older_team,queue) VALUES(g.id,a,b,t,ids) ON CONFLICT(game_day_id) DO UPDATE SET team_a=a,team_b=b,older_team=t,queue=ids;
 WHEN 'START' THEN
  IF EXISTS(SELECT 1 FROM public.ballers_matches WHERE game_day_id=g.id AND status IN('LIVE','PAUSED')) THEN RAISE EXCEPTION 'Матч уже идёт'; END IF;
  SELECT * INTO se FROM public.ballers_sessions WHERE game_day_id=g.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Сначала сохраните стартовую пару'; END IF;
  SELECT * INTO ss FROM public.ballers_game_settings WHERE game_day_id=g.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Сначала сохраните правила'; END IF;
  a:=se.team_a;b:=se.team_b;
  IF (SELECT count(*) FROM public.game_day_team_players WHERE team_id=a)<g.format OR (SELECT count(*) FROM public.game_day_team_players WHERE team_id=b)<g.format THEN RAISE EXCEPTION 'Не хватает игроков на поле'; END IF;
  SELECT captain_id INTO ca FROM public.ballers_team_roles WHERE team_id=a;
  SELECT captain_id INTO cb FROM public.ballers_team_roles WHERE team_id=b;
  IF ca IS NULL OR cb IS NULL OR NOT EXISTS(SELECT 1 FROM public.game_day_team_players WHERE team_id=a AND player_id=ca) OR NOT EXISTS(SELECT 1 FROM public.game_day_team_players WHERE team_id=b AND player_id=cb) THEN RAISE EXCEPTION 'Назначьте капитанов обеих команд'; END IF;
  op:=NULL;IF cardinality(se.queue)>0 THEN SELECT responsible_id INTO op FROM public.ballers_team_roles WHERE team_id=se.queue[1]; END IF;
  IF public.ballers_leader_required(g.id) THEN SELECT player_id INTO op FROM public.ballers_game_leaders WHERE game_day_id=g.id; IF op IS NULL THEN RAISE EXCEPTION 'LEADER_REQUIRED'; END IF; ELSE op:=coalesce(op,actor); END IF;num:=se.sequence+1;
  INSERT INTO public.ballers_matches(game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,duration_seconds,goal_limit,end_mode,max_streak,is_test)
   VALUES(g.id,num,a,b,ca,cb,op,ss.duration_seconds,ss.goal_limit,ss.end_mode,ss.max_streak,
   EXISTS(SELECT 1 FROM public.game_day_team_players aa JOIN public.player_profiles pp ON pp.id=aa.player_id WHERE aa.game_day_id=g.id AND pp.user_id IS NULL AND pp.first_name LIKE 'BALLERS_TEST_%')) RETURNING id INTO result;
  INSERT INTO public.ballers_match_rosters(match_id,player_id,team_id) SELECT result,player_id,team_id FROM public.game_day_team_players WHERE team_id IN(a,b);
  UPDATE public.ballers_sessions SET sequence=num WHERE game_day_id=g.id;
 ELSE RAISE EXCEPTION 'UNKNOWN_GAME_ACTION';
 END CASE;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.ballers_game_action_pre009(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ballers_game_action(p_game uuid,p_action text,p_payload jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_action='START' AND public.ballers_leader_required(p_game) THEN RAISE EXCEPTION 'START_REQUIRES_OPERATION'; END IF;
 IF NOT public.ballers_is_manager((SELECT community_id FROM public.game_days WHERE id=p_game)) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 RETURN public.ballers_game_action_pre009(p_game,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.ballers_game_action(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_game_action(uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.ballers_start_match(p_game uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF public.ballers_leader_required(p_game) THEN RAISE EXCEPTION 'START_REQUIRES_OPERATION'; END IF;
 RETURN public.ballers_start_match_pre009(p_game);
END $$;
REVOKE ALL ON FUNCTION public.ballers_start_match(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_start_match(uuid) TO authenticated;

CREATE FUNCTION public.ballers_start_game_match(p_game uuid,p_operation uuid,p_expected_sequence integer,p_leader_version bigint) RETURNS uuid
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
REVOKE ALL ON FUNCTION public.ballers_start_game_match(uuid,uuid,integer,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_start_game_match(uuid,uuid,integer,bigint) TO authenticated;

CREATE FUNCTION public.ballers_match_action(p_match uuid,p_version bigint,p_action text,p_payload jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ballers_matches%ROWTYPE; actor uuid; leader uuid; BEGIN
 SELECT * INTO m FROM public.ballers_matches WHERE id=p_match;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
 PERFORM 1 FROM public.game_days WHERE id=m.game_day_id FOR UPDATE;
 SELECT * INTO m FROM public.ballers_matches WHERE id=p_match FOR UPDATE;
 IF NOT public.ballers_can_read_game(m.game_day_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 SELECT player_id INTO leader FROM public.ballers_game_leaders WHERE game_day_id=m.game_day_id;
 IF p_action='OPERATOR' AND public.ballers_leader_required(m.game_day_id) THEN RAISE EXCEPTION 'USE_LEADER_TRANSFER'; END IF;
 IF public.ballers_leader_required(m.game_day_id) AND (p_action IN('EVENT','PAUSE','RESUME','FINISH') OR (p_action='UNDO' AND m.status IN('LIVE','PAUSED'))) THEN
  IF actor IS NULL OR actor IS DISTINCT FROM leader OR actor IS DISTINCT FROM m.operator_id THEN RAISE EXCEPTION 'LEADER_REQUIRED'; END IF;
 END IF;
 PERFORM public.ballers_match_action_pre009(p_match,p_version,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) TO authenticated;

CREATE FUNCTION public.ballers_alpha_snapshot(p_game uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.ballers_alpha_snapshot_pre009(p_game)||jsonb_build_object('control',public.ballers_game_control(p_game));
$$;
REVOKE ALL ON FUNCTION public.ballers_alpha_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_alpha_snapshot(uuid) TO authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261117_009');
NOTIFY pgrst,'reload schema';
COMMIT;
