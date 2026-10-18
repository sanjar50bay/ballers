-- INTEGRATED ALPHA. Apply only to BALLERS Test after 001. No baseline rerun.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261012_001') THEN RAISE EXCEPTION 'Apply stage 001 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261012_002') THEN RAISE EXCEPTION 'Migration 002 already applied'; END IF;
END $$;
ALTER TABLE public.game_days DROP CONSTRAINT game_days_format_check;
ALTER TABLE public.game_days ADD CONSTRAINT game_days_format_check CHECK(format BETWEEN 1 AND 11);
ALTER TABLE public.communities DROP CONSTRAINT communities_default_format_check;
ALTER TABLE public.communities ADD CONSTRAINT communities_default_format_check CHECK(default_format BETWEEN 1 AND 11);
CREATE TABLE public.ballers_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
 game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,kind text NOT NULL,message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz);
CREATE TABLE public.ballers_waitlist(
 game_day_id uuid REFERENCES public.game_days(id) ON DELETE CASCADE,player_id uuid REFERENCES public.player_profiles(id) ON DELETE CASCADE,
 joined_at timestamptz NOT NULL DEFAULT now(),offered boolean NOT NULL DEFAULT false,PRIMARY KEY(game_day_id,player_id));
CREATE TABLE public.ballers_game_settings(
 game_day_id uuid PRIMARY KEY REFERENCES public.game_days(id) ON DELETE CASCADE,duration_seconds int NOT NULL DEFAULT 420 CHECK(duration_seconds BETWEEN 30 AND 7200),
 goal_limit int NOT NULL DEFAULT 2 CHECK(goal_limit BETWEEN 1 AND 99),end_mode text NOT NULL DEFAULT 'FIRST_REACHED' CHECK(end_mode IN('TIME_ONLY','GOALS_ONLY','FIRST_REACHED')),
 max_streak int CHECK(max_streak>=1),is_open boolean NOT NULL DEFAULT false);
CREATE TABLE public.ballers_team_roles(
 team_id uuid PRIMARY KEY REFERENCES public.game_day_teams(id) ON DELETE CASCADE,captain_id uuid REFERENCES public.player_profiles(id),responsible_id uuid REFERENCES public.player_profiles(id),
 can_manage_attendance boolean NOT NULL DEFAULT false);
CREATE TABLE public.ballers_sessions(
 game_day_id uuid PRIMARY KEY REFERENCES public.game_days(id) ON DELETE CASCADE,team_a uuid NOT NULL REFERENCES public.game_day_teams(id),team_b uuid NOT NULL REFERENCES public.game_day_teams(id),
 older_team uuid NOT NULL REFERENCES public.game_day_teams(id),queue uuid[] NOT NULL DEFAULT '{}',sequence int NOT NULL DEFAULT 0,streak_team uuid,streak_count int NOT NULL DEFAULT 0);
CREATE TABLE public.ballers_matches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,sequence int NOT NULL,
 team_a uuid NOT NULL REFERENCES public.game_day_teams(id),team_b uuid NOT NULL REFERENCES public.game_day_teams(id),captain_a uuid NOT NULL REFERENCES public.player_profiles(id),captain_b uuid NOT NULL REFERENCES public.player_profiles(id),
 operator_id uuid NOT NULL REFERENCES public.player_profiles(id),status text NOT NULL DEFAULT 'LIVE' CHECK(status IN('LIVE','PAUSED','PENDING','DISPUTED','VERIFIED','CANCELLED')),
 duration_seconds int NOT NULL,goal_limit int NOT NULL,end_mode text NOT NULL,max_streak int,elapsed_seconds int NOT NULL DEFAULT 0,running_since timestamptz DEFAULT now(),
 version bigint NOT NULL DEFAULT 0,score_a int NOT NULL DEFAULT 0,score_b int NOT NULL DEFAULT 0,confirmed_a boolean NOT NULL DEFAULT false,confirmed_b boolean NOT NULL DEFAULT false,
 is_test boolean NOT NULL DEFAULT false,resolution_note text,finished_at timestamptz,UNIQUE(game_day_id,sequence));
