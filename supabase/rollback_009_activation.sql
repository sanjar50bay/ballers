-- Compatibility rollback: retain all matches, receipts and audit history.
-- Deploy the previous client after disabling enforcement. Do not drop tables or re-run migrations.
BEGIN;
UPDATE public.ballers_leader_policy SET enabled=false WHERE singleton;
UPDATE public.ballers_game_leaders SET enabled=false;
COMMIT;
