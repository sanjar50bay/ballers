import { uiError } from "@/lib/i18n";
import { t as tx } from "@/lib/i18n";
import { supabase } from "./supabase";

export type TeamAction =
  "BUILD" | "RESET" | "ASSIGN" | "CORE" | "UPDATE_TEAM" | "RANDOMIZE";
export type TeamActionResult = { roster_version: number; unassigned: number };

export async function teamAction(
  gameId: string,
  version: number,
  action: TeamAction,
  payload: Record<string, unknown> = {},
) {
  const { data, error } = await supabase.rpc("ballers_team_action", {
    p_game_id: gameId,
    p_expected_version: version,
    p_action: action,
    p_payload: payload,
  });
  return { data: data as TeamActionResult | null, error };
}

export async function setAttendance(
  gameId: string,
  playerId: string,
  status: "GOING" | "MAYBE" | "DECLINED" | "INVITED",
) {
  return supabase.rpc("ballers_set_attendance", {
    p_game_id: gameId,
    p_player_id: playerId,
    p_status: status,
  });
}

export function preMatchError(error: { message: string; code?: string }) {
  const messages: Record<string, string> = {
    TEAMS_ALREADY_EXIST: tx(
      "Teams already exist. Refresh the page instead of creating them again.",
    ),
    ROSTER_CHANGED_REFRESH: tx(
      "The roster changed on another device. It has been refreshed; please try again.",
    ),
    MANAGER_REQUIRED: tx(
      "Only the community owner or manager can perform this action.",
    ),
    ATTENDANCE_FORBIDDEN: tx("You cannot change another player's attendance."),
    PLAYER_PROTECTED_CHANGE_MODE_OR_CORE_FIRST: tx(
      "This player is protected. Change the team mode or remove the core flag first.",
    ),
    TEAM_ROSTER_FULL: tx(
      "This team is full for the current roster. No assignments were changed.",
    ),
    PLAYER_NOT_GOING: tx("Only Going players can be assigned to teams."),
    GAME_FULL_WAITLIST_NOT_YET_IMPLEMENTED: tx(
      "The game is full. The waiting-list feature is planned for the next stage; contact the organizer.",
    ),
    INVITE_UNAVAILABLE: tx(
      "This invitation has expired, is inactive, or has reached its usage limit.",
    ),
    INVITATION_REQUIRED: tx(
      "Join using a valid invitation or ask the organizer.",
    ),
    ALL_TEAMS_FIXED: tx("All teams are Fixed. No assignments were changed."),
    NO_TEAMS_OR_GOING_PLAYERS: tx(
      "Create teams and confirm Going players first.",
    ),
    GAME_NOT_OPEN: tx("This game is no longer open for roster changes."),
    STAGE1_SUPPORTS_2_TO_8_TEAMS: tx(
      "This stage supports 2–8 teams, each with a unique color.",
    ),
  };
  for (const [code, text] of Object.entries(messages))
    if (error.message.includes(code)) return text;
  if (error.code === "PGRST202" || error.message.includes("schema cache"))
    return tx(
      "The stage-1 database migration has not been applied. Do not use this version with the old schema.",
    );
  if (error.code === "23505")
    return tx("This name or color is already in use. No changes were saved.");
  return uiError(error.message);
}
