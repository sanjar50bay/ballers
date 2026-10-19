import type { SupabaseClient, User } from "@supabase/supabase-js";

export type RegistrationInput = {
  first_name: string;
  last_name?: string | null;
  city: string;
  birth_year?: number | null;
  primary_position: string;
  secondary_position?: string | null;
  dominant_foot: string;
};
export type RegisteredProfile = { id: string; user_id: string };
const REQUEST_TIMEOUT = 15000;

// A timeout here does not revoke the session or retry an uncertain write.
export async function registrationUser(
  client: SupabaseClient,
): Promise<User | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.auth.getSession(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("SESSION_TIMEOUT")),
          REQUEST_TIMEOUT,
        );
      }),
    ]);
    if (result.error) throw result.error;
    return result.data.session?.user ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export async function ownRegistrationProfile(
  client: SupabaseClient,
  userId: string,
) {
  const { data, error } = await client
    .from("player_profiles")
    .select("id,user_id")
    .eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT))
    .maybeSingle();
  if (error) throw error;
  if (data && data.user_id !== userId)
    throw new Error("PROFILE_OWNER_MISMATCH");
  return data as RegisteredProfile | null;
}

export function registrationValidation(input: RegistrationInput): string {
  if (!input.first_name.trim()) return "Укажи имя.";
  if (!input.city.trim()) return "Укажи город.";
  if (
    input.birth_year !== null &&
    input.birth_year !== undefined &&
    (!Number.isInteger(input.birth_year) ||
      input.birth_year < 1900 ||
      input.birth_year > new Date().getFullYear())
  )
    return "Проверь год рождения.";
  if (
    !["GK", "DEF", "MID", "ATT"].includes(input.primary_position) ||
    (input.secondary_position &&
      !["GK", "DEF", "MID", "ATT"].includes(input.secondary_position))
  )
    return "Выбери позицию из списка.";
  if (input.secondary_position === input.primary_position)
    return "Дополнительная позиция должна отличаться от основной.";
  if (!["LEFT", "RIGHT", "BOTH"].includes(input.dominant_foot))
    return "Выбери ведущую ногу.";
  return "";
}

export async function ensureRegistrationProfile(
  client: SupabaseClient,
  user: User,
  input: RegistrationInput,
) {
  // Retry begins with a read. Existing profiles are never overwritten by onboarding.
  const existing = await ownRegistrationProfile(client, user.id);
  if (existing) return existing;
  const invalid = registrationValidation(input);
  if (invalid) throw new Error(invalid);
  const { data, error } = await client
    .from("player_profiles")
    .insert({
      user_id: user.id,
      first_name: input.first_name.trim(),
      last_name: input.last_name?.trim() || null,
      city: input.city.trim(),
      birth_year: input.birth_year ?? null,
      primary_position: input.primary_position,
      secondary_position: input.secondary_position || null,
      dominant_foot: input.dominant_foot,
      avatar_url:
        user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    })
    .select("id,user_id")
    .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT))
    .single();
  if (!error && data?.user_id === user.id) return data as RegisteredProfile;
  // Includes a duplicate from another tab, or a committed INSERT whose response was lost.
  // Never treat an arbitrary 23505 as success: verify this user's own persisted row.
  const recovered = await ownRegistrationProfile(client, user.id);
  if (recovered) return recovered;
  if (error) throw error;
  throw new Error("PROFILE_SAVE_UNCONFIRMED");
}

export function registrationError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505")
    return "Не удалось завершить создание профиля. Нажми ещё раз: сначала проверим, сохранился ли он.";
  if (code === "42501" || code === "PGRST301")
    return "Нет доступа к сохранению профиля. Повтори вход через Google. Данные формы пока оставлены здесь.";
  return "Не удалось проверить или сохранить профиль. Проверь соединение и попробуй ещё раз. Если профиль уже создан, откроем его без повторной регистрации.";
}
