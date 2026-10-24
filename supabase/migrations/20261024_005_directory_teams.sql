-- BALLERS 0.2.6. Apply ONCE after migration 004. Existing accounts and matches are preserved.
-- Entire file, including BEGIN and COMMIT. Do NOT rerun baseline or migrations 001-004.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261019_004') THEN RAISE EXCEPTION 'Apply migration 004 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261024_005') THEN RAISE EXCEPTION 'Migration 005 already applied'; END IF;
END $$;
CREATE FUNCTION public.ballers_city(p_city text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE lower(trim(coalesce(p_city,''))) WHEN 'астана' THEN 'Astana' WHEN 'астана қаласы' THEN 'Astana' WHEN 'astana' THEN 'Astana' WHEN 'nur-sultan' THEN 'Astana' WHEN 'нур-султан' THEN 'Astana' WHEN 'алматы' THEN 'Almaty' WHEN 'almaty' THEN 'Almaty' WHEN 'караганда' THEN 'Karaganda' WHEN 'қарағанды' THEN 'Karaganda' WHEN 'karaganda' THEN 'Karaganda' ELSE trim(coalesce(p_city,'')) END
$$;
CREATE TABLE public.ballers_football_preferences(
 player_id uuid PRIMARY KEY REFERENCES public.player_profiles(id) ON DELETE CASCADE,
 search_status text NOT NULL CHECK(search_status IN('LOOKING','HAVE_TEAM','PLAY')),
 available boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ballers_teams(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 60),
 city text NOT NULL CHECK(length(trim(city)) BETWEEN 2 AND 80), about text NOT NULL DEFAULT '' CHECK(length(about)<=500),
 created_by uuid NOT NULL REFERENCES public.player_profiles(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX ballers_team_city_name ON public.ballers_teams(lower(name),lower(city));
CREATE TABLE public.ballers_team_people(
 team_id uuid NOT NULL REFERENCES public.ballers_teams(id) ON DELETE CASCADE,
 player_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'PLAYER' CHECK(role IN('CAPTAIN','PLAYER')),
 status text NOT NULL CHECK(status IN('ACTIVE','INVITED','REQUESTED','DECLINED')),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(team_id,player_id));
CREATE INDEX ballers_team_people_player ON public.ballers_team_people(player_id,status);
CREATE TABLE public.ballers_team_communities(
 team_id uuid NOT NULL REFERENCES public.ballers_teams(id) ON DELETE CASCADE,
 community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN('REQUESTED','ACTIVE','DECLINED')),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(team_id,community_id));
CREATE INDEX ballers_team_community_lookup ON public.ballers_team_communities(community_id,status);
CREATE TABLE public.ballers_network_operations(id uuid PRIMARY KEY,actor uuid NOT NULL REFERENCES public.player_profiles(id),team_id uuid NOT NULL REFERENCES public.ballers_teams(id),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ballers_network_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_network_operations FROM PUBLIC,anon,authenticated;
ALTER TABLE public.ballers_football_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ballers_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ballers_team_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ballers_team_communities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ballers_football_preferences,public.ballers_teams,public.ballers_team_people,public.ballers_team_communities FROM PUBLIC,anon,authenticated;
-- All reads are bounded, authenticated RPCs with explicit public-field allowlists.
CREATE FUNCTION public.ballers_directory(p_kind text DEFAULT 'players',p_city text DEFAULT '',p_query text DEFAULT '',p_offset int DEFAULT 0,p_free boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; v_city text:=public.ballers_city(p_city); q text:=lower(left(trim(coalesce(p_query,'')),80)); offn int:=greatest(0,least(coalesce(p_offset,0),10000));
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_kind='players' THEN
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT p.id,p.baller_id,p.first_name,p.last_name,p.display_name,p.avatar_url,p.city,p.primary_position,coalesce(f.search_status,'PLAY') search_status,f.available available
 FROM public.player_profiles p LEFT JOIN public.ballers_football_preferences f ON f.player_id=p.id
 WHERE p.user_id IS NOT NULL AND (v_city='' OR lower(public.ballers_city(p.city))=lower(v_city)) AND (NOT coalesce(p_free,false) OR f.search_status='LOOKING')
 AND (q='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name,p.display_name)),q)>0 OR p.baller_id::text=replace(q,'#',''))
 ORDER BY p.created_at DESC,p.id LIMIT 25 OFFSET offn) x;
 ELSIF p_kind='teams' THEN
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT t.id,t.name,t.city,t.about,(SELECT count(*) FROM public.ballers_team_people m WHERE m.team_id=t.id AND m.status='ACTIVE') members
 FROM public.ballers_teams t WHERE (v_city='' OR lower(public.ballers_city(t.city))=lower(v_city)) AND (q='' OR strpos(lower(t.name),q)>0)
 ORDER BY t.created_at DESC,t.id LIMIT 25 OFFSET offn) x;
 ELSIF p_kind='communities' THEN
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO result FROM (
 SELECT c.id,c.name,c.city,(SELECT count(*) FROM public.ballers_team_communities tc WHERE tc.community_id=c.id AND tc.status='ACTIVE') teams,
 (SELECT count(*) FROM public.community_members cm WHERE cm.community_id=c.id AND cm.member_status='REGULAR') members
 FROM public.communities c WHERE (v_city='' OR lower(public.ballers_city(c.city))=lower(v_city)) AND (q='' OR strpos(lower(c.name),q)>0)
 ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET offn) x;
 ELSE RAISE EXCEPTION 'INVALID_KIND';END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(v),'[]'::jsonb) FROM jsonb_array_elements(result) WITH ORDINALITY e(v,n) WHERE n<=24),'has_more',jsonb_array_length(result)>24);