CREATE UNIQUE INDEX ballers_one_live_match ON public.ballers_matches(game_day_id) WHERE status IN('LIVE','PAUSED');
CREATE TABLE public.ballers_match_rosters(match_id uuid REFERENCES public.ballers_matches(id) ON DELETE CASCADE,player_id uuid REFERENCES public.player_profiles(id),team_id uuid REFERENCES public.game_day_teams(id),PRIMARY KEY(match_id,player_id));
CREATE TABLE public.ballers_match_events(
 id uuid PRIMARY KEY,match_id uuid NOT NULL REFERENCES public.ballers_matches(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN('GOAL','OWN_GOAL','SAVE')),
 player_id uuid NOT NULL REFERENCES public.player_profiles(id),assist_id uuid REFERENCES public.player_profiles(id),team_id uuid NOT NULL REFERENCES public.game_day_teams(id),
 author_id uuid NOT NULL REFERENCES auth.users(id),elapsed_seconds int NOT NULL,voided boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ballers_match_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,match_id uuid REFERENCES public.ballers_matches(id) ON DELETE CASCADE,actor_id uuid NOT NULL REFERENCES auth.users(id),action text NOT NULL,version bigint NOT NULL,payload jsonb NOT NULL,result_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION public.ballers_can_read_game(p_game uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.game_days g WHERE g.id=p_game AND
 (public.ballers_is_manager(g.community_id) OR EXISTS(SELECT 1 FROM public.community_members c JOIN public.player_profiles p ON p.id=c.player_id WHERE c.community_id=g.community_id AND p.user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.game_participants gp JOIN public.player_profiles p ON p.id=gp.player_id WHERE gp.game_day_id=g.id AND p.user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.ballers_game_settings s WHERE s.game_day_id=g.id AND s.is_open)));
$$;
REVOKE ALL ON FUNCTION public.ballers_can_read_game(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_can_read_game(uuid) TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ballers_notifications','ballers_waitlist','ballers_game_settings','ballers_team_roles','ballers_sessions','ballers_matches','ballers_match_rosters','ballers_match_events','ballers_match_audit'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY personal_notifications ON public.ballers_notifications FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.player_profiles p WHERE p.id=player_id AND p.user_id=auth.uid()));
CREATE POLICY game_waitlist_read ON public.ballers_waitlist FOR SELECT TO authenticated USING(public.ballers_can_read_game(game_day_id));
CREATE POLICY game_settings_read ON public.ballers_game_settings FOR SELECT TO authenticated USING(public.ballers_can_read_game(game_day_id));
CREATE POLICY game_roles_read ON public.ballers_team_roles FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.game_day_teams t WHERE t.id=team_id AND public.ballers_can_read_game(t.game_day_id)));
CREATE POLICY session_read ON public.ballers_sessions FOR SELECT TO authenticated USING(public.ballers_can_read_game(game_day_id));
CREATE POLICY matches_read ON public.ballers_matches FOR SELECT TO authenticated USING(public.ballers_can_read_game(game_day_id));
CREATE POLICY match_rosters_read ON public.ballers_match_rosters FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.id=match_id AND public.ballers_can_read_game(m.game_day_id)));
CREATE POLICY match_events_read ON public.ballers_match_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.id=match_id AND public.ballers_can_read_game(m.game_day_id)));
CREATE POLICY match_audit_read ON public.ballers_match_audit FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.ballers_matches m WHERE m.id=match_id AND public.ballers_can_read_game(m.game_day_id)));

CREATE FUNCTION public.ballers_invitation_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.attendance_status='INVITED' AND (TG_OP='INSERT' OR OLD.attendance_status IS DISTINCT FROM NEW.attendance_status) THEN
 INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message) SELECT NEW.player_id,NEW.game_day_id,'INVITE','Приглашение: '||title FROM public.game_days WHERE id=NEW.game_day_id;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER ballers_invitation_alert AFTER INSERT OR UPDATE OF attendance_status ON public.game_participants FOR EACH ROW EXECUTE FUNCTION public.ballers_invitation_notification();
