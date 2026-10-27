import { supabase } from "./supabase";
import { t, getLocale } from "./i18n";
export type SearchStatus = "LOOKING" | "HAVE_TEAM" | "PLAY";
export const cities = ["Astana", "Almaty", "Karaganda"] as const;
export function cityKey(s: string | null | undefined) {
  const v = (s || "").trim();
  return (
    (
      {
        астана: "Astana",
        astana: "Astana",
        "нур-султан": "Astana",
        "nur-sultan": "Astana",
        алматы: "Almaty",
        almaty: "Almaty",
        караганда: "Karaganda",
        қарағанды: "Karaganda",
        karaganda: "Karaganda",
      } as Record<string, string>
    )[v.toLowerCase()] || v
  );
}
export function cityLabel(s: string | null | undefined) {
  return t(
    (
      { Astana: "Астана", Almaty: "Алматы", Karaganda: "Караганда" } as Record<
        string,
        string
      >
    )[cityKey(s)] ||
      s ||
      "Город не указан",
  );
}
export function searchLabel(s: string) {
  return t(
    (
      {
        LOOKING: "Ищу команду",
        HAVE_TEAM: "Есть команда",
        PLAY: "Хочу играть",
      } as Record<string, string>
    )[s] || "Хочу играть",
  );
}
export type Person = {
  id: string;
  baller_id: number;
  first_name?: string;
  last_name?: string | null;
  display_name?: string | null;
  name?: string;
  city?: string | null;
  avatar_url?: string | null;
  primary_position?: string;
  search_status?: string;
  available?: boolean | null;
};
export function personName(p: Person) {
  return (
    p.name ||
    p.display_name ||
    [p.first_name, p.last_name].filter(Boolean).join(" ")
  );
}
export type TeamItem = {
  id: string;
  name: string;
  city: string;
  about?: string;
  members?: number;
  captain?: boolean;
};
export type InboxItem = {
  kind: "INVITE" | "REQUEST" | "LINK";
  team_id: string;
  name: string;
  player_id?: string;
  player_name?: string;
  community_id?: string;
  community_name?: string;
};
export type NetworkData = {
  preferences: { search_status: SearchStatus; available: boolean } | null;
  teams: TeamItem[];
  inbox: InboxItem[];
};
export function networkError(e: unknown) {
  const msg =
    typeof e === "object" && e !== null && "message" in e
      ? String(e.message)
      : String(e);
  if (/PGRST202|could not find|does not exist|schema cache/i.test(msg))
    return t(
      "Проверь, что установлены миграции 005 и 006, затем обнови страницу. Старые профили и игры сохранены.",
    );
  if (/BOARD_CHANGED/.test(msg))
    return t(
      "Расстановка уже изменена. Загрузи сохранённую версию и повтори изменения.",
    );
  if (/INVALID_LAYOUT/.test(msg))
    return t(
      "Выбери до пяти подтверждённых игроков и размести их внутри поля.",
    );
  if (/GAME_NOT_OPEN/.test(msg))
    return t("Игровой день закрыт. Обнови страницу.");
  if (/INVITATION_REQUIRED/.test(msg))
    return t("Для закрытого игрового дня нужно приглашение организатора.");
  if (/23505|duplicate key/i.test(msg))
    return t(
      "Команда с таким названием уже есть в этом городе. Выбери другое название.",
    );
  if (/AUTH_REQUIRED/.test(msg))
    return t("Сначала создай или открой свой Baller ID.");
  if (/CAPTAIN_REQUIRED|MANAGER_REQUIRED/.test(msg))
    return t("Это действие доступно только ответственному.");
  if (/NOT_FOUND/.test(msg))
    return t("Запись не найдена или больше недоступна.");
  return t("Не удалось выполнить действие. Проверь соединение и повтори.");
}
export async function networkRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const { data, error } = await supabase
    .rpc(name, args)
    .abortSignal(signal || AbortSignal.timeout(15000));
  if (error) throw error;
  return data as T;
}
export function changed() {
  window.dispatchEvent(new Event("ballers:data-changed"));
  window.dispatchEvent(new Event("ballers:network-changed"));
}
export function rememberDestination(path: string) {
  if (
    /^\/teams\/[a-f0-9-]{36}(?:\?join=1)?$/.test(path) ||
    path === "/discover"
  )
    try {
      localStorage.setItem("ballers:network-return", path);
    } catch {}
}

export function networkCount(n: number, kind: "members" | "teams" = "members") {
  if (getLocale() === "kk")
    return `${n} ${kind === "teams" ? "команда" : "қатысушы"}`;
  const forms =
    kind === "teams"
      ? ["команда", "команды", "команд"]
      : ["участник", "участника", "участников"];
  const a = n % 100,
    b = n % 10;
  return `${n} ${forms[a >= 11 && a <= 14 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2]}`;
}
