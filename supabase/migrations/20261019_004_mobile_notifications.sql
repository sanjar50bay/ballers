-- BALLERS 0.2.3. Apply ONCE to BALLERS Test, after 001, 002 and 003.
-- No baseline rerun. Transactional and preserves existing games and results.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261013_003') THEN RAISE EXCEPTION 'Apply migration 003 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261019_004') THEN RAISE EXCEPTION 'Migration 004 already applied'; END IF;
END $$;
ALTER TABLE public.ballers_matches ADD COLUMN notification_revision int NOT NULL DEFAULT 1;
ALTER TABLE public.ballers_notifications ADD COLUMN match_id uuid REFERENCES public.ballers_matches(id) ON DELETE CASCADE;
ALTER TABLE public.ballers_notifications ADD COLUMN match_revision int;
ALTER TABLE public.ballers_notifications ADD COLUMN completed_at timestamptz;
-- Backfill only exact legacy messages within the same game, never all messages of a day.
UPDATE public.ballers_notifications n SET match_id=m.id,match_revision=1
 FROM public.ballers_matches m WHERE n.game_day_id=m.game_day_id AND n.kind='CONFIRM'
 AND n.message='Подтвердите результат матча #'||m.sequence;
UPDATE public.ballers_notifications n SET completed_at=now(),read_at=COALESCE(read_at,now()) FROM public.ballers_matches m
 WHERE n.match_id=m.id AND (m.status<>'PENDING' OR (n.player_id=m.captain_a AND m.confirmed_a) OR (n.player_id=m.captain_b AND m.confirmed_b));
UPDATE public.ballers_notifications n SET completed_at=now() FROM public.game_participants gp
 WHERE n.game_day_id=gp.game_day_id AND n.player_id=gp.player_id AND n.kind='INVITE' AND gp.attendance_status<>'INVITED';
-- Resolve duplicates without deleting history before adding the unique per-revision request key.
WITH duplicates AS (SELECT id,row_number() OVER(PARTITION BY match_id,match_revision,player_id,kind ORDER BY created_at,id) rn FROM public.ballers_notifications WHERE match_id IS NOT NULL)
 UPDATE public.ballers_notifications n SET match_revision=NULL,completed_at=COALESCE(completed_at,now()) FROM duplicates d WHERE n.id=d.id AND d.rn>1;
CREATE UNIQUE INDEX ballers_confirmation_revision ON public.ballers_notifications(match_id,match_revision,player_id,kind) WHERE match_id IS NOT NULL AND match_revision IS NOT NULL;
CREATE FUNCTION public.ballers_sync_confirmation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.ballers_notifications n SET completed_at=COALESCE(n.completed_at,now()),read_at=COALESCE(n.read_at,now())
 WHERE n.match_id=NEW.id AND n.completed_at IS NULL AND (n.match_revision IS DISTINCT FROM NEW.notification_revision OR NEW.status<>'PENDING'
 OR (n.player_id=NEW.captain_a AND NEW.confirmed_a) OR (n.player_id=NEW.captain_b AND NEW.confirmed_b));
 IF NEW.status='PENDING' THEN
  INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message,match_id,match_revision)
   SELECT p,NEW.game_day_id,'CONFIRM','Подтвердите результат матча #'||NEW.sequence,NEW.id,NEW.notification_revision
   FROM (SELECT NEW.captain_a p WHERE NOT NEW.confirmed_a UNION SELECT NEW.captain_b WHERE NOT NEW.confirmed_b) captains
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ballers_sync_confirmation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ballers_confirmation_lifecycle AFTER UPDATE OF status,confirmed_a,confirmed_b,notification_revision ON public.ballers_matches FOR EACH ROW EXECUTE FUNCTION public.ballers_sync_confirmation();
CREATE FUNCTION public.ballers_resolve_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.attendance_status<>'INVITED' THEN
 UPDATE public.ballers_notifications SET completed_at=COALESCE(completed_at,now()),read_at=COALESCE(read_at,now())
 WHERE player_id=NEW.player_id AND game_day_id=NEW.game_day_id AND kind IN('INVITE','PLACE_OFFER') AND completed_at IS NULL;
 END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.ballers_resolve_invitation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ballers_invitation_lifecycle AFTER UPDATE OF attendance_status ON public.game_participants FOR EACH ROW EXECUTE FUNCTION public.ballers_resolve_invitation();
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
  IF m.status IN('PENDING','DISPUTED','VERIFIED') THEN UPDATE public.ballers_matches SET status='PENDING',confirmed_a=false,confirmed_b=false,resolution_note=NULL,notification_revision=notification_revision+1 WHERE id=m.id; END IF;
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
  -- Confirmation requests are maintained by the revision-aware trigger (004).
 END IF;
 INSERT INTO public.ballers_match_audit(match_id,actor_id,action,version,payload,result_snapshot) SELECT m.id,auth.uid(),p_action,cur.version,p_payload,to_jsonb(cur) FROM public.ballers_matches cur WHERE cur.id=m.id;