END $$;
CREATE FUNCTION public.ballers_football_save(p_city text,p_status text,p_available boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; v_city text:=public.ballers_city(p_city);
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF length(v_city) NOT BETWEEN 2 AND 80 OR p_status IS NULL OR p_status NOT IN('LOOKING','HAVE_TEAM','PLAY') OR p_available IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 UPDATE public.player_profiles SET city=v_city,updated_at=now() WHERE id=actor;
 INSERT INTO public.ballers_football_preferences(player_id,search_status,available) VALUES(actor,p_status,p_available)
 ON CONFLICT(player_id) DO UPDATE SET search_status=excluded.search_status,available=excluded.available,updated_at=now();
END $$;
CREATE FUNCTION public.ballers_team_create(p_id uuid,p_name text,p_city text,p_about text DEFAULT '') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; existing public.ballers_teams%ROWTYPE;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF p_id IS NULL OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 60 OR length(public.ballers_city(p_city)) NOT BETWEEN 2 AND 80 OR p_about IS NULL OR length(p_about)>500 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 -- Serialize retries of the same client-generated creation ID.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO existing FROM public.ballers_teams WHERE id=p_id;
 IF FOUND THEN IF existing.created_by=actor AND existing.name=trim(p_name) AND existing.city=public.ballers_city(p_city) THEN RETURN p_id; ELSE RAISE EXCEPTION 'ID_REUSE';END IF;END IF;
 INSERT INTO public.ballers_teams(id,name,city,about,created_by) VALUES(p_id,trim(p_name),public.ballers_city(p_city),trim(p_about),actor);
 INSERT INTO public.ballers_team_people(team_id,player_id,role,status) VALUES(p_id,actor,'CAPTAIN','ACTIVE');RETURN p_id;
END $$;
CREATE FUNCTION public.ballers_club_action(p_team uuid,p_action text,p_players uuid[] DEFAULT '{}',p_community uuid DEFAULT NULL,p_accept boolean DEFAULT true,p_operation uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; tm public.ballers_teams%ROWTYPE; captain boolean; target uuid; receipt public.ballers_network_operations%ROWTYPE; payload jsonb;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT * INTO tm FROM public.ballers_teams WHERE id=p_team FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND';END IF;
 captain:=tm.created_by=actor;
 payload:=jsonb_build_object('action',p_action,'players',p_players,'community',p_community,'accept',p_accept);
 IF p_operation IS NOT NULL THEN
 SELECT * INTO receipt FROM public.ballers_network_operations WHERE id=p_operation;
 IF FOUND THEN IF receipt.actor=actor AND receipt.team_id=p_team AND receipt.payload=payload THEN RETURN; ELSE RAISE EXCEPTION 'OPERATION_ID_REUSE';END IF;END IF;
 END IF;

 IF p_accept IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF coalesce(cardinality(p_players),0)>30 THEN RAISE EXCEPTION 'BATCH_LIMIT';END IF;
 CASE p_action
 WHEN 'REQUEST' THEN
 INSERT INTO public.ballers_team_people(team_id,player_id,status) VALUES(p_team,actor,'REQUESTED') ON CONFLICT(team_id,player_id) DO UPDATE SET status='REQUESTED',updated_at=now() WHERE public.ballers_team_people.status='DECLINED';
 WHEN 'INVITE' THEN
 IF NOT captain THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED';END IF;
 IF coalesce(cardinality(p_players),0)<1 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOREACH target IN ARRAY p_players LOOP
 IF NOT EXISTS(SELECT 1 FROM public.player_profiles WHERE id=target AND user_id IS NOT NULL) THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND';END IF;
 INSERT INTO public.ballers_team_people(team_id,player_id,status) VALUES(p_team,target,'INVITED') ON CONFLICT(team_id,player_id) DO UPDATE SET status='INVITED',updated_at=now() WHERE public.ballers_team_people.status='DECLINED';
 END LOOP;
 WHEN 'ANSWER_INVITE' THEN
 UPDATE public.ballers_team_people SET status=CASE WHEN p_accept THEN 'ACTIVE' ELSE 'DECLINED' END,updated_at=now() WHERE team_id=p_team AND player_id=actor AND status='INVITED';
 -- A retry of a resolved response is a no-op, never reverses membership.
 WHEN 'ANSWER_REQUEST' THEN
 IF NOT captain THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED';END IF;
 UPDATE public.ballers_team_people SET status=CASE WHEN p_accept THEN 'ACTIVE' ELSE 'DECLINED' END,updated_at=now() WHERE team_id=p_team AND player_id=ANY(p_players) AND status='REQUESTED';
 WHEN 'LEAVE' THEN
 IF captain THEN RAISE EXCEPTION 'CAPTAIN_CANNOT_LEAVE';END IF;
 UPDATE public.ballers_team_people SET status='DECLINED',updated_at=now() WHERE team_id=p_team AND player_id=actor;
 WHEN 'REMOVE' THEN
 IF NOT captain THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED';END IF;
 UPDATE public.ballers_team_people SET status='DECLINED',updated_at=now() WHERE team_id=p_team AND player_id=ANY(p_players) AND player_id<>tm.created_by;
 WHEN 'LINK' THEN
 IF NOT captain THEN RAISE EXCEPTION 'CAPTAIN_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communities WHERE id=p_community) THEN RAISE EXCEPTION 'COMMUNITY_NOT_FOUND';END IF;
 INSERT INTO public.ballers_team_communities(team_id,community_id,status) VALUES(p_team,p_community,'REQUESTED') ON CONFLICT(team_id,community_id) DO UPDATE SET status='REQUESTED',updated_at=now() WHERE public.ballers_team_communities.status='DECLINED';
 WHEN 'ANSWER_LINK' THEN
 IF NOT coalesce(public.ballers_is_manager(p_community),false) THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
 UPDATE public.ballers_team_communities SET status=CASE WHEN p_accept THEN 'ACTIVE' ELSE 'DECLINED' END,updated_at=now() WHERE team_id=p_team AND community_id=p_community AND status='REQUESTED';
 WHEN 'UNLINK' THEN
 IF NOT captain AND NOT coalesce(public.ballers_is_manager(p_community),false) THEN RAISE EXCEPTION 'MANAGER_REQUIRED';END IF;
 UPDATE public.ballers_team_communities SET status='DECLINED',updated_at=now() WHERE team_id=p_team AND community_id=p_community;
 ELSE RAISE EXCEPTION 'INVALID_ACTION';END CASE;
 IF p_operation IS NOT NULL THEN INSERT INTO public.ballers_network_operations(id,actor,team_id,payload) VALUES(p_operation,actor,p_team,payload);END IF;
END $$;
CREATE FUNCTION public.ballers_team_detail(p_team uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; tm public.ballers_teams%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 SELECT * INTO tm FROM public.ballers_teams WHERE id=p_team;IF NOT FOUND THEN RAISE EXCEPTION 'TEAM_NOT_FOUND';END IF;
 RETURN jsonb_build_object('team',jsonb_build_object('id',tm.id,'name',tm.name,'city',tm.city,'about',tm.about),'captain',tm.created_by=actor,
 'my_status',(SELECT status FROM public.ballers_team_people WHERE team_id=p_team AND player_id=actor),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'baller_id',p.baller_id,'name',coalesce(nullif(p.display_name,''),concat_ws(' ',p.first_name,p.last_name)),'avatar_url',p.avatar_url,'primary_position',p.primary_position,'role',m.role) ORDER BY m.role,p.first_name,p.id) FROM public.ballers_team_people m JOIN public.player_profiles p ON p.id=m.player_id WHERE m.team_id=p_team AND m.status='ACTIVE'),'[]'::jsonb),
 'pending',CASE WHEN tm.created_by=actor THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'baller_id',p.baller_id,'name',coalesce(nullif(p.display_name,''),concat_ws(' ',p.first_name,p.last_name)),'status',m.status)) FROM public.ballers_team_people m JOIN public.player_profiles p ON p.id=m.player_id WHERE m.team_id=p_team AND m.status IN('INVITED','REQUESTED')),'[]'::jsonb) ELSE '[]'::jsonb END,
 'communities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'status',tc.status)) FROM public.ballers_team_communities tc JOIN public.communities c ON c.id=tc.community_id WHERE tc.team_id=p_team AND (tc.status='ACTIVE' OR (tm.created_by=actor AND tc.status='REQUESTED'))),'[]'::jsonb));
