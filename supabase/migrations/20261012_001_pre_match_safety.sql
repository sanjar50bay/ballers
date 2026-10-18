-- BALLERS stage 1: apply to a disposable Supabase project first.
-- One transaction. No player/attendance/team data is deleted by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ballers_migration_history (
  version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ballers_migration_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_migration_history FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.ballers_migration_history WHERE version='20261012_001') THEN
    RAISE EXCEPTION 'Migration 20261012_001 already applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_day_teams GROUP BY game_day_id, color_key HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate team colors exist. Review before migration; no data was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_day_team_players a JOIN public.game_day_teams t ON t.id=a.team_id WHERE a.game_day_id<>t.game_day_id) THEN
    RAISE EXCEPTION 'Cross-game assignments exist. Review before migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_day_team_players a WHERE NOT EXISTS
    (SELECT 1 FROM public.game_participants p WHERE p.game_day_id=a.game_day_id AND p.player_id=a.player_id AND p.attendance_status='GOING')) THEN
    RAISE EXCEPTION 'Assignments for non-GOING players exist. Review before migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_days GROUP BY community_id,sequence_number HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate Game Day numbers exist. Review before migration.';
  END IF;
END $$;

ALTER TABLE public.game_days ADD COLUMN IF NOT EXISTS roster_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.game_days ADD CONSTRAINT ballers_game_number_unique UNIQUE(community_id,sequence_number);
ALTER TABLE public.game_day_teams ADD CONSTRAINT ballers_team_game_unique UNIQUE(id,game_day_id);
ALTER TABLE public.game_day_teams ADD CONSTRAINT ballers_team_color_unique UNIQUE(game_day_id,color_key);
ALTER TABLE public.game_day_team_players ADD CONSTRAINT ballers_assignment_same_game
  FOREIGN KEY(team_id,game_day_id) REFERENCES public.game_day_teams(id,game_day_id) ON DELETE CASCADE;

-- Supply Baller IDs only if the existing column has neither identity nor default.
DO $$ DECLARE v_default text; v_identity text; BEGIN
  SELECT column_default,is_identity INTO v_default,v_identity FROM information_schema.columns
    WHERE table_schema='public' AND table_name='player_profiles' AND column_name='baller_id';
  IF v_default IS NULL AND v_identity='NO' THEN
    CREATE SEQUENCE IF NOT EXISTS public.ballers_profile_number_seq;
    PERFORM setval('public.ballers_profile_number_seq',GREATEST(COALESCE((SELECT max(baller_id) FROM public.player_profiles),0)+1,1),false);
    ALTER TABLE public.player_profiles ALTER COLUMN baller_id SET DEFAULT nextval('public.ballers_profile_number_seq');
    GRANT USAGE ON SEQUENCE public.ballers_profile_number_seq TO authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ballers_is_manager(p_community_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
   SELECT 1 FROM public.community_members cm JOIN public.player_profiles pp ON pp.id=cm.player_id
   WHERE cm.community_id=p_community_id AND pp.user_id=auth.uid() AND cm.role IN ('OWNER','MANAGER'));
$$;
REVOKE ALL ON FUNCTION public.ballers_is_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ballers_is_manager(uuid) TO authenticated;