REVOKE ALL ON FUNCTION public.ballers_invitation_notification() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ballers_mark_read(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 UPDATE public.ballers_notifications n SET read_at=now() FROM public.player_profiles p WHERE n.id=p_id AND p.id=n.player_id AND p.user_id=auth.uid(); END $$;
REVOKE ALL ON FUNCTION public.ballers_mark_read(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.ballers_mark_read(uuid) TO authenticated;

CREATE FUNCTION public.ballers_offer_next(p_game uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid; v_cap int; v_free int;
BEGIN
 SELECT capacity INTO v_cap FROM public.game_days WHERE id=p_game FOR UPDATE;
 v_free:=COALESCE(v_cap,2147483647)-(SELECT count(*) FROM public.game_participants WHERE game_day_id=p_game AND attendance_status='GOING')-(SELECT count(*) FROM public.ballers_waitlist WHERE game_day_id=p_game AND offered);
 IF v_free>0 THEN
  FOR v_id IN SELECT player_id FROM public.ballers_waitlist WHERE game_day_id=p_game AND NOT offered ORDER BY joined_at,player_id LIMIT v_free LOOP
   UPDATE public.ballers_waitlist SET offered=true WHERE game_day_id=p_game AND player_id=v_id;
   INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message) VALUES(v_id,p_game,'PLACE_OFFER','Освободилось место. Подтверди участие кнопкой «Иду».');
  END LOOP;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.ballers_offer_next(uuid) FROM PUBLIC,anon,authenticated;

-- Guards roster mutations while a match runs. Historical snapshots stay intact afterwards.
CREATE FUNCTION public.ballers_guard_live_roster() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_game uuid;BEGIN
 v_game:=CASE WHEN TG_OP='DELETE' THEN OLD.game_day_id ELSE NEW.game_day_id END;
 IF EXISTS(SELECT 1 FROM public.ballers_matches WHERE game_day_id=v_game AND status IN('LIVE','PAUSED')) THEN RAISE EXCEPTION 'Составы нельзя менять во время матча. Сначала завершите матч.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER ballers_lock_live_roster BEFORE INSERT OR UPDATE OR DELETE ON public.game_day_team_players FOR EACH ROW EXECUTE FUNCTION public.ballers_guard_live_roster();
CREATE TRIGGER ballers_lock_live_teams BEFORE INSERT OR UPDATE OR DELETE ON public.game_day_teams FOR EACH ROW EXECUTE FUNCTION public.ballers_guard_live_roster();
REVOKE ALL ON FUNCTION public.ballers_guard_live_roster() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ballers_set_attendance(p_game_id uuid,p_player_id uuid,p_status public.attendance_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; v_user uuid; v_old public.attendance_status; v_allowed boolean; v_wait boolean; v_rows int; v_version bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO g FROM public.game_days WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 IF p_status IS NULL OR p_status::text NOT IN('GOING','MAYBE','DECLINED','INVITED') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE'; END IF;
 SELECT user_id INTO v_user FROM public.player_profiles WHERE id=p_player_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
 v_allowed:=public.ballers_is_manager(g.community_id) OR EXISTS(SELECT 1 FROM public.ballers_team_roles r JOIN public.game_day_team_players a ON a.team_id=r.team_id JOIN public.player_profiles cp ON cp.id=r.captain_id WHERE a.game_day_id=g.id AND a.player_id=p_player_id AND r.can_manage_attendance AND cp.user_id=auth.uid());
 IF v_user IS DISTINCT FROM auth.uid() AND NOT v_allowed THEN RAISE EXCEPTION 'ATTENDANCE_FORBIDDEN'; END IF;
 IF p_status='INVITED' AND NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 SELECT attendance_status INTO v_old FROM public.game_participants WHERE game_day_id=g.id AND player_id=p_player_id;
 IF v_old IS NULL AND NOT EXISTS(SELECT 1 FROM public.community_members WHERE community_id=g.community_id AND player_id=p_player_id) THEN RAISE EXCEPTION 'INVITATION_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_match_rosters r JOIN public.ballers_matches m ON m.id=r.match_id WHERE m.game_day_id=g.id AND m.status IN('LIVE','PAUSED') AND r.player_id=p_player_id) AND p_status<>'GOING' THEN RAISE EXCEPTION 'Игрок в текущем матче. Сначала завершите матч.'; END IF;
 v_wait:=false;
 IF p_status='GOING' AND v_old IS DISTINCT FROM 'GOING' THEN
  PERFORM public.ballers_offer_next(g.id);
  IF NOT EXISTS(SELECT 1 FROM public.ballers_waitlist WHERE game_day_id=g.id AND player_id=p_player_id AND offered) AND
    ((g.capacity IS NOT NULL AND (SELECT count(*) FROM public.game_participants WHERE game_day_id=g.id AND attendance_status='GOING')+(SELECT count(*) FROM public.ballers_waitlist WHERE game_day_id=g.id AND offered)>=g.capacity)
     OR EXISTS(SELECT 1 FROM public.ballers_waitlist WHERE game_day_id=g.id)) THEN v_wait:=true; END IF;
 END IF;
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type)
 VALUES(g.id,p_player_id,CASE WHEN v_wait THEN 'MAYBE'::public.attendance_status ELSE p_status END,'MEMBER')
 ON CONFLICT(game_day_id,player_id) DO UPDATE SET attendance_status=excluded.attendance_status;
 IF v_wait THEN
  INSERT INTO public.ballers_waitlist(game_day_id,player_id) VALUES(g.id,p_player_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows>0 THEN INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message)
   SELECT player_id,g.id,'WAITLIST','В игре появились ожидающие игроки.' FROM public.game_participants WHERE game_day_id=g.id; END IF;
 ELSE DELETE FROM public.ballers_waitlist WHERE game_day_id=g.id AND player_id=p_player_id; END IF;
 IF p_status<>'GOING' OR v_wait THEN DELETE FROM public.game_day_team_players WHERE game_day_id=g.id AND player_id=p_player_id; END IF;
 IF v_user IS DISTINCT FROM auth.uid() THEN INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message) VALUES(p_player_id,g.id,'ATTENDANCE','Ответ на приглашение изменён ответственным: '||CASE WHEN v_wait THEN 'ожидание' ELSE p_status::text END); END IF;
 PERFORM public.ballers_offer_next(g.id);
 UPDATE public.game_days SET roster_version=roster_version+1 WHERE id=g.id RETURNING roster_version INTO v_version;
 INSERT INTO public.ballers_pre_match_audit(game_day_id,actor_user_id,action,roster_version) VALUES(g.id,auth.uid(),'ATTENDANCE',v_version);
END $$;

CREATE FUNCTION public.ballers_game_action(p_game uuid,p_action text,p_payload jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; ss public.ballers_game_settings%ROWTYPE; se public.ballers_sessions%ROWTYPE; t uuid; a uuid; b uuid; ca uuid; cb uuid; op uuid; result uuid; num int; actor uuid; ids uuid[];
BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
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
  op:=COALESCE(op,actor);num:=se.sequence+1;
  INSERT INTO public.ballers_matches(game_day_id,sequence,team_a,team_b,captain_a,captain_b,operator_id,duration_seconds,goal_limit,end_mode,max_streak,is_test)
   VALUES(g.id,num,a,b,ca,cb,op,ss.duration_seconds,ss.goal_limit,ss.end_mode,ss.max_streak,
   EXISTS(SELECT 1 FROM public.game_day_team_players aa JOIN public.player_profiles pp ON pp.id=aa.player_id WHERE aa.game_day_id=g.id AND pp.user_id IS NULL AND pp.first_name LIKE 'BALLERS_TEST_%')) RETURNING id INTO result;
  INSERT INTO public.ballers_match_rosters(match_id,player_id,team_id) SELECT result,player_id,team_id FROM public.game_day_team_players WHERE team_id IN(a,b);
  UPDATE public.ballers_sessions SET sequence=num WHERE game_day_id=g.id;
 ELSE RAISE EXCEPTION 'UNKNOWN_GAME_ACTION';
 END CASE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ballers_game_action(uuid,text,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_game_action(uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.ballers_finish_rotation(p_match uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ballers_matches%ROWTYPE; se public.ballers_sessions%ROWTYPE; win uuid; out_team uuid; stay uuid; enter_team uuid; lim int; streak int;
BEGIN
 SELECT * INTO m FROM public.ballers_matches WHERE id=p_match;
 SELECT * INTO se FROM public.ballers_sessions WHERE game_day_id=m.game_day_id FOR UPDATE;
 lim:=m.max_streak;
 win:=CASE WHEN m.score_a>m.score_b THEN m.team_a WHEN m.score_b>m.score_a THEN m.team_b ELSE NULL END;
 streak:=CASE WHEN win IS NULL THEN 0 WHEN win=se.streak_team THEN se.streak_count+1 ELSE 1 END;
 out_team:=CASE WHEN win IS NULL THEN se.older_team WHEN win=m.team_a THEN m.team_b ELSE m.team_a END;
 IF win IS NOT NULL AND lim IS NOT NULL AND streak>=lim AND cardinality(se.queue)>0 THEN out_team:=win;streak:=0;END IF;
 stay:=CASE WHEN out_team=m.team_a THEN m.team_b ELSE m.team_a END;
 IF cardinality(se.queue)>0 THEN
  enter_team:=se.queue[1];UPDATE public.ballers_sessions SET team_a=stay,team_b=enter_team,older_team=stay,queue=se.queue[2:cardinality(se.queue)]||ARRAY[out_team],streak_team=win,streak_count=streak WHERE game_day_id=m.game_day_id;
 ELSE UPDATE public.ballers_sessions SET older_team=stay,streak_team=win,streak_count=streak WHERE game_day_id=m.game_day_id;END IF;
END $$;
REVOKE ALL ON FUNCTION public.ballers_finish_rotation(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ballers_match_action(p_match uuid,p_version bigint,p_action text,p_payload jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ballers_matches%ROWTYPE; g public.game_days%ROWTYPE; actor uuid; manager boolean; operator boolean; tm uuid; aid uuid; eid uuid; kind text; elapsed int; sa int; sb int; done boolean; old_event public.ballers_match_events%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.ballers_matches WHERE id=p_match;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND';END IF;
 -- Global lock order: Game Day first, then match. Same as START/attendance.
 SELECT * INTO g FROM public.game_days WHERE id=m.game_day_id FOR UPDATE;
 SELECT * INTO m FROM public.ballers_matches WHERE id=p_match FOR UPDATE;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 manager:=public.ballers_is_manager(g.community_id);operator:=manager OR actor=m.operator_id;
 IF NOT public.ballers_can_read_game(g.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 -- Dedupe a successfully received event before optimistic version check.
 IF p_action='EVENT' AND operator THEN
  SELECT * INTO old_event FROM public.ballers_match_events WHERE id=(p_payload->>'id')::uuid;
  IF FOUND THEN
   IF old_event.match_id=p_match AND old_event.author_id=auth.uid() AND old_event.kind=p_payload->>'kind' AND old_event.player_id=(p_payload->>'player_id')::uuid AND old_event.assist_id IS NOT DISTINCT FROM (p_payload->>'assist_id')::uuid THEN RETURN;END IF;
   RAISE EXCEPTION 'EVENT_ID_REUSE';
  END IF;
 END IF;
 IF p_version IS NULL OR p_version<>m.version THEN RAISE EXCEPTION 'Матч изменился. Обновите данные и повторите действие.'; END IF;
 elapsed:=m.elapsed_seconds+CASE WHEN m.running_since IS NOT NULL THEN GREATEST(0,floor(extract(epoch FROM (now()-m.running_since)))::int) ELSE 0 END;
 CASE p_action
 WHEN 'EVENT' THEN
  IF NOT operator OR m.status<>'LIVE' THEN RAISE EXCEPTION 'Только оператор текущего матча может записать событие'; END IF;
  IF m.end_mode<>'GOALS_ONLY' AND elapsed>=m.duration_seconds THEN RAISE EXCEPTION 'Время вышло. Завершите матч.';END IF;
  eid:=(p_payload->>'id')::uuid;kind:=p_payload->>'kind';aid:=(p_payload->>'assist_id')::uuid;
  SELECT team_id INTO tm FROM public.ballers_match_rosters WHERE match_id=m.id AND player_id=(p_payload->>'player_id')::uuid;
  IF tm IS NULL OR eid IS NULL OR kind IS NULL OR kind NOT IN('GOAL','OWN_GOAL','SAVE') THEN RAISE EXCEPTION 'Неверное событие или игрок вне состава'; END IF;
  IF aid IS NOT NULL AND (kind<>'GOAL' OR aid=(p_payload->>'player_id')::uuid OR NOT EXISTS(SELECT 1 FROM public.ballers_match_rosters WHERE match_id=m.id AND player_id=aid AND team_id=tm)) THEN RAISE EXCEPTION 'Неверный ассистент'; END IF;
  IF kind='OWN_GOAL' THEN tm:=CASE WHEN tm=m.team_a THEN m.team_b ELSE m.team_a END;END IF;
  INSERT INTO public.ballers_match_events(id,match_id,kind,player_id,assist_id,team_id,author_id,elapsed_seconds) VALUES(eid,m.id,kind,(p_payload->>'player_id')::uuid,aid,tm,auth.uid(),elapsed);
 WHEN 'UNDO' THEN
  IF NOT operator OR m.status NOT IN('LIVE','PAUSED','PENDING','DISPUTED','VERIFIED') THEN RAISE EXCEPTION 'UNDO_FORBIDDEN'; END IF;
  UPDATE public.ballers_match_events SET voided=true WHERE id=(p_payload->>'id')::uuid AND match_id=m.id AND NOT voided;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF m.status IN('PENDING','DISPUTED','VERIFIED') THEN UPDATE public.ballers_matches SET status='PENDING',confirmed_a=false,confirmed_b=false,resolution_note=NULL WHERE id=m.id; END IF;
 WHEN 'PAUSE' THEN
  IF NOT operator OR m.status<>'LIVE' THEN RAISE EXCEPTION 'PAUSE_FORBIDDEN'; END IF;
  UPDATE public.ballers_matches SET status='PAUSED',elapsed_seconds=elapsed,running_since=NULL WHERE id=m.id;
 WHEN 'RESUME' THEN
  IF NOT operator OR m.status<>'PAUSED' THEN RAISE EXCEPTION 'RESUME_FORBIDDEN'; END IF;
  UPDATE public.ballers_matches SET status='LIVE',running_since=now() WHERE id=m.id;
 WHEN 'FINISH' THEN
  IF NOT operator OR m.status NOT IN('LIVE','PAUSED') THEN RAISE EXCEPTION 'FINISH_FORBIDDEN'; END IF;
 WHEN 'CONFIRM' THEN
  IF m.status<>'PENDING' OR actor NOT IN(m.captain_a,m.captain_b) THEN RAISE EXCEPTION 'Только капитан подтверждает ожидающий результат'; END IF;
  UPDATE public.ballers_matches SET confirmed_a=confirmed_a OR actor=captain_a,confirmed_b=confirmed_b OR actor=captain_b WHERE id=m.id;
  UPDATE public.ballers_matches SET status='VERIFIED' WHERE id=m.id AND confirmed_a AND confirmed_b;
 WHEN 'DISPUTE' THEN
  IF m.status<>'PENDING' OR (NOT manager AND actor NOT IN(m.captain_a,m.captain_b)) THEN RAISE EXCEPTION 'DISPUTE_FORBIDDEN'; END IF;
  UPDATE public.ballers_matches SET status='DISPUTED',resolution_note=p_payload->>'reason' WHERE id=m.id;
 WHEN 'RESOLVE' THEN
  IF NOT manager OR (m.status<>'DISPUTED' AND NOT(m.is_test AND m.status='PENDING')) OR length(trim(COALESCE(p_payload->>'reason','')))<5 THEN RAISE EXCEPTION 'Решение менеджера доступно для спора или тестового матча; укажите причину'; END IF;
  UPDATE public.ballers_matches SET status='VERIFIED',resolution_note=p_payload->>'reason' WHERE id=m.id;
 WHEN 'OPERATOR' THEN
  IF NOT manager THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.game_participants WHERE game_day_id=g.id AND player_id=(p_payload->>'player_id')::uuid AND attendance_status='GOING') THEN RAISE EXCEPTION 'Ответственный должен участвовать в Game Day';END IF;
  UPDATE public.ballers_matches SET operator_id=(p_payload->>'player_id')::uuid WHERE id=m.id;
 ELSE RAISE EXCEPTION 'UNKNOWN_MATCH_ACTION';
 END CASE;
 SELECT count(*) FILTER(WHERE ev.team_id=m.team_a AND ev.kind IN('GOAL','OWN_GOAL')),count(*) FILTER(WHERE ev.team_id=m.team_b AND ev.kind IN('GOAL','OWN_GOAL')) INTO sa,sb FROM public.ballers_match_events ev WHERE ev.match_id=m.id AND NOT ev.voided;
 UPDATE public.ballers_matches SET score_a=sa,score_b=sb,version=version+1 WHERE id=m.id;
 done:=m.status IN('LIVE','PAUSED') AND (p_action='FINISH' OR (p_action='EVENT' AND m.end_mode<>'TIME_ONLY' AND GREATEST(sa,sb)>=m.goal_limit));
 IF done THEN
  UPDATE public.ballers_matches SET status='PENDING',elapsed_seconds=elapsed,running_since=NULL,finished_at=now() WHERE id=m.id;
  PERFORM public.ballers_finish_rotation(m.id);
  INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message) VALUES(m.captain_a,g.id,'CONFIRM','Подтвердите результат матча #'||m.sequence),(m.captain_b,g.id,'CONFIRM','Подтвердите результат матча #'||m.sequence);
 END IF;
 INSERT INTO public.ballers_match_audit(match_id,actor_id,action,version,payload,result_snapshot) SELECT m.id,auth.uid(),p_action,cur.version,p_payload,to_jsonb(cur) FROM public.ballers_matches cur WHERE cur.id=m.id;
END $$;
REVOKE ALL ON FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) TO authenticated;

CREATE FUNCTION public.ballers_player_stats(p_player uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
SELECT CASE WHEN auth.uid() IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
 'matches',(SELECT count(*) FROM public.ballers_match_rosters r JOIN public.ballers_matches m ON m.id=r.match_id WHERE r.player_id=p_player AND m.status='VERIFIED' AND NOT m.is_test),
 'goals',(SELECT count(*) FROM public.ballers_match_events e JOIN public.ballers_matches m ON m.id=e.match_id WHERE e.player_id=p_player AND e.kind='GOAL' AND NOT e.voided AND m.status='VERIFIED' AND NOT m.is_test),
 'assists',(SELECT count(*) FROM public.ballers_match_events e JOIN public.ballers_matches m ON m.id=e.match_id WHERE e.assist_id=p_player AND e.kind='GOAL' AND NOT e.voided AND m.status='VERIFIED' AND NOT m.is_test),
 'saves',(SELECT count(*) FROM public.ballers_match_events e JOIN public.ballers_matches m ON m.id=e.match_id WHERE e.player_id=p_player AND e.kind='SAVE' AND NOT e.voided AND m.status='VERIFIED' AND NOT m.is_test),
 'test_matches',(SELECT count(*) FROM public.ballers_match_rosters r JOIN public.ballers_matches m ON m.id=r.match_id WHERE r.player_id=p_player AND m.status='VERIFIED' AND m.is_test),
 'test_goals',(SELECT count(*) FROM public.ballers_match_events e JOIN public.ballers_matches m ON m.id=e.match_id WHERE e.player_id=p_player AND e.kind='GOAL' AND NOT e.voided AND m.status='VERIFIED' AND m.is_test)
 ) END;
$$;
REVOKE ALL ON FUNCTION public.ballers_player_stats(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_player_stats(uuid) TO authenticated;
CREATE TABLE public.ballers_community_teams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,name text NOT NULL,color_key text NOT NULL,team_mode text NOT NULL,sort_order int NOT NULL,UNIQUE(community_id,name));
CREATE TABLE public.ballers_community_team_members(team_id uuid REFERENCES public.ballers_community_teams(id) ON DELETE CASCADE,player_id uuid REFERENCES public.player_profiles(id) ON DELETE CASCADE,is_core boolean NOT NULL DEFAULT false,PRIMARY KEY(team_id,player_id));
ALTER TABLE public.game_day_teams ADD COLUMN community_team_id uuid REFERENCES public.ballers_community_teams(id);
ALTER TABLE public.ballers_community_teams ENABLE ROW LEVEL SECURITY;ALTER TABLE public.ballers_community_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_community_teams,public.ballers_community_team_members FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ballers_community_teams,public.ballers_community_team_members TO authenticated;
CREATE POLICY community_squads_read ON public.ballers_community_teams FOR SELECT TO authenticated USING(public.ballers_is_manager(community_id) OR EXISTS(SELECT 1 FROM public.community_members c JOIN public.player_profiles p ON p.id=c.player_id WHERE c.community_id=ballers_community_teams.community_id AND p.user_id=auth.uid()));
CREATE POLICY community_squad_members_read ON public.ballers_community_team_members FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.ballers_community_teams t WHERE t.id=team_id));
CREATE FUNCTION public.ballers_squad_action(p_game uuid,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;teamrow record;cid uuid;tid uuid;BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
 PERFORM 1 FROM public.communities WHERE id=g.community_id FOR UPDATE;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN';END IF;
 IF p_action='SAVE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.game_day_teams WHERE game_day_id=g.id) THEN RAISE EXCEPTION 'Нет команд для сохранения';END IF;
  FOR teamrow IN SELECT * FROM public.game_day_teams WHERE game_day_id=g.id ORDER BY sort_order LOOP
   INSERT INTO public.ballers_community_teams(community_id,name,color_key,team_mode,sort_order) VALUES(g.community_id,teamrow.name,teamrow.color_key,teamrow.team_mode,teamrow.sort_order)
    ON CONFLICT(community_id,name) DO UPDATE SET color_key=excluded.color_key,team_mode=excluded.team_mode,sort_order=excluded.sort_order RETURNING id INTO cid;
   -- Transfer today's players between base teams, but preserve absent members.
   DELETE FROM public.ballers_community_team_members bm USING public.ballers_community_teams bt WHERE bm.team_id=bt.id AND bt.community_id=g.community_id AND bm.team_id<>cid AND bm.player_id IN(SELECT player_id FROM public.game_day_team_players WHERE team_id=teamrow.id);
   INSERT INTO public.ballers_community_team_members(team_id,player_id,is_core) SELECT cid,a.player_id,a.is_core FROM public.game_day_team_players a JOIN public.community_members cm ON cm.player_id=a.player_id AND cm.community_id=g.community_id WHERE a.team_id=teamrow.id
    ON CONFLICT(team_id,player_id) DO UPDATE SET is_core=excluded.is_core;
   UPDATE public.game_day_teams SET community_team_id=cid WHERE id=teamrow.id;
  END LOOP;
 ELSIF p_action='APPLY' THEN
  IF EXISTS(SELECT 1 FROM public.ballers_matches WHERE game_day_id=g.id) THEN RAISE EXCEPTION 'После начала истории матчей базовые команды не заменяются';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ballers_community_teams WHERE community_id=g.community_id) THEN RAISE EXCEPTION 'Сначала сохраните базовые команды в другом Game Day';END IF;
  DELETE FROM public.game_day_teams WHERE game_day_id=g.id;
  FOR teamrow IN SELECT * FROM public.ballers_community_teams WHERE community_id=g.community_id ORDER BY sort_order,id LOOP
   INSERT INTO public.game_day_teams(game_day_id,name,color_key,team_mode,sort_order,community_team_id) VALUES(g.id,teamrow.name,teamrow.color_key,teamrow.team_mode,teamrow.sort_order,teamrow.id) RETURNING id INTO tid;
   INSERT INTO public.game_day_team_players(game_day_id,team_id,player_id,is_core) SELECT g.id,tid,bm.player_id,bm.is_core FROM public.ballers_community_team_members bm JOIN public.game_participants gp ON gp.player_id=bm.player_id AND gp.game_day_id=g.id AND gp.attendance_status='GOING' WHERE bm.team_id=teamrow.id;
  END LOOP;
  UPDATE public.game_days SET team_count=(SELECT count(*) FROM public.game_day_teams WHERE game_day_id=g.id) WHERE id=g.id;
 ELSE RAISE EXCEPTION 'UNKNOWN_SQUAD_ACTION';END IF;
 UPDATE public.game_days SET roster_version=roster_version+1 WHERE id=g.id;
END $$;
REVOKE ALL ON FUNCTION public.ballers_squad_action(uuid,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_squad_action(uuid,text) TO authenticated;

CREATE FUNCTION public.ballers_alpha_snapshot(p_game uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; actor uuid;BEGIN
 IF NOT public.ballers_can_read_game(p_game) THEN RAISE EXCEPTION 'Нет доступа к игре'; END IF;
 SELECT * INTO g FROM public.game_days WHERE id=p_game;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 RETURN jsonb_build_object('game',to_jsonb(g),'my_player_id',actor,'manager',public.ballers_is_manager(g.community_id),'server_now',now(),
 'settings',COALESCE((SELECT to_jsonb(x) FROM public.ballers_game_settings x WHERE game_day_id=p_game),'{}'::jsonb),
 'teams',COALESCE((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('player_ids',COALESCE((SELECT jsonb_agg(player_id) FROM public.game_day_team_players WHERE team_id=t.id),'[]'::jsonb)) ORDER BY sort_order) FROM public.game_day_teams t WHERE game_day_id=p_game),'[]'::jsonb),
 'roles',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.ballers_team_roles r JOIN public.game_day_teams t ON t.id=r.team_id WHERE t.game_day_id=p_game),'[]'::jsonb),
 'participants',COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.game_participants a WHERE game_day_id=p_game),'[]'::jsonb),
 'players',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pp.id,'name',COALESCE(pp.display_name,pp.first_name),'user_id',pp.user_id,'position',pp.primary_position)) FROM public.player_profiles pp WHERE pp.id IN(SELECT player_id FROM public.game_participants WHERE game_day_id=p_game) OR pp.id IN(SELECT player_id FROM public.community_members WHERE community_id=g.community_id)),'[]'::jsonb),
 'waitlist',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY joined_at,player_id) FROM public.ballers_waitlist w WHERE game_day_id=p_game),'[]'::jsonb),
 'session',(SELECT to_jsonb(x) FROM public.ballers_sessions x WHERE game_day_id=p_game),
 'matches',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY sequence DESC) FROM public.ballers_matches m WHERE game_day_id=p_game),'[]'::jsonb),
 'rosters',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.ballers_match_rosters r JOIN public.ballers_matches m ON m.id=r.match_id WHERE m.game_day_id=p_game),'[]'::jsonb),
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id) FROM public.ballers_match_events e JOIN public.ballers_matches m ON m.id=e.match_id WHERE m.game_day_id=p_game),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ballers_alpha_snapshot(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_alpha_snapshot(uuid) TO authenticated;

CREATE FUNCTION public.ballers_open_games() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE COALESCE(jsonb_agg(jsonb_build_object('id',g.id,'community_id',g.community_id,'title',g.title,'city',c.city,'game_date',g.game_date,'start_time',g.start_time,'venue',g.venue,'format',g.format,'capacity',g.capacity,'going',(SELECT count(*) FROM public.game_participants WHERE game_day_id=g.id AND attendance_status='GOING')) ORDER BY g.game_date,g.start_time),'[]'::jsonb) END
 FROM public.game_days g JOIN public.communities c ON c.id=g.community_id JOIN public.ballers_game_settings s ON s.game_day_id=g.id WHERE s.is_open AND g.status='OPEN' AND g.game_date>=current_date;
$$;
REVOKE ALL ON FUNCTION public.ballers_open_games() FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_open_games() TO authenticated;
CREATE FUNCTION public.ballers_join_open_game(p_game uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;BEGIN
 PERFORM 1 FROM public.game_days WHERE id=p_game AND status='OPEN' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.ballers_game_settings WHERE game_day_id=p_game AND is_open) THEN RAISE EXCEPTION 'Игра закрыта для публичного набора';END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES(p_game,actor,'MAYBE','GUEST') ON CONFLICT DO NOTHING;
 PERFORM public.ballers_set_attendance(p_game,actor,'GOING');
END $$;
REVOKE ALL ON FUNCTION public.ballers_join_open_game(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_join_open_game(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_join_game_invite(p_token uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.invites%ROWTYPE;g public.game_days%ROWTYPE;actor uuid;BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO i FROM public.invites WHERE token=p_token FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_NOT_FOUND';END IF;
 SELECT * INTO g FROM public.game_days WHERE id=i.game_day_id FOR UPDATE;
 IF NOT FOUND OR g.community_id IS DISTINCT FROM i.community_id OR i.invite_type<>'GAME_GUEST' THEN RAISE EXCEPTION 'INVALID_INVITE_GAME';END IF;
 IF EXISTS(SELECT 1 FROM public.game_participants WHERE game_day_id=g.id AND player_id=actor AND attendance_status='GOING') OR EXISTS(SELECT 1 FROM public.ballers_waitlist WHERE game_day_id=g.id AND player_id=actor) THEN RETURN g.id; END IF;
 IF NOT i.is_active OR (i.expires_at IS NOT NULL AND i.expires_at<=now()) OR (i.max_uses IS NOT NULL AND i.uses_count>=i.max_uses) THEN RAISE EXCEPTION 'INVITE_UNAVAILABLE';END IF;
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES(g.id,actor,'MAYBE','GUEST') ON CONFLICT DO NOTHING;
 PERFORM public.ballers_set_attendance(g.id,actor,'GOING');
 UPDATE public.invites SET uses_count=uses_count+1 WHERE id=i.id;
 RETURN g.id;
END $$;

CREATE FUNCTION public.ballers_add_test_players(p_community uuid,p_count int DEFAULT 14) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n int;pid uuid;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.community_members c JOIN public.player_profiles p ON p.id=c.player_id WHERE c.community_id=p_community AND c.role='OWNER' AND p.user_id=auth.uid()) THEN RAISE EXCEPTION 'OWNER_REQUIRED';END IF;
 IF p_count IS NULL OR p_count<1 OR p_count>30 THEN RAISE EXCEPTION 'От 1 до 30 тестовых игроков';END IF;
 FOR n IN 1..p_count LOOP
 pid:=md5('BALLERS_TEST_FIXTURE_V1:'||p_community::text||':'||n::text)::uuid;
 IF EXISTS(SELECT 1 FROM public.player_profiles WHERE id=pid AND (user_id IS NOT NULL OR first_name<>'BALLERS_TEST_'||lpad(n::text,2,'0'))) THEN RAISE EXCEPTION 'ID_CONFLICT';END IF;
 INSERT INTO public.player_profiles(id,user_id,first_name,display_name,city,primary_position) VALUES(pid,NULL,'BALLERS_TEST_'||lpad(n::text,2,'0'),'TEST · Player '||lpad(n::text,2,'0'),(SELECT city FROM public.communities WHERE id=p_community),CASE WHEN n%7=0 THEN 'GK'::public.player_position WHEN n%3=0 THEN 'DEF'::public.player_position WHEN n%3=1 THEN 'MID'::public.player_position ELSE 'ATT'::public.player_position END) ON CONFLICT DO NOTHING;
 INSERT INTO public.community_members(community_id,player_id,role,member_status) VALUES(p_community,pid,'MEMBER','REGULAR') ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ballers_add_test_players(uuid,int) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_add_test_players(uuid,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_create_community(p_name text,p_city text,p_team_mode public.team_mode,p_format integer,p_team_count integer,p_capacity integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_player uuid; v_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT id INTO v_player FROM public.player_profiles WHERE user_id=auth.uid();
 IF v_player IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED'; END IF;
 IF p_name IS NULL OR length(trim(p_name))=0 OR length(trim(p_name))>120 THEN RAISE EXCEPTION 'INVALID_COMMUNITY_NAME'; END IF;
 IF p_format IS NULL OR p_format<1 OR p_format>11 OR p_team_count IS NULL OR p_team_count<2 OR p_team_count>8
 OR (p_capacity IS NOT NULL AND p_capacity<1) OR p_team_mode IS NULL THEN RAISE EXCEPTION 'INVALID_GAME_SETTINGS'; END IF;
 INSERT INTO public.communities(name,city,team_mode,default_format,default_team_count,default_capacity,created_by)
 VALUES(trim(p_name),nullif(trim(p_city),''),p_team_mode,p_format,p_team_count,p_capacity,auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.community_members(community_id,player_id,role,member_status) VALUES(v_id,v_player,'OWNER','REGULAR');
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ballers_create_community(text,text,public.team_mode,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_create_community(text,text,public.team_mode,integer,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_create_game_day(p_community_id uuid,p_date date,p_time time,p_venue text,p_format integer,p_team_count integer,p_capacity integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.communities%ROWTYPE; v_number integer; v_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO c FROM public.communities WHERE id=p_community_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMUNITY_NOT_FOUND'; END IF;
 IF NOT public.ballers_is_manager(c.id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 IF p_date IS NULL OR p_format IS NULL OR p_format<1 OR p_format>11 OR p_team_count IS NULL OR p_team_count<2 OR p_team_count>8
 OR (p_capacity IS NOT NULL AND p_capacity<1) THEN RAISE EXCEPTION 'INVALID_GAME_SETTINGS'; END IF;
 SELECT COALESCE(max(sequence_number),0)+1 INTO v_number FROM public.game_days WHERE community_id=c.id;
 INSERT INTO public.game_days(community_id,sequence_number,title,game_date,start_time,venue,format,team_count,capacity,created_by)
 VALUES(c.id,v_number,c.name||' #'||v_number,p_date,p_time,nullif(trim(p_venue),''),p_format,p_team_count,p_capacity,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ballers_create_game_day(uuid,date,time,text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_create_game_day(uuid,date,time,text,integer,integer,integer) TO authenticated;

INSERT INTO public.ballers_migration_history(version) VALUES('20261012_002');
COMMIT;