END $$;

-- Closing a day closes attendance requests, but never match confirmation requests.
CREATE FUNCTION public.ballers_close_attendance_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status<>'OPEN' THEN UPDATE public.ballers_notifications SET completed_at=COALESCE(completed_at,now()),read_at=COALESCE(read_at,now()) WHERE game_day_id=NEW.id AND kind IN('INVITE','PLACE_OFFER') AND completed_at IS NULL; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.ballers_close_attendance_requests() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ballers_day_notification_lifecycle AFTER UPDATE OF status ON public.game_days FOR EACH ROW EXECUTE FUNCTION public.ballers_close_attendance_requests();
UPDATE public.ballers_notifications n SET completed_at=now(),read_at=COALESCE(read_at,now()) FROM public.game_days g WHERE g.id=n.game_day_id AND g.status<>'OPEN' AND n.kind IN('INVITE','PLACE_OFFER') AND n.completed_at IS NULL;

-- One authorized home query: personal profile, own communities, nearest days and recent day history.
CREATE FUNCTION public.ballers_home() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.player_profiles%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO p FROM public.player_profiles WHERE user_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('profile',NULL,'communities','[]'::jsonb,'games','[]'::jsonb,'history','[]'::jsonb); END IF;
 WITH visible AS (
 SELECT g.*,gp.attendance_status,
 (SELECT count(*) FROM public.game_participants x WHERE x.game_day_id=g.id AND x.attendance_status='GOING') going,
 (SELECT count(*) FROM public.ballers_matches x WHERE x.game_day_id=g.id) match_count,
 EXISTS(SELECT 1 FROM public.ballers_matches x WHERE x.game_day_id=g.id AND x.status IN('LIVE','PAUSED')) live
 FROM public.game_days g LEFT JOIN public.game_participants gp ON gp.game_day_id=g.id AND gp.player_id=p.id
 WHERE gp.player_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.community_members c WHERE c.community_id=g.community_id AND c.player_id=p.id) OR public.ballers_is_manager(g.community_id)
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
-- Refresh pending legacy requests as well as already-confirmed records.
UPDATE public.ballers_matches SET confirmed_a=confirmed_a WHERE status IN('PENDING','DISPUTED','VERIFIED','CANCELLED');

CREATE FUNCTION public.ballers_notification_feed() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p uuid; BEGIN
 SELECT id INTO p FROM public.player_profiles WHERE user_id=auth.uid();
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 RETURN jsonb_build_object('unread',(SELECT count(*) FROM public.ballers_notifications n WHERE n.player_id=p AND n.read_at IS NULL AND n.completed_at IS NULL),
 'active',COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (SELECT * FROM public.ballers_notifications WHERE player_id=p AND completed_at IS NULL AND (read_at IS NULL OR kind IN('CONFIRM','INVITE','PLACE_OFFER')) ORDER BY created_at DESC,id) n),'[]'::jsonb),
 'history',COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM (SELECT * FROM public.ballers_notifications WHERE player_id=p AND (completed_at IS NOT NULL OR (read_at IS NOT NULL AND kind NOT IN('CONFIRM','INVITE','PLACE_OFFER'))) ORDER BY created_at DESC,id LIMIT 60) n),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ballers_notification_feed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_notification_feed() TO authenticated;
-- Saving the default opening pair and starting a match are one transaction.
CREATE FUNCTION public.ballers_start_match(p_game uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; a uuid; b uuid;
BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ballers_sessions WHERE game_day_id=g.id) THEN
  SELECT id INTO a FROM public.game_day_teams WHERE game_day_id=g.id ORDER BY sort_order,id LIMIT 1;
  SELECT id INTO b FROM public.game_day_teams WHERE game_day_id=g.id ORDER BY sort_order,id OFFSET 1 LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Сначала соберите минимум две команды'; END IF;
  PERFORM public.ballers_game_action(g.id,'LINEUP',jsonb_build_object('team_a',a,'team_b',b,'first_draw_out',a));
 END IF;
 RETURN public.ballers_game_action(g.id,'START','{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.ballers_start_match(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_start_match(uuid) TO authenticated;

INSERT INTO public.ballers_migration_history(version) VALUES('20261019_004');
NOTIFY pgrst,'reload schema';
COMMIT;