-- Replace only known write policies; abort for unknown broad write policies below.
DROP POLICY IF EXISTS "Users can join communities" ON public.community_members;
CREATE POLICY ballers_creator_initial_membership ON public.community_members FOR INSERT TO authenticated
WITH CHECK (
  role='OWNER' AND EXISTS(SELECT 1 FROM public.player_profiles pp WHERE pp.id=player_id AND pp.user_id=auth.uid())
  AND EXISTS(SELECT 1 FROM public.communities c WHERE c.id=community_id AND c.created_by=auth.uid())
  AND NOT EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=community_members.community_id)
);
DROP POLICY IF EXISTS "Users can create game days" ON public.game_days;
CREATE POLICY ballers_managers_create_game_days ON public.game_days FOR INSERT TO authenticated
WITH CHECK (created_by=auth.uid() AND public.ballers_is_manager(community_id));
DROP POLICY IF EXISTS "Authenticated users can create invites" ON public.invites;
CREATE POLICY ballers_managers_create_game_invites ON public.invites FOR INSERT TO authenticated
WITH CHECK (
 created_by=auth.uid() AND invite_type='GAME_GUEST' AND game_day_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.game_days gd WHERE gd.id=game_day_id AND gd.community_id=invites.community_id
   AND gd.status='OPEN' AND public.ballers_is_manager(gd.community_id))
 AND uses_count=0 AND (max_uses IS NULL OR max_uses>0)
 AND (expires_at IS NULL OR expires_at>now())
);

DROP POLICY IF EXISTS "Players can join game days" ON public.game_participants;
DROP POLICY IF EXISTS "Community managers can invite members" ON public.game_participants;
CREATE POLICY ballers_managers_invite_members ON public.game_participants FOR INSERT TO authenticated
WITH CHECK (
 attendance_status='INVITED' AND participant_type='MEMBER'
 AND EXISTS(SELECT 1 FROM public.game_days gd JOIN public.community_members cm ON cm.community_id=gd.community_id
 WHERE gd.id=game_day_id AND gd.status='OPEN' AND cm.player_id=game_participants.player_id AND public.ballers_is_manager(gd.community_id))
);
DROP POLICY IF EXISTS "Players can update their attendance" ON public.game_participants;
DROP POLICY IF EXISTS "Community managers can update participants" ON public.game_participants;

DROP POLICY IF EXISTS "Community managers can assign game day team players" ON public.game_day_team_players;
DROP POLICY IF EXISTS "Community managers can update game day team players" ON public.game_day_team_players;
DROP POLICY IF EXISTS "Community managers can remove game day team players" ON public.game_day_team_players;
DROP POLICY IF EXISTS "Community managers can create game day teams" ON public.game_day_teams;
DROP POLICY IF EXISTS "Community managers can update game day teams" ON public.game_day_teams;
DROP POLICY IF EXISTS "Community managers can delete game day teams" ON public.game_day_teams;

-- Unknown permissive policies must not silently bypass the RPCs.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND
 ((tablename IN ('game_day_teams','game_day_team_players') AND cmd IN ('ALL','INSERT','UPDATE','DELETE'))
 OR (tablename='game_participants' AND cmd IN ('ALL','UPDATE','DELETE'))
 OR (tablename='community_members' AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND policyname<>'ballers_creator_initial_membership')
 OR (tablename='game_days' AND cmd IN ('ALL','INSERT') AND policyname<>'ballers_managers_create_game_days')
 OR (tablename='invites' AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND policyname<>'ballers_managers_create_game_invites'))) THEN
 RAISE EXCEPTION 'Unexpected write policies: review before applying this migration';
 END IF;
END $$;

CREATE TABLE public.ballers_pre_match_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 game_day_id uuid NOT NULL REFERENCES public.game_days(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL, roster_version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ballers_pre_match_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_pre_match_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ballers_pre_match_audit TO authenticated;
CREATE POLICY ballers_managers_read_audit ON public.ballers_pre_match_audit FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.game_days gd WHERE gd.id=game_day_id AND public.ballers_is_manager(gd.community_id)));

