-- Run after setup_profile_photos.sql. Add transparent portraits without changing ownership rules.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='ballers-avatars' AND public AND file_size_limit=1048576) THEN RAISE EXCEPTION 'Set up avatar bucket first'; END IF;
END $$;
UPDATE storage.buckets SET allowed_mime_types=ARRAY['image/jpeg','image/png'] WHERE id='ballers-avatars';
ALTER POLICY ballers_avatar_self_insert ON storage.objects WITH CHECK(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text) AND cardinality(string_to_array(name,'/'))=2 AND (right(name,4)='.jpg' OR right(name,4)='.png'));
ALTER POLICY ballers_avatar_self_update ON storage.objects WITH CHECK(bucket_id='ballers-avatars' AND split_part(name,'/',1)=(select auth.uid()::text) AND owner_id=(select auth.uid()::text) AND cardinality(string_to_array(name,'/'))=2 AND (right(name,4)='.jpg' OR right(name,4)='.png'));
COMMIT;
