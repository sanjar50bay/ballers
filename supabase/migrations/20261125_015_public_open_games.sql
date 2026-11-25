BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261119_014') THEN RAISE EXCEPTION 'Apply migration 014 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261125_015') THEN RAISE EXCEPTION 'Migration 015 already applied'; END IF;
END $$;

-- Public cards contain only information an organizer has opened for recruitment.
-- Keep the existing authenticated RPC and all table/mutation permissions intact.
CREATE FUNCTION public.ballers_public_open_games(p_city text DEFAULT NULL, p_limit integer DEFAULT 24, p_game uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(card) ORDER BY card.game_date,card.start_time NULLS LAST,card.id),'[]'::jsonb)
 FROM (
  SELECT g.id,g.title,c.city,g.game_date,g.start_time,g.venue,g.format,g.capacity,s.join_mode,
   (SELECT count(*) FROM public.game_participants p WHERE p.game_day_id=g.id AND p.attendance_status='GOING') AS going
  FROM public.game_days g
  JOIN public.communities c ON c.id=g.community_id
  JOIN public.ballers_game_settings s ON s.game_day_id=g.id
  WHERE s.is_open AND g.status='OPEN'
   AND (p_game IS NULL OR g.id=p_game)
   AND g.game_date >= (statement_timestamp() AT TIME ZONE 'Asia/Almaty')::date
   AND (nullif(btrim(p_city),'') IS NULL OR lower(public.ballers_city(c.city))=lower(public.ballers_city(btrim(p_city))))
   AND NOT EXISTS (SELECT 1 FROM public.ballers_matches m WHERE m.game_day_id=g.id AND m.is_test)
   AND NOT EXISTS (
    SELECT 1 FROM public.game_participants p JOIN public.player_profiles pp ON pp.id=p.player_id
    WHERE p.game_day_id=g.id AND pp.user_id IS NULL AND pp.first_name LIKE 'BALLERS\_TEST\_%' ESCAPE '\'
   )
  ORDER BY g.game_date,g.start_time NULLS LAST,g.id
  LIMIT greatest(1,least(coalesce(p_limit,24),100))
 ) card;
$$;
REVOKE ALL ON FUNCTION public.ballers_public_open_games(text,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ballers_public_open_games(text,integer,uuid) TO anon,authenticated;
INSERT INTO public.ballers_migration_history(version) VALUES('20261125_015');
NOTIFY pgrst, 'reload schema';
COMMIT;