END $$;
CREATE FUNCTION public.ballers_network() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 RETURN jsonb_build_object('preferences',(SELECT jsonb_build_object('search_status',f.search_status,'available',f.available) FROM public.ballers_football_preferences f WHERE player_id=actor),
 'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'city',t.city,'captain',t.created_by=actor)) FROM public.ballers_teams t JOIN public.ballers_team_people m ON m.team_id=t.id WHERE m.player_id=actor AND m.status='ACTIVE'),'[]'::jsonb),
 'inbox',coalesce((SELECT jsonb_agg(x ORDER BY x->>'name') FROM (
 SELECT jsonb_build_object('kind','INVITE','team_id',t.id,'name',t.name,'player_id',actor) x FROM public.ballers_team_people m JOIN public.ballers_teams t ON t.id=m.team_id WHERE m.player_id=actor AND m.status='INVITED'
 UNION ALL SELECT jsonb_build_object('kind','REQUEST','team_id',t.id,'name',t.name,'player_id',p.id,'player_name',coalesce(nullif(p.display_name,''),concat_ws(' ',p.first_name,p.last_name))) FROM public.ballers_team_people m JOIN public.ballers_teams t ON t.id=m.team_id JOIN public.player_profiles p ON p.id=m.player_id WHERE t.created_by=actor AND m.status='REQUESTED'
 UNION ALL SELECT jsonb_build_object('kind','LINK','team_id',t.id,'name',t.name,'community_id',c.id,'community_name',c.name) FROM public.ballers_team_communities tc JOIN public.ballers_teams t ON t.id=tc.team_id JOIN public.communities c ON c.id=tc.community_id WHERE tc.status='REQUESTED' AND public.ballers_is_manager(c.id)
 ) items),'[]'::jsonb));
