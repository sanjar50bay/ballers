-- Apply only after deploying the matching 0.2.12 client and verifying preview.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261117_009') THEN RAISE EXCEPTION 'Apply 009 first'; END IF;
END $$;
UPDATE public.ballers_leader_policy SET enabled=true WHERE singleton;
COMMIT;
