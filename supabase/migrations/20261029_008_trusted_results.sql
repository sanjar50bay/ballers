-- BALLERS 0.2.10. Apply ONCE after 007 in the same project. No automatic historical acceptance.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.ballers_migration_history') IS NULL THEN RAISE EXCEPTION 'Wrong project: migration history missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261028_007') THEN RAISE EXCEPTION 'Apply 007 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261029_008') THEN RAISE EXCEPTION '008 already applied'; END IF;
END $$;
ALTER TABLE public.ballers_game_settings ADD COLUMN result_mode text NOT NULL DEFAULT 'TRUSTED' CHECK(result_mode IN('TRUSTED','CAPTAINS'));
-- Old matches retain their original confirmation policy, including currently live ones.
ALTER TABLE public.ballers_matches ADD COLUMN result_mode text NOT NULL DEFAULT 'CAPTAINS' CHECK(result_mode IN('TRUSTED','CAPTAINS'));
CREATE FUNCTION public.ballers_result_policy_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 NEW.result_mode:=coalesce((SELECT result_mode FROM public.ballers_game_settings WHERE game_day_id=NEW.game_day_id),'TRUSTED');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ballers_result_policy_snapshot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ballers_result_policy_snapshot BEFORE INSERT ON public.ballers_matches FOR EACH ROW EXECUTE FUNCTION public.ballers_result_policy_snapshot();
CREATE FUNCTION public.ballers_result_mode(p_game uuid,p_mode text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 IF p_mode IS NULL OR p_mode NOT IN('TRUSTED','CAPTAINS') THEN RAISE EXCEPTION 'INVALID_RESULT_MODE'; END IF;
 INSERT INTO public.ballers_game_settings(game_day_id,result_mode) VALUES(g.id,p_mode)
 ON CONFLICT(game_day_id) DO UPDATE SET result_mode=excluded.result_mode;
END $$;
REVOKE ALL ON FUNCTION public.ballers_result_mode(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_result_mode(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.ballers_match_action(p_match uuid,p_version bigint,p_action text,p_payload jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF p_action IN('EVENT','CORRECT_EVENT') AND operator THEN
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
  IF tm IS NULL OR eid IS NULL OR kind IS NULL OR kind NOT IN('GOAL','OWN_GOAL','SAVE','YELLOW','RED') THEN RAISE EXCEPTION 'Неверное событие или игрок вне состава'; END IF;
  IF aid IS NOT NULL AND (kind<>'GOAL' OR aid=(p_payload->>'player_id')::uuid OR NOT EXISTS(SELECT 1 FROM public.ballers_match_rosters WHERE match_id=m.id AND player_id=aid AND team_id=tm)) THEN RAISE EXCEPTION 'Неверный ассистент'; END IF;
  IF kind='OWN_GOAL' THEN tm:=CASE WHEN tm=m.team_a THEN m.team_b ELSE m.team_a END;END IF;
  INSERT INTO public.ballers_match_events(id,match_id,kind,player_id,assist_id,team_id,author_id,elapsed_seconds) VALUES(eid,m.id,kind,(p_payload->>'player_id')::uuid,aid,tm,auth.uid(),elapsed);
 WHEN 'CORRECT_EVENT' THEN
  IF NOT manager OR m.result_mode<>'TRUSTED' OR m.status<>'VERIFIED' OR length(trim(coalesce(p_payload->>'reason','')))<5 THEN RAISE EXCEPTION 'CORRECTION_MANAGER_REASON_REQUIRED'; END IF;
  eid:=(p_payload->>'id')::uuid;kind:=p_payload->>'kind';aid:=(p_payload->>'assist_id')::uuid;
  SELECT team_id INTO tm FROM public.ballers_match_rosters WHERE match_id=m.id AND player_id=(p_payload->>'player_id')::uuid;
  IF tm IS NULL OR eid IS NULL OR kind IS NULL OR kind NOT IN('GOAL','OWN_GOAL','SAVE','YELLOW','RED') THEN RAISE EXCEPTION 'Неверное событие или игрок вне состава'; END IF;
  IF aid IS NOT NULL AND (kind<>'GOAL' OR aid=(p_payload->>'player_id')::uuid OR NOT EXISTS(SELECT 1 FROM public.ballers_match_rosters WHERE match_id=m.id AND player_id=aid AND team_id=tm)) THEN RAISE EXCEPTION 'Неверный ассистент'; END IF;
  IF kind='OWN_GOAL' THEN tm:=CASE WHEN tm=m.team_a THEN m.team_b ELSE m.team_a END;END IF;
  INSERT INTO public.ballers_match_events(id,match_id,kind,player_id,assist_id,team_id,author_id,elapsed_seconds) VALUES(eid,m.id,kind,(p_payload->>'player_id')::uuid,aid,tm,auth.uid(),elapsed);
 WHEN 'UNDO' THEN
  IF m.result_mode='TRUSTED' AND m.status='VERIFIED' AND (NOT manager OR length(trim(coalesce(p_payload->>'reason','')))<5) THEN RAISE EXCEPTION 'CORRECTION_MANAGER_REASON_REQUIRED'; END IF;
  IF NOT operator OR m.status NOT IN('LIVE','PAUSED','PENDING','DISPUTED','VERIFIED') THEN RAISE EXCEPTION 'UNDO_FORBIDDEN'; END IF;
  UPDATE public.ballers_match_events SET voided=true WHERE id=(p_payload->>'id')::uuid AND match_id=m.id AND NOT voided;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF m.status IN('PENDING','DISPUTED','VERIFIED') AND m.result_mode<>'TRUSTED' THEN UPDATE public.ballers_matches SET status='PENDING',confirmed_a=false,confirmed_b=false,resolution_note=NULL,notification_revision=notification_revision+1 WHERE id=m.id; END IF;
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
 WHEN 'ACCEPT_TRUSTED' THEN
  IF NOT manager OR m.status<>'PENDING' OR m.finished_at IS NULL OR length(trim(coalesce(p_payload->>'reason','')))<5 THEN RAISE EXCEPTION 'CORRECTION_MANAGER_REASON_REQUIRED'; END IF;
  UPDATE public.ballers_matches SET result_mode='TRUSTED',status='VERIFIED',confirmed_a=false,confirmed_b=false,resolution_note=p_payload->>'reason' WHERE id=m.id;
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
  UPDATE public.ballers_matches SET status=CASE WHEN m.result_mode='TRUSTED' THEN 'VERIFIED' ELSE 'PENDING' END,elapsed_seconds=elapsed,running_since=NULL,finished_at=now() WHERE id=m.id;
  PERFORM public.ballers_finish_rotation(m.id);
  -- Confirmation requests are maintained by the revision-aware trigger (004).
 END IF;
 INSERT INTO public.ballers_match_audit(match_id,actor_id,action,version,payload,result_snapshot) SELECT m.id,auth.uid(),p_action,cur.version,p_payload,to_jsonb(cur) FROM public.ballers_matches cur WHERE cur.id=m.id;
END $$;

REVOKE ALL ON FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_match_action(uuid,bigint,text,jsonb) TO authenticated;
CREATE FUNCTION public.ballers_match_history(p_match uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g uuid;BEGIN
 SELECT game_day_id INTO g FROM public.ballers_matches WHERE id=p_match;
 IF g IS NULL OR NOT public.ballers_can_read_game(g) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.id DESC) FROM (
 SELECT a.id,a.action,a.version,a.created_at,a.payload->>'reason' reason,
 concat_ws(' ',p.first_name,p.last_name) actor,
 a.result_snapshot->>'score_a' score_a,a.result_snapshot->>'score_b' score_b
 FROM public.ballers_match_audit a LEFT JOIN public.player_profiles p ON p.user_id=a.actor_id WHERE a.match_id=p_match
 ) x),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.ballers_match_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_match_history(uuid) TO authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261029_008');
NOTIFY pgrst,'reload schema';
COMMIT;