END $$;
CREATE FUNCTION public.ballers_community_preview(p_community uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; c public.communities%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT id INTO actor FROM public.player_profiles WHERE user_id=auth.uid();
 SELECT * INTO c FROM public.communities WHERE id=p_community;IF NOT FOUND THEN RAISE EXCEPTION 'COMMUNITY_NOT_FOUND';END IF;
 RETURN jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'member',EXISTS(SELECT 1 FROM public.community_members WHERE community_id=c.id AND player_id=actor AND member_status='REGULAR'),
 'organizer',(SELECT jsonb_build_object('id',p.id,'name',coalesce(nullif(p.display_name,''),concat_ws(' ',p.first_name,p.last_name))) FROM public.player_profiles p WHERE p.user_id=c.created_by),
 'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'city',t.city)) FROM public.ballers_team_communities tc JOIN public.ballers_teams t ON t.id=tc.team_id WHERE tc.community_id=c.id AND tc.status='ACTIVE'),'[]'::jsonb));
END $$;
CREATE FUNCTION public.ballers_public_player(p_player uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 SELECT jsonb_build_object('id',p.id,'baller_id',p.baller_id,'first_name',p.first_name,'last_name',p.last_name,'display_name',p.display_name,'city',p.city,'primary_position',p.primary_position,'avatar_url',p.avatar_url,'search_status',coalesce(f.search_status,'PLAY'),'available',f.available,'stats',public.ballers_player_stats(p.id),
 'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'city',t.city)) FROM public.ballers_team_people m JOIN public.ballers_teams t ON t.id=m.team_id WHERE m.player_id=p.id AND m.status='ACTIVE'),'[]'::jsonb)) INTO result FROM public.player_profiles p LEFT JOIN public.ballers_football_preferences f ON f.player_id=p.id WHERE p.id=p_player AND p.user_id IS NOT NULL;
 IF result IS NULL THEN RAISE EXCEPTION 'PLAYER_NOT_FOUND';END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ballers_city(text),public.ballers_directory(text,text,text,int,boolean),public.ballers_football_save(text,text,boolean),public.ballers_team_create(uuid,text,text,text),public.ballers_club_action(uuid,text,uuid[],uuid,boolean,uuid),public.ballers_team_detail(uuid),public.ballers_network(),public.ballers_community_preview(uuid),public.ballers_public_player(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ballers_directory(text,text,text,int,boolean),public.ballers_football_save(text,text,boolean),public.ballers_team_create(uuid,text,text,text),public.ballers_club_action(uuid,text,uuid[],uuid,boolean,uuid),public.ballers_team_detail(uuid),public.ballers_network(),public.ballers_community_preview(uuid),public.ballers_public_player(uuid) TO authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261024_005');
NOTIFY pgrst, 'reload schema';
COMMIT;
