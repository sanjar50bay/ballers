-- RECONSTRUCTED PUBLIC SCHEMA FOR AN EMPTY DISPOSABLE SUPABASE PROJECT ONLY.

-- Not a backup: excludes live data, Auth settings, Storage, grants and unknown objects.

-- DO NOT RUN IN YOUR EXISTING PROJECT. Supabase built-in auth.users must already exist.

BEGIN;

CREATE TYPE public."attendance_status" AS ENUM ('INVITED','GOING','MAYBE','DECLINED','WAITLIST','CONFIRMED','PLAYED','LATE_CANCEL','NO_SHOW');

CREATE TYPE public."community_member_status" AS ENUM ('REGULAR','GUEST','PENDING','INACTIVE');

CREATE TYPE public."community_role" AS ENUM ('OWNER','MANAGER','MEMBER');

CREATE TYPE public."dominant_foot" AS ENUM ('RIGHT','LEFT','BOTH');

CREATE TYPE public."invite_type" AS ENUM ('COMMUNITY','GAME_GUEST');

CREATE TYPE public."participant_type" AS ENUM ('MEMBER','GUEST');

CREATE TYPE public."player_position" AS ENUM ('GK','DEF','MID','ATT');

CREATE TYPE public."team_mode" AS ENUM ('RANDOM','FIXED','MIXED');

CREATE TABLE public."communities" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "name" "text" NOT NULL,
 "city" "text",
 "team_mode" "team_mode" NOT NULL DEFAULT 'RANDOM'::team_mode,
 "default_format" "int4" NOT NULL DEFAULT 5,
 "default_team_count" "int4" NOT NULL DEFAULT 3,
 "default_capacity" "int4",
 "created_by" "uuid" NOT NULL,
 "created_at" "timestamptz" NOT NULL DEFAULT now()
);

CREATE TABLE public."community_members" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "community_id" "uuid" NOT NULL,
 "player_id" "uuid" NOT NULL,
 "role" "community_role" NOT NULL DEFAULT 'MEMBER'::community_role,
 "member_status" "community_member_status" NOT NULL DEFAULT 'REGULAR'::community_member_status,
 "joined_at" "timestamptz" NOT NULL DEFAULT now()
);

CREATE TABLE public."game_day_team_players" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "game_day_id" "uuid" NOT NULL,
 "team_id" "uuid" NOT NULL,
 "player_id" "uuid" NOT NULL,
 "assigned_at" "timestamptz" NOT NULL DEFAULT now(),
 "is_core" "bool" NOT NULL DEFAULT false
);

CREATE TABLE public."game_day_teams" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "game_day_id" "uuid" NOT NULL,
 "name" "text" NOT NULL,
 "color_key" "text" NOT NULL DEFAULT 'BLUE'::text,
 "sort_order" "int4" NOT NULL DEFAULT 1,
 "created_at" "timestamptz" NOT NULL DEFAULT now(),
 "team_mode" "text" NOT NULL DEFAULT 'RANDOM'::text
);

CREATE TABLE public."game_days" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "community_id" "uuid" NOT NULL,
 "sequence_number" "int4" NOT NULL,
 "title" "text" NOT NULL,
 "game_date" "date" NOT NULL,
 "start_time" "time",
 "venue" "text",
 "format" "int4" NOT NULL,
 "team_count" "int4" NOT NULL,
 "capacity" "int4",
 "status" "text" NOT NULL DEFAULT 'OPEN'::text,
 "created_by" "uuid" NOT NULL,
 "created_at" "timestamptz" NOT NULL DEFAULT now()
);

CREATE TABLE public."game_participants" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "game_day_id" "uuid" NOT NULL,
 "player_id" "uuid" NOT NULL,
 "attendance_status" "attendance_status" NOT NULL DEFAULT 'INVITED'::attendance_status,
 "participant_type" "participant_type" NOT NULL DEFAULT 'MEMBER'::participant_type,
 "joined_at" "timestamptz" NOT NULL DEFAULT now(),
 "confirmed_at" "timestamptz"
);

CREATE TABLE public."invites" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "token" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "invite_type" "invite_type" NOT NULL,
 "community_id" "uuid",
 "game_day_id" "uuid",
 "created_by" "uuid" NOT NULL,
 "expires_at" "timestamptz",
 "max_uses" "int4",
 "uses_count" "int4" NOT NULL DEFAULT 0,
 "is_active" "bool" NOT NULL DEFAULT true,
 "created_at" "timestamptz" NOT NULL DEFAULT now()
);

CREATE TABLE public."player_profiles" (
 "id" "uuid" NOT NULL DEFAULT gen_random_uuid(),
 "user_id" "uuid",
 "baller_id" "int8" NOT NULL,
 "first_name" "text" NOT NULL,
 "last_name" "text",
 "city" "text",
 "birth_year" "int4",
 "primary_position" "player_position" NOT NULL,
 "secondary_position" "player_position",
 "dominant_foot" "dominant_foot",
 "avatar_url" "text",
 "created_at" "timestamptz" NOT NULL DEFAULT now(),
 "updated_at" "timestamptz" NOT NULL DEFAULT now(),
 "identity_first_name" "text",
 "identity_last_name" "text",
 "display_name" "text",
 "preferred_language" "text" DEFAULT 'ru'::text
);

