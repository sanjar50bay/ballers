-- Storage-only configuration for optional BALLERS profile photos.
-- Apply after application migration 013. Does not alter player profiles or existing files.
-- Storage is Supabase-managed, so this setup is separate from application-schema migrations.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballers_migration_history WHERE version='20261118_013') THEN RAISE EXCEPTION 'Apply application migration 013 first'; END IF;
 IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION 'Supabase Storage is required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Storage RLS must be enabled'; END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('ballers-avatars','ballers-avatars',true,1048576,ARRAY['image/jpeg']) ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='ballers-avatars' AND public AND file_size_limit=1048576 AND allowed_mime_types @> ARRAY['image/jpeg'] AND allowed_mime_types <@ ARRAY['image/jpeg','image/png']) THEN RAISE EXCEPTION 'Existing avatar bucket has unexpected settings; review before changing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ballers_avatar_self_insert') THEN
  CREATE POLICY ballers_avatar_self_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text) AND cardinality(string_to_array(name,'/'))=2 AND right(name,4)='.jpg');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ballers_avatar_self_select') THEN
  CREATE POLICY ballers_avatar_self_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ballers_avatar_self_update') THEN
  CREATE POLICY ballers_avatar_self_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text)) WITH CHECK(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text) AND cardinality(string_to_array(name,'/'))=2 AND right(name,4)='.jpg');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ballers_avatar_self_delete') THEN
  CREATE POLICY ballers_avatar_self_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text));
 END IF;
END $$;
COMMIT;
