-- Enforce the scheduled Kazakhstan start on every match-writing path.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_013') THEN RAISE EXCEPTION 'Apply migration 013 first'; END IF;
 IF EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261119_014') THEN RAISE EXCEPTION 'Migration 014 already applied'; END IF;
END $$;
CREATE FUNCTION public.ballers_guard_match_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g public.game_days%ROWTYPE;
BEGIN
 IF NEW.status NOT IN ('LIVE','PAUSED') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='LIVE' AND NEW.status='PAUSED' AND OLD.game_day_id=NEW.game_day_id THEN RETURN NEW; END IF;
  IF OLD.status=NEW.status AND OLD.game_day_id=NEW.game_day_id THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO g FROM public.game_days WHERE id=NEW.game_day_id FOR UPDATE;
 IF statement_timestamp() < ((g.game_date + coalesce(g.start_time,'00:00'::time)) AT TIME ZONE 'Asia/Almaty') THEN
  RAISE EXCEPTION 'GAME_NOT_STARTED_YET';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ballers_guard_match_schedule() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ballers_match_schedule_guard BEFORE INSERT OR UPDATE OF status,game_day_id ON public.ballers_matches
FOR EACH ROW EXECUTE FUNCTION public.ballers_guard_match_schedule();
INSERT INTO public.ballers_migration_history(version) VALUES('20261119_014');
NOTIFY pgrst,'reload schema';
COMMIT;
