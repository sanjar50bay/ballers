-- BALLERS 0.2.7. Apply ONCE in the SAME project after 005. Keep the whole transaction.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.ballers_migration_history') IS NULL THEN RAISE EXCEPTION 'Wrong project: migration history missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261024_005') THEN RAISE EXCEPTION 'Apply 005 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261027_006') THEN RAISE EXCEPTION '006 already applied'; END IF;
END $$;
ALTER TABLE public.ballers_game_settings ADD COLUMN join_mode text NOT NULL DEFAULT 'APPROVAL' CHECK(join_mode IN('APPROVAL','AUTO'));
CREATE TABLE public.ballers_day_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,
 player_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','ACCEPTED','REJECTED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(game_day_id,player_id));
ALTER TABLE public.ballers_day_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_day_requests FROM PUBLIC,anon,authenticated;
ALTER TABLE public.ballers_notifications ADD COLUMN request_id uuid REFERENCES public.ballers_day_requests(id) ON DELETE CASCADE;
ALTER FUNCTION public.ballers_set_attendance(uuid,uuid,public.attendance_status) RENAME TO ballers_set_attendance_pre006;
REVOKE ALL ON FUNCTION public.ballers_set_attendance_pre006(uuid,uuid,public.attendance_status) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ballers_request_day(p_game uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;p uuid;r public.ballers_day_requests%ROWTYPE;BEGIN
 SELECT id INTO p FROM public.player_profiles WHERE user_id=auth.uid();IF p IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR g.status<>'OPEN' OR g.game_date<current_date THEN RAISE EXCEPTION 'GAME_NOT_OPEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ballers_game_settings WHERE game_day_id=g.id AND is_open)
 AND NOT EXISTS(SELECT 1 FROM public.community_members WHERE community_id=g.community_id AND player_id=p)
 AND NOT EXISTS(SELECT 1 FROM public.game_participants WHERE game_day_id=g.id AND player_id=p) THEN RAISE EXCEPTION 'INVITATION_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM public.game_participants WHERE game_day_id=g.id AND player_id=p AND attendance_status='GOING') THEN RETURN;END IF;
 SELECT * INTO r FROM public.ballers_day_requests WHERE game_day_id=g.id AND player_id=p;
 IF FOUND AND r.status='PENDING' THEN RETURN;END IF;
 INSERT INTO public.ballers_day_requests(game_day_id,player_id) VALUES(g.id,p)
 ON CONFLICT(game_day_id,player_id) DO UPDATE SET status='PENDING',updated_at=now() RETURNING * INTO r;
 UPDATE public.ballers_notifications SET completed_at=coalesce(completed_at,now()),read_at=coalesce(read_at,now()) WHERE request_id=r.id AND completed_at IS NULL;
 INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message,request_id)
 SELECT cm.player_id,g.id,'JOIN_REQUEST','Заявка на игровой день: '||g.title||' — '||(SELECT concat_ws(' ',first_name,last_name) FROM public.player_profiles WHERE id=p),r.id FROM public.community_members cm
 WHERE cm.community_id=g.community_id AND cm.role IN('OWNER','MANAGER');