CREATE OR REPLACE FUNCTION public.ballers_team_action(
 p_game_id uuid,p_expected_version bigint,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; rec_team public.game_day_teams%ROWTYPE;
 rec_assignment public.game_day_team_players%ROWTYPE; v_team uuid; v_player uuid;
 v_max int; v_going int; v_teams int; v_left int:=0; v_version bigint;
 v_names text[]:=ARRAY['Blue','Red','Yellow','Green','Orange','White','Black','Purple'];
 v_colors text[]:=ARRAY['BLUE','RED','YELLOW','GREEN','ORANGE','WHITE','BLACK','PURPLE'];
 v_row record; v_target uuid; v_core boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO g FROM public.game_days WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GAME_NOT_FOUND'; END IF;
 IF NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>g.roster_version THEN RAISE EXCEPTION 'ROSTER_CHANGED_REFRESH'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
 SELECT count(*) INTO v_going FROM public.game_participants WHERE game_day_id=p_game_id AND attendance_status='GOING';
 SELECT count(*) INTO v_teams FROM public.game_day_teams WHERE game_day_id=p_game_id;
 v_max:=CASE WHEN v_teams>0 THEN ceil(v_going::numeric/v_teams)::int ELSE 0 END;

 CASE p_action
 WHEN 'BUILD' THEN
   IF v_teams>0 THEN RAISE EXCEPTION 'TEAMS_ALREADY_EXIST'; END IF;
   IF g.team_count<2 OR g.team_count>cardinality(v_colors) THEN RAISE EXCEPTION 'STAGE1_SUPPORTS_2_TO_8_TEAMS'; END IF;
   INSERT INTO public.game_day_teams(game_day_id,name,color_key,sort_order,team_mode)
   SELECT p_game_id,v_names[n],v_colors[n],n,'RANDOM' FROM generate_series(1,g.team_count) n;
 WHEN 'RESET' THEN
   DELETE FROM public.game_day_team_players WHERE game_day_id=p_game_id;
 WHEN 'ASSIGN' THEN
   v_player:=(p_payload->>'player_id')::uuid; v_team:=(p_payload->>'team_id')::uuid;
   IF v_player IS NULL THEN RAISE EXCEPTION 'PLAYER_REQUIRED'; END IF;
   SELECT * INTO rec_assignment FROM public.game_day_team_players WHERE game_day_id=p_game_id AND player_id=v_player;
   IF rec_assignment.id IS NOT NULL AND rec_assignment.team_id IS NOT DISTINCT FROM v_team THEN
     RETURN jsonb_build_object('roster_version',g.roster_version,'unassigned',0);
   END IF;
   IF rec_assignment.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.game_day_teams old WHERE old.id=rec_assignment.team_id
      AND (old.team_mode='FIXED' OR (old.team_mode='CORE_PLUS_FILL' AND rec_assignment.is_core))) THEN
     RAISE EXCEPTION 'PLAYER_PROTECTED_CHANGE_MODE_OR_CORE_FIRST';
   END IF;
   IF v_team IS NOT NULL THEN
     SELECT * INTO rec_team FROM public.game_day_teams WHERE id=v_team AND game_day_id=p_game_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_GAME_MISMATCH'; END IF;
     IF NOT EXISTS(SELECT 1 FROM public.game_participants WHERE game_day_id=p_game_id AND player_id=v_player AND attendance_status='GOING') THEN
       RAISE EXCEPTION 'PLAYER_NOT_GOING';
     END IF;
     IF (SELECT count(*) FROM public.game_day_team_players WHERE team_id=v_team)>=v_max THEN RAISE EXCEPTION 'TEAM_ROSTER_FULL'; END IF;
   END IF;
   DELETE FROM public.game_day_team_players WHERE game_day_id=p_game_id AND player_id=v_player;
   IF v_team IS NOT NULL THEN
     INSERT INTO public.game_day_team_players(game_day_id,team_id,player_id,is_core) VALUES(p_game_id,v_team,v_player,COALESCE(rec_assignment.is_core,false));
   END IF;
 WHEN 'CORE' THEN
   SELECT * INTO rec_assignment FROM public.game_day_team_players WHERE id=(p_payload->>'assignment_id')::uuid AND game_day_id=p_game_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
   v_core:=(p_payload->>'is_core')::boolean;
   IF v_core IS NULL THEN RAISE EXCEPTION 'CORE_FLAG_REQUIRED'; END IF;
   UPDATE public.game_day_team_players SET is_core=v_core WHERE id=rec_assignment.id;
 WHEN 'UPDATE_TEAM' THEN
   v_team:=(p_payload->>'team_id')::uuid;
   SELECT * INTO rec_team FROM public.game_day_teams WHERE id=v_team AND game_day_id=p_game_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_GAME_MISMATCH'; END IF;
   IF p_payload ? 'name' AND (length(trim(p_payload->>'name'))=0 OR length(trim(p_payload->>'name'))>80 OR p_payload->>'name' IS NULL) THEN
     RAISE EXCEPTION 'INVALID_TEAM_NAME';
   END IF;
   IF p_payload ? 'color_key' AND (p_payload->>'color_key' IS NULL OR NOT (p_payload->>'color_key'=ANY(v_colors))) THEN RAISE EXCEPTION 'INVALID_TEAM_COLOR'; END IF;
   IF p_payload ? 'team_mode' AND (p_payload->>'team_mode' IS NULL OR p_payload->>'team_mode' NOT IN ('RANDOM','FIXED','CORE_PLUS_FILL')) THEN RAISE EXCEPTION 'INVALID_TEAM_MODE'; END IF;
   UPDATE public.game_day_teams SET
    name=CASE WHEN p_payload ? 'name' THEN trim(p_payload->>'name') ELSE name END,
    color_key=CASE WHEN p_payload ? 'color_key' THEN p_payload->>'color_key' ELSE color_key END,
    team_mode=CASE WHEN p_payload ? 'team_mode' THEN p_payload->>'team_mode' ELSE team_mode END WHERE id=v_team;
 WHEN 'RANDOMIZE' THEN
   IF v_teams=0 OR v_going=0 THEN RAISE EXCEPTION 'NO_TEAMS_OR_GOING_PLAYERS'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.game_day_teams WHERE game_day_id=p_game_id AND team_mode<>'FIXED') THEN RAISE EXCEPTION 'ALL_TEAMS_FIXED'; END IF;
   DELETE FROM public.game_day_team_players a USING public.game_day_teams t
    WHERE a.team_id=t.id AND a.game_day_id=p_game_id AND t.team_mode<>'FIXED'
      AND NOT(t.team_mode='CORE_PLUS_FILL' AND a.is_core);
   FOR v_row IN SELECT p.player_id FROM public.game_participants p WHERE p.game_day_id=p_game_id AND p.attendance_status='GOING'
     AND NOT EXISTS(SELECT 1 FROM public.game_day_team_players a WHERE a.game_day_id=p_game_id AND a.player_id=p.player_id) ORDER BY random() LOOP
     SELECT t.id INTO v_target FROM public.game_day_teams t LEFT JOIN public.game_day_team_players a ON a.team_id=t.id
       WHERE t.game_day_id=p_game_id AND t.team_mode<>'FIXED'
       GROUP BY t.id,t.sort_order HAVING count(a.id)<v_max ORDER BY count(a.id),t.sort_order LIMIT 1;
     IF v_target IS NULL THEN v_left:=v_left+1;
     ELSE INSERT INTO public.game_day_team_players(game_day_id,team_id,player_id,is_core) VALUES(p_game_id,v_target,v_row.player_id,false);
     END IF;
   END LOOP;
 ELSE RAISE EXCEPTION 'UNKNOWN_TEAM_ACTION';
 END CASE;
 UPDATE public.game_days SET roster_version=roster_version+1 WHERE id=p_game_id RETURNING roster_version INTO v_version;
 INSERT INTO public.ballers_pre_match_audit(game_day_id,actor_user_id,action,roster_version) VALUES(p_game_id,auth.uid(),p_action,v_version);
 RETURN jsonb_build_object('roster_version',v_version,'unassigned',v_left);