ALTER TABLE public."communities" ADD CONSTRAINT "communities_default_format_check" CHECK (((default_format >= 5) AND (default_format <= 11)));

ALTER TABLE public."communities" ADD CONSTRAINT "communities_default_team_count_check" CHECK ((default_team_count >= 2));

ALTER TABLE public."communities" ADD CONSTRAINT "communities_pkey" PRIMARY KEY (id);

ALTER TABLE public."community_members" ADD CONSTRAINT "community_members_community_id_player_id_key" UNIQUE (community_id, player_id);

ALTER TABLE public."community_members" ADD CONSTRAINT "community_members_pkey" PRIMARY KEY (id);

ALTER TABLE public."game_day_team_players" ADD CONSTRAINT "game_day_team_players_game_day_id_player_id_key" UNIQUE (game_day_id, player_id);

ALTER TABLE public."game_day_team_players" ADD CONSTRAINT "game_day_team_players_pkey" PRIMARY KEY (id);

ALTER TABLE public."game_day_teams" ADD CONSTRAINT "game_day_teams_game_day_id_name_key" UNIQUE (game_day_id, name);

ALTER TABLE public."game_day_teams" ADD CONSTRAINT "game_day_teams_game_day_id_sort_order_key" UNIQUE (game_day_id, sort_order);

ALTER TABLE public."game_day_teams" ADD CONSTRAINT "game_day_teams_pkey" PRIMARY KEY (id);

ALTER TABLE public."game_day_teams" ADD CONSTRAINT "game_day_teams_team_mode_check" CHECK ((team_mode = ANY (ARRAY['RANDOM'::text, 'FIXED'::text, 'CORE_PLUS_FILL'::text])));

ALTER TABLE public."game_days" ADD CONSTRAINT "game_days_format_check" CHECK (((format >= 5) AND (format <= 11)));

ALTER TABLE public."game_days" ADD CONSTRAINT "game_days_pkey" PRIMARY KEY (id);

ALTER TABLE public."game_days" ADD CONSTRAINT "game_days_team_count_check" CHECK ((team_count >= 2));

ALTER TABLE public."game_participants" ADD CONSTRAINT "game_participants_game_day_id_player_id_key" UNIQUE (game_day_id, player_id);

ALTER TABLE public."game_participants" ADD CONSTRAINT "game_participants_pkey" PRIMARY KEY (id);

ALTER TABLE public."invites" ADD CONSTRAINT "invites_pkey" PRIMARY KEY (id);

ALTER TABLE public."invites" ADD CONSTRAINT "invites_token_key" UNIQUE (token);

ALTER TABLE public."player_profiles" ADD CONSTRAINT "player_profiles_baller_id_key" UNIQUE (baller_id);

ALTER TABLE public."player_profiles" ADD CONSTRAINT "player_profiles_pkey" PRIMARY KEY (id);

ALTER TABLE public."player_profiles" ADD CONSTRAINT "player_profiles_user_id_key" UNIQUE (user_id);

ALTER TABLE public."communities" ADD CONSTRAINT "communities_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public."community_members" ADD CONSTRAINT "community_members_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public."community_members" ADD CONSTRAINT "community_members_player_id_fkey" FOREIGN KEY (player_id) REFERENCES player_profiles(id) ON DELETE CASCADE;

ALTER TABLE public."game_day_team_players" ADD CONSTRAINT "game_day_team_players_game_day_id_fkey" FOREIGN KEY (game_day_id) REFERENCES game_days(id) ON DELETE CASCADE;

ALTER TABLE public."game_day_team_players" ADD CONSTRAINT "game_day_team_players_player_id_fkey" FOREIGN KEY (player_id) REFERENCES player_profiles(id) ON DELETE CASCADE;

ALTER TABLE public."game_day_team_players" ADD CONSTRAINT "game_day_team_players_team_id_fkey" FOREIGN KEY (team_id) REFERENCES game_day_teams(id) ON DELETE CASCADE;

ALTER TABLE public."game_day_teams" ADD CONSTRAINT "game_day_teams_game_day_id_fkey" FOREIGN KEY (game_day_id) REFERENCES game_days(id) ON DELETE CASCADE;

ALTER TABLE public."game_days" ADD CONSTRAINT "game_days_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public."game_days" ADD CONSTRAINT "game_days_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public."game_participants" ADD CONSTRAINT "game_participants_game_day_id_fkey" FOREIGN KEY (game_day_id) REFERENCES game_days(id) ON DELETE CASCADE;

ALTER TABLE public."game_participants" ADD CONSTRAINT "game_participants_player_id_fkey" FOREIGN KEY (player_id) REFERENCES player_profiles(id) ON DELETE CASCADE;

