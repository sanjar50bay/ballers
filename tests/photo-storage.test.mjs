import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(),script=fs.readFileSync(new URL('../supabase/setup_profile_photos.sql',import.meta.url),'utf8');
const u1='00000000-0000-4000-8000-000000000001',u2='00000000-0000-4000-8000-000000000002';
let passed=0;const pass=x=>{passed++;console.log('PASS '+x);};
async function actor(uid,role='authenticated'){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('SET ROLE '+role);}
try{
  await db.exec("CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;CREATE TABLE ballers_migration_history(version text PRIMARY KEY);INSERT INTO ballers_migration_history VALUES('20261118_013');CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(bucket_id text,name text,owner_id text,metadata jsonb DEFAULT '{}',PRIMARY KEY(bucket_id,name));ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage,auth TO authenticated,anon;GRANT ALL ON storage.objects TO authenticated,anon;");
  await db.exec(script);
  const bucket=(await db.query("SELECT * FROM storage.buckets WHERE id='ballers-avatars'")).rows[0];
  assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),1048576);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg']);
  pass('dedicated public-image bucket restricts object size and MIME configuration');
  await actor(u1);await db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('ballers-avatars',$1,$2)",[u1+'/one.jpg',u1]);
  await db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('ballers-avatars',$1,$2) ON CONFLICT(bucket_id,name) DO UPDATE SET metadata='{"+'"retry":true'+"}'",[u1+'/one.jpg',u1]);
  assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects')).rows[0].n,1);
  pass('owner can upload, read and upsert the same own-folder image');
  await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('ballers-avatars',$1,$2)",[u2+'/other.jpg',u1]),e=>e.code==='42501');
  await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('ballers-avatars',$1,$2)",[u1+'/spoof.jpg',u2]),e=>e.code==='42501');
  await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('ballers-avatars',$1,$2)",[u1+'/image.svg',u1]),e=>e.code==='42501');
  pass('cross-folder uploads, spoofed owner and non-JPEG paths are rejected');
  await actor(u2);assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects')).rows[0].n,0);
  assert.equal((await db.query("UPDATE storage.objects SET metadata='{}' RETURNING name")).rows.length,0);
  assert.equal((await db.query('DELETE FROM storage.objects RETURNING name')).rows.length,0);
  pass('another user cannot list, overwrite or delete the first user metadata');
  await actor(u1);await assert.rejects(db.query('UPDATE storage.objects SET name=$1',[u2+'/moved.jpg']),e=>e.code==='42501');
  await actor('','anon');assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
  await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('ballers-avatars',$1,$2)",[u1+'/anon.jpg',u1]),e=>e.code==='42501');
  pass('moves across users and anonymous writes are rejected; metadata listing is owner scoped');
  await db.exec('RESET ROLE');await db.exec(script);assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects')).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='storage' AND tablename='objects'")).rows[0].n,4);
  await actor(u1);assert.equal((await db.query('DELETE FROM storage.objects RETURNING name')).rows.length,1);
  pass('setup repeats without deleting objects or duplicating policies; owner can remove own image');
  console.log(`RESULT: ${passed} photo-storage configuration/policy checks passed using isolated SQL metadata, not the live Storage service.`);
}finally{await db.close();}