END $$;
REVOKE ALL ON FUNCTION public.ballers_team_action(uuid,bigint,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_team_action(uuid,bigint,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_set_attendance(p_game_id uuid,p_player_id uuid,p_status public.attendance_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE; v_user uuid; v_old public.attendance_status; v_member boolean; v_version bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT * INTO g FROM public.game_days WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GAME_NOT_FOUND'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 IF p_status IS NULL OR p_status::text NOT IN ('GOING','MAYBE','DECLINED','INVITED') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE'; END IF;
 SELECT user_id INTO v_user FROM public.player_profiles WHERE id=p_player_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND'; END IF;
 IF v_user IS DISTINCT FROM auth.uid() AND NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'ATTENDANCE_FORBIDDEN'; END IF;
 IF p_status='INVITED' AND NOT public.ballers_is_manager(g.community_id) THEN RAISE EXCEPTION 'MANAGER_REQUIRED'; END IF;
 SELECT attendance_status INTO v_old FROM public.game_participants WHERE game_day_id=p_game_id AND player_id=p_player_id;
 SELECT EXISTS(SELECT 1 FROM public.community_members WHERE community_id=g.community_id AND player_id=p_player_id) INTO v_member;
 IF v_old IS NULL AND NOT v_member THEN RAISE EXCEPTION 'INVITATION_REQUIRED'; END IF;
 IF p_status='GOING' AND v_old IS DISTINCT FROM 'GOING' AND g.capacity IS NOT NULL
   AND (SELECT count(*) FROM public.game_participants WHERE game_day_id=p_game_id AND attendance_status='GOING')>=g.capacity THEN
   RAISE EXCEPTION 'GAME_FULL_WAITLIST_NOT_YET_IMPLEMENTED';
 END IF;
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type)
  VALUES(p_game_id,p_player_id,p_status,'MEMBER') ON CONFLICT(game_day_id,player_id) DO UPDATE SET attendance_status=excluded.attendance_status;
 IF p_status<>'GOING' THEN DELETE FROM public.game_day_team_players WHERE game_day_id=p_game_id AND player_id=p_player_id; END IF;
 UPDATE public.game_days SET roster_version=roster_version+1 WHERE id=p_game_id RETURNING roster_version INTO v_version;
 INSERT INTO public.ballers_pre_match_audit(game_day_id,actor_user_id,action,roster_version) VALUES(p_game_id,auth.uid(),'ATTENDANCE',v_version);
END $$;
REVOKE ALL ON FUNCTION public.ballers_set_attendance(uuid,uuid,public.attendance_status) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_set_attendance(uuid,uuid,public.attendance_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_join_game_invite(p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.invites%ROWTYPE; g public.game_days%ROWTYPE; v_player uuid; v_old public.attendance_status; v_version bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT id INTO v_player FROM public.player_profiles WHERE user_id=auth.uid();
 IF v_player IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED'; END IF;
 SELECT * INTO i FROM public.invites WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
 IF i.invite_type<>'GAME_GUEST' OR i.game_day_id IS NULL THEN RAISE EXCEPTION 'INVALID_INVITE_TYPE'; END IF;
 SELECT * INTO g FROM public.game_days WHERE id=i.game_day_id FOR UPDATE;
 IF NOT FOUND OR g.community_id IS DISTINCT FROM i.community_id THEN RAISE EXCEPTION 'INVALID_INVITE_GAME'; END IF;
 SELECT attendance_status INTO v_old FROM public.game_participants WHERE game_day_id=g.id AND player_id=v_player;
 IF v_old='GOING' THEN RETURN g.id; END IF;
 IF NOT i.is_active OR (i.expires_at IS NOT NULL AND i.expires_at<=now()) OR (i.max_uses IS NOT NULL AND i.uses_count>=i.max_uses) THEN RAISE EXCEPTION 'INVITE_UNAVAILABLE'; END IF;
 IF g.status<>'OPEN' THEN RAISE EXCEPTION 'GAME_NOT_OPEN'; END IF;
 IF g.capacity IS NOT NULL AND (SELECT count(*) FROM public.game_participants WHERE game_day_id=g.id AND attendance_status='GOING')>=g.capacity THEN
  RAISE EXCEPTION 'GAME_FULL_WAITLIST_NOT_YET_IMPLEMENTED';
 END IF;
 INSERT INTO public.game_participants(game_day_id,player_id,attendance_status,participant_type) VALUES(g.id,v_player,'GOING','GUEST')
 ON CONFLICT(game_day_id,player_id) DO UPDATE SET attendance_status='GOING';
 UPDATE public.invites SET uses_count=uses_count+1 WHERE id=i.id;
 UPDATE public.game_days SET roster_version=roster_version+1 WHERE id=g.id RETURNING roster_version INTO v_version;
 INSERT INTO public.ballers_pre_match_audit(game_day_id,actor_user_id,action,roster_version) VALUES(g.id,auth.uid(),'JOIN_INVITE',v_version);
 RETURN g.id;
END $$;
REVOKE ALL ON FUNCTION public.ballers_join_game_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_join_game_invite(uuid) TO authenticated;

-- Keep the existing return type (used by the current invitation screen).
CREATE OR REPLACE FUNCTION public.get_invite_by_token(invite_token uuid)
RETURNS TABLE(invite_id uuid, token uuid, invite_type public.invite_type, community_id uuid,
 community_name text, game_day_id uuid, game_title text, game_date date,start_time time without time zone,
 venue text,format integer,capacity integer,is_active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.id,i.token,i.invite_type,i.community_id,c.name,i.game_day_id,gd.title,gd.game_date,gd.start_time,
 gd.venue,gd.format,gd.capacity,i.is_active
 FROM public.invites i JOIN public.game_days gd ON gd.id=i.game_day_id AND gd.community_id=i.community_id
 JOIN public.communities c ON c.id=i.community_id
 WHERE i.token=invite_token AND i.invite_type='GAME_GUEST' AND i.is_active
 AND (i.expires_at IS NULL OR i.expires_at>now()) AND (i.max_uses IS NULL OR i.uses_count<i.max_uses)
 AND gd.status='OPEN' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_invite_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(uuid) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.add_player_to_community(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_player_to_community(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ballers_create_community(p_name text,p_city text,p_team_mode public.team_mode,p_format integer,p_team_count integer,p_capacity integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_player uuid; v_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT id INTO v_player FROM public.player_profiles WHERE user_id=auth.uid();
 IF v_player IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED'; END IF;
 IF p_name IS NULL OR length(trim(p_name))=0 OR length(trim(p_name))>120 THEN RAISE EXCEPTION 'INVALID_COMMUNITY_NAME'; END IF;
 IF p_format IS NULL OR p_format<5 OR p_format>11 OR p_team_count IS NULL OR p_team_count<2 OR p_team_count>8
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
 IF p_date IS NULL OR p_format IS NULL OR p_format<5 OR p_format>11 OR p_team_count IS NULL OR p_team_count<2 OR p_team_count>8
 OR (p_capacity IS NOT NULL AND p_capacity<1) THEN RAISE EXCEPTION 'INVALID_GAME_SETTINGS'; END IF;
 SELECT COALESCE(max(sequence_number),0)+1 INTO v_number FROM public.game_days WHERE community_id=c.id;
 INSERT INTO public.game_days(community_id,sequence_number,title,game_date,start_time,venue,format,team_count,capacity,created_by)
 VALUES(c.id,v_number,c.name||' #'||v_number,p_date,p_time,nullif(trim(p_venue),''),p_format,p_team_count,p_capacity,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ballers_create_game_day(uuid,date,time,text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_create_game_day(uuid,date,time,text,integer,integer,integer) TO authenticated;

INSERT INTO public.ballers_migration_history(version) VALUES('20261012_001');
COMMIT;