ALTER TABLE public."invites" ADD CONSTRAINT "invites_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public."invites" ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public."invites" ADD CONSTRAINT "invites_game_day_id_fkey" FOREIGN KEY (game_day_id) REFERENCES game_days(id) ON DELETE CASCADE;

ALTER TABLE public."player_profiles" ADD CONSTRAINT "player_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.add_player_to_community(target_community_id uuid, target_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
    from public.community_members cm
    join public.player_profiles pp
      on pp.id = cm.player_id
    where cm.community_id = target_community_id
      and pp.user_id = auth.uid()
      and cm.role in ('OWNER', 'MANAGER')
  ) then
    raise exception 'Only community owners and managers can add players';
  end if;

  insert into public.community_members (
    community_id,
    player_id,
    role,
    member_status
  )
  values (
    target_community_id,
    target_player_id,
    'MEMBER',
    'REGULAR'
  )
  on conflict (community_id, player_id)
  do update set
    member_status = 'REGULAR';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_invite_by_token(invite_token uuid)
 RETURNS TABLE(invite_id uuid, token uuid, invite_type invite_type, community_id uuid, community_name text, game_day_id uuid, game_title text, game_date date, start_time time without time zone, venue text, format integer, capacity integer, is_active boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    i.id,
    i.token,
    i.invite_type,
    i.community_id,
    c.name,
    i.game_day_id,
    gd.title,
    gd.game_date,
    gd.start_time,
    gd.venue,
    gd.format,
    gd.capacity,
    i.is_active
  from public.invites i
  left join public.communities c
    on c.id = i.community_id
  left join public.game_days gd
    on gd.id = i.game_day_id
  where i.token = invite_token
    and i.is_active = true
    and (
      i.expires_at is null
      or i.expires_at > now()
    )
  limit 1;
$function$
;

ALTER TABLE public."communities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_members" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."game_day_team_players" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."game_day_teams" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."game_days" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."game_participants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."invites" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."player_profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Community managers can remove game day team players" ON public."game_day_team_players" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_day_team_players.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Community managers can delete game day teams" ON public."game_day_teams" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_day_teams.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Users can create communities" ON public."communities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = created_by));

CREATE POLICY "Users can join communities" ON public."community_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((player_id IN ( SELECT player_profiles.id
   FROM player_profiles
  WHERE (player_profiles.user_id = auth.uid()))));

CREATE POLICY "Community managers can assign game day team players" ON public."game_day_team_players" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_day_team_players.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Community managers can create game day teams" ON public."game_day_teams" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_day_teams.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Users can create game days" ON public."game_days" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = created_by));

CREATE POLICY "Community managers can invite members" ON public."game_participants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM (((game_days gd
     JOIN community_members manager ON ((manager.community_id = gd.community_id)))
     JOIN player_profiles manager_profile ON ((manager_profile.id = manager.player_id)))
     JOIN community_members invited_member ON ((invited_member.community_id = gd.community_id)))
  WHERE ((gd.id = game_participants.game_day_id) AND (manager_profile.user_id = auth.uid()) AND (manager.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role])) AND (invited_member.player_id = game_participants.player_id)))));

CREATE POLICY "Players can join game days" ON public."game_participants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((player_id IN ( SELECT player_profiles.id
   FROM player_profiles
  WHERE (player_profiles.user_id = auth.uid()))));

CREATE POLICY "Authenticated users can create invites" ON public."invites" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = created_by));

CREATE POLICY "Users can create their own player profile" ON public."player_profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Invite creators can read invites" ON public."invites" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = created_by));

CREATE POLICY "Authenticated users can read communities" ON public."communities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Members can read community memberships" ON public."community_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Authenticated users can read game day team players" ON public."game_day_team_players" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Authenticated users can read game day teams" ON public."game_day_teams" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Authenticated users can read game days" ON public."game_days" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Authenticated users can read game participants" ON public."game_participants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Users can read player profiles" ON public."player_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Users can update their own player profile" ON public."player_profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Community managers can update game day team players" ON public."game_day_team_players" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_day_team_players.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Community managers can update game day teams" ON public."game_day_teams" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_day_teams.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Community managers can update participants" ON public."game_participants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_participants.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ((game_days gd
     JOIN community_members cm ON ((cm.community_id = gd.community_id)))
     JOIN player_profiles pp ON ((pp.id = cm.player_id)))
  WHERE ((gd.id = game_participants.game_day_id) AND (pp.user_id = auth.uid()) AND (cm.role = ANY (ARRAY['OWNER'::community_role, 'MANAGER'::community_role]))))));

CREATE POLICY "Players can update their attendance" ON public."game_participants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((player_id IN ( SELECT player_profiles.id
   FROM player_profiles
  WHERE (player_profiles.user_id = auth.uid())))) WITH CHECK ((player_id IN ( SELECT player_profiles.id
   FROM player_profiles
  WHERE (player_profiles.user_id = auth.uid()))));

-- Assumed grants for this disposable test schema, not recovered production grants.

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

COMMIT;