END $$;
REVOKE ALL ON FUNCTION public.ballers_request_day(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_request_day(uuid) TO authenticated;

CREATE FUNCTION public.ballers_set_attendance(p_game_id uuid,p_player_id uuid,p_status public.attendance_status) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; own_user uuid; old_status public.attendance_status; approval boolean;BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game_id FOR UPDATE;IF NOT FOUND OR g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN';END IF;
 SELECT user_id INTO own_user FROM public.player_profiles WHERE id=p_player_id;
 SELECT attendance_status INTO old_status FROM public.game_participants WHERE game_day_id=g.id AND player_id=p_player_id;
 SELECT coalesce((SELECT join_mode='APPROVAL' FROM public.ballers_game_settings WHERE game_day_id=g.id),true) INTO approval;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_status='GOING' AND own_user=auth.uid() AND NOT public.ballers_is_manager(g.community_id)
 AND old_status IS DISTINCT FROM 'GOING' AND old_status IS DISTINCT FROM 'INVITED' AND approval
 AND NOT EXISTS(SELECT 1 FROM public.ballers_day_requests WHERE game_day_id=g.id AND player_id=p_player_id AND status='ACCEPTED') THEN
  PERFORM public.ballers_request_day(g.id);RETURN;
 END IF;
 -- Withdrawal of a request works even before a participant row exists.
 IF own_user=auth.uid() AND p_status='DECLINED' THEN
  UPDATE public.ballers_day_requests SET status='CANCELLED',updated_at=now() WHERE game_day_id=g.id AND player_id=p_player_id AND status='PENDING';
  UPDATE public.ballers_notifications n SET completed_at=now(),read_at=coalesce(read_at,now()) FROM public.ballers_day_requests r WHERE n.request_id=r.id AND r.game_day_id=g.id AND r.player_id=p_player_id AND r.status='CANCELLED' AND n.completed_at IS NULL;
  IF old_status IS NULL THEN RETURN;END IF;
 END IF;
 PERFORM public.ballers_set_attendance_pre006(p_game_id,p_player_id,p_status);
 IF p_status='DECLINED' THEN
  UPDATE public.ballers_day_requests SET status='CANCELLED',updated_at=now() WHERE game_day_id=g.id AND player_id=p_player_id AND status IN('PENDING','ACCEPTED');
  UPDATE public.ballers_notifications n SET completed_at=now(),read_at=coalesce(read_at,now()) FROM public.ballers_day_requests r WHERE n.request_id=r.id AND r.game_day_id=g.id AND r.player_id=p_player_id AND r.status='CANCELLED' AND n.completed_at IS NULL;
 END IF;
 IF own_user IS DISTINCT FROM auth.uid() AND p_status='DECLINED' THEN
  UPDATE public.ballers_notifications SET message='Участие отменено организатором: '||g.title WHERE player_id=p_player_id AND game_day_id=g.id AND kind='ATTENDANCE' AND created_at>=transaction_timestamp();
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.ballers_set_attendance(uuid,uuid,public.attendance_status) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_set_attendance(uuid,uuid,public.attendance_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_join_open_game(p_game uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;p uuid;mode text;BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR g.status<>'OPEN' OR g.game_date<current_date THEN RAISE EXCEPTION 'GAME_NOT_OPEN';END IF;
 SELECT join_mode INTO mode FROM public.ballers_game_settings WHERE game_day_id=g.id AND is_open;
 IF mode IS NULL THEN RAISE EXCEPTION 'Игра закрыта для публичного набора';END IF;
 SELECT id INTO p FROM public.player_profiles WHERE user_id=auth.uid();IF p IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF mode='APPROVAL' AND NOT public.ballers_is_manager(g.community_id) THEN PERFORM public.ballers_request_day(g.id);RETURN;END IF;
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES(g.id,p,'MAYBE','GUEST') ON CONFLICT DO NOTHING;
 PERFORM public.ballers_set_attendance_pre006(g.id,p,'GOING');
END $$;
-- A personal invitation from the organizer already grants admission; preserve that path.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('public.ballers_join_game_invite(uuid)'::regprocedure) INTO d;
 d:=replace(d,'public.ballers_set_attendance(','public.ballers_set_attendance_pre006(');EXECUTE d;
END $$;

CREATE FUNCTION public.ballers_answer_day(p_request uuid,p_accept boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ballers_day_requests%ROWTYPE;g public.game_days%ROWTYPE;waiting boolean;BEGIN
 SELECT * INTO r FROM public.ballers_day_requests WHERE id=p_request;IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND';END IF;
 SELECT * INTO g FROM public.game_days WHERE id=r.game_day_id FOR UPDATE;
 IF NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
 SELECT * INTO r FROM public.ballers_day_requests WHERE id=p_request FOR UPDATE;
 IF r.status<>'PENDING' THEN RETURN;END IF;
 IF g.status<>'OPEN' OR g.game_date<current_date THEN RAISE EXCEPTION 'GAME_NOT_OPEN';END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'INVALID_ACTION';END IF;
 IF p_accept THEN
  INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES(g.id,r.player_id,'MAYBE','GUEST') ON CONFLICT DO NOTHING;
  PERFORM public.ballers_set_attendance_pre006(g.id,r.player_id,'GOING');
  SELECT EXISTS(SELECT 1 FROM public.ballers_waitlist WHERE game_day_id=g.id AND player_id=r.player_id) INTO waiting;
 END IF;
 UPDATE public.ballers_day_requests SET status=CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END,updated_at=now() WHERE id=r.id;
 UPDATE public.ballers_notifications SET completed_at=now(),read_at=coalesce(read_at,now()) WHERE request_id=r.id AND kind='JOIN_REQUEST' AND completed_at IS NULL;
 INSERT INTO public.ballers_notifications(player_id,game_day_id,kind,message,request_id) VALUES(r.player_id,g.id,'JOIN_DECISION',
 CASE WHEN NOT p_accept THEN 'Заявка отклонена: ' WHEN waiting THEN 'Заявка принята, ты в очереди: ' ELSE 'Заявка принята: ' END||g.title,r.id);
END $$;
REVOKE ALL ON FUNCTION public.ballers_answer_day(uuid,boolean) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_answer_day(uuid,boolean) TO authenticated;

CREATE FUNCTION public.ballers_day_requests_feed(p_game uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;p uuid;manager boolean;BEGIN
 SELECT id INTO p FROM public.player_profiles WHERE user_id=auth.uid();IF p IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO g FROM public.game_days WHERE id=p_game;IF NOT FOUND THEN RAISE EXCEPTION 'GAME_NOT_FOUND';END IF;
 IF NOT public.ballers_can_read_game(g.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 manager:=public.ballers_is_manager(g.community_id);
 RETURN jsonb_build_object('mode',coalesce((SELECT join_mode FROM public.ballers_game_settings WHERE game_day_id=g.id),'APPROVAL'),'manager',manager,
 'requests',coalesce((SELECT jsonb_agg(x ORDER BY x.created_at,x.id) FROM (SELECT r.id,r.player_id,r.status,r.created_at,p.first_name,p.last_name,p.display_name,p.baller_id FROM public.ballers_day_requests r JOIN public.player_profiles p ON p.id=r.player_id WHERE r.game_day_id=g.id AND (manager OR r.player_id=p.id AND p.user_id=auth.uid()) AND (r.status='PENDING' OR r.player_id IN(SELECT id FROM public.player_profiles WHERE user_id=auth.uid()))) x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ballers_day_requests_feed(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_day_requests_feed(uuid) TO authenticated;
CREATE FUNCTION public.ballers_day_join_mode(p_game uuid,p_mode text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;BEGIN
 SELECT * INTO g FROM public.game_days WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
 IF g.status<>'OPEN' OR p_mode IS NULL OR p_mode NOT IN('AUTO','APPROVAL') THEN RAISE EXCEPTION 'INVALID_ACTION';END IF;
 INSERT INTO public.ballers_game_settings(game_day_id,join_mode) VALUES(g.id,p_mode) ON CONFLICT(game_day_id) DO UPDATE SET join_mode=excluded.join_mode;
END $$;
REVOKE ALL ON FUNCTION public.ballers_day_join_mode(uuid,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_day_join_mode(uuid,text) TO authenticated;
CREATE FUNCTION public.ballers_close_day_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status<>'OPEN' THEN
 UPDATE public.ballers_day_requests SET status='CANCELLED',updated_at=now() WHERE game_day_id=NEW.id AND status='PENDING';
 UPDATE public.ballers_notifications SET completed_at=now(),read_at=coalesce(read_at,now()) WHERE game_day_id=NEW.id AND kind='JOIN_REQUEST' AND completed_at IS NULL;
 END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.ballers_close_day_requests() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ballers_day_requests_closed AFTER UPDATE OF status ON public.game_days FOR EACH ROW EXECUTE FUNCTION public.ballers_close_day_requests();
-- Reading an actionable request must not hide its decision controls.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('public.ballers_notification_feed()'::regprocedure) INTO d;
 d:=replace(d,'''CONFIRM'', ''INVITE'', ''PLACE_OFFER''','''CONFIRM'', ''INVITE'', ''PLACE_OFFER'', ''JOIN_REQUEST''');
 d:=replace(d,'''CONFIRM'',''INVITE'',''PLACE_OFFER''','''CONFIRM'',''INVITE'',''PLACE_OFFER'',''JOIN_REQUEST''');EXECUTE d;
END $$;
-- Yellow/red cards are recorded events, not goals. Existing event validation is preserved.
ALTER TABLE public.ballers_match_events DROP CONSTRAINT ballers_match_events_kind_check;
ALTER TABLE public.ballers_match_events ADD CONSTRAINT ballers_match_events_kind_check CHECK(kind IN('GOAL','OWN_GOAL','SAVE','YELLOW','RED'));
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('public.ballers_match_action(uuid,bigint,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'''GOAL'',''OWN_GOAL'',''SAVE''','''GOAL'',''OWN_GOAL'',''SAVE'',''YELLOW'',''RED''');EXECUTE d;
END $$;
-- Tactical board contains confirmed members only; changes never modify actual membership.
CREATE TABLE public.ballers_tactical_boards(team_id uuid PRIMARY KEY REFERENCES public.ballers_teams(id) ON DELETE CASCADE,layout jsonb NOT NULL DEFAULT '[]',version bigint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ballers_tactical_boards ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.ballers_tactical_boards FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ballers_tactics(p_team uuid,p_layout jsonb DEFAULT NULL,p_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.ballers_tactical_boards%ROWTYPE;captain boolean;x jsonb;seen uuid[]:='{}';player uuid;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT created_by IN(SELECT id FROM public.player_profiles WHERE user_id=auth.uid()) INTO captain FROM public.ballers_teams WHERE id=p_team;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND';END IF;
 IF p_layout IS NOT NULL THEN
  IF NOT captain THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED';END IF;
  IF jsonb_typeof(p_layout)<>'array' OR jsonb_array_length(p_layout)>5 OR octet_length(p_layout::text)>10000 THEN RAISE EXCEPTION 'INVALID_LAYOUT';END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_layout) LOOP
   player:=(x->>'player_id')::uuid;
   IF player IS NULL OR player=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.ballers_team_people WHERE team_id=p_team AND player_id=player AND status='ACTIVE')
   OR x->>'x' IS NULL OR x->>'y' IS NULL OR (x->>'x')::numeric NOT BETWEEN 5 AND 95 OR (x->>'y')::numeric NOT BETWEEN 5 AND 95 THEN RAISE EXCEPTION 'INVALID_LAYOUT';END IF;
   seen:=array_append(seen,player);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',v->>'player_id','x',(v->>'x')::numeric,'y',(v->>'y')::numeric)),'[]'::jsonb) INTO p_layout FROM jsonb_array_elements(p_layout) v;
  PERFORM 1 FROM public.ballers_teams WHERE id=p_team FOR UPDATE;
  SELECT * INTO b FROM public.ballers_tactical_boards WHERE team_id=p_team;
  IF p_version IS NULL OR p_version<>coalesce(b.version,0) THEN RAISE EXCEPTION 'BOARD_CHANGED';END IF;
  INSERT INTO public.ballers_tactical_boards(team_id,layout,version) VALUES(p_team,p_layout,1) ON CONFLICT(team_id) DO UPDATE SET layout=excluded.layout,version=public.ballers_tactical_boards.version+1,updated_at=now();
 END IF;
 SELECT * INTO b FROM public.ballers_tactical_boards WHERE team_id=p_team;
 RETURN jsonb_build_object('layout',coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(coalesce(b.layout,'[]')) v WHERE EXISTS(SELECT 1 FROM public.ballers_team_people WHERE team_id=p_team AND player_id=(v->>'player_id')::uuid AND status='ACTIVE')),'[]'::jsonb),'version',coalesce(b.version,0));
END $$;
REVOKE ALL ON FUNCTION public.ballers_tactics(uuid,jsonb,bigint) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.ballers_tactics(uuid,jsonb,bigint) TO authenticated;

-- Replace directory atomically; count(1) avoids damaged asterisks during manual copying.
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

CREATE OR REPLACE FUNCTION public.ballers_open_games() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE coalesce(jsonb_agg(jsonb_build_object('id',g.id,'community_id',g.community_id,'title',g.title,'city',c.city,'game_date',g.game_date,'start_time',g.start_time,'venue',g.venue,'format',g.format,'capacity',g.capacity,'join_mode',s.join_mode,
 'going',(SELECT count(1) FROM public.game_participants WHERE game_day_id=g.id AND attendance_status='GOING')) ORDER BY g.game_date,g.start_time),'[]'::jsonb) END
 FROM public.game_days g JOIN public.communities c ON c.id=g.community_id JOIN public.ballers_game_settings s ON s.game_day_id=g.id WHERE s.is_open AND g.status='OPEN' AND g.game_date>=current_date;
$$;
INSERT INTO public.ballers_migration_history(version) VALUES('20261027_006');
NOTIFY pgrst, 'reload schema';
COMMIT;
