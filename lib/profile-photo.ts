import type { SupabaseClient } from "@supabase/supabase-js";
import { t } from "./i18n";
export const PHOTO_BUCKET = "ballers-avatars";
export const MAX_PHOTO_SOURCE = 8 * 1024 * 1024;
export type PhotoChoice =
  | { kind: "keep" }
  | { kind: "none" }
  | { kind: "custom"; file: Blob; preview: string; operation: string };
export async function prepareProfilePhoto(
  file: File,
): Promise<PhotoChoice & { kind: "custom" }> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("PHOTO_TYPE");
  if (!file.size || file.size > MAX_PHOTO_SOURCE) throw new Error("PHOTO_SIZE");
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("PHOTO_DECODE");
  }
  try {
    if (!image.width || !image.height || image.width * image.height > 40000000)
      throw new Error("PHOTO_DECODE");
    const scale = Math.min(1, 768 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PHOTO_DECODE");
    ctx.fillStyle = "#101827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("PHOTO_DECODE")),
        "image/jpeg",
        0.85,
      ),
    );
    if (blob.size > 1024 * 1024) throw new Error("PHOTO_SIZE");
    return {
      kind: "custom",
      file: blob,
      preview: URL.createObjectURL(blob),
      operation: crypto.randomUUID(),
    };
  } finally {
    image.close();
  }
}
export async function resolveProfilePhoto(
  client: SupabaseClient,
  userId: string,
  choice: PhotoChoice,
  current: string | null,
) {
  if (choice.kind === "keep") return current;
  if (choice.kind === "none") return null;
  const path = `${userId}/${choice.operation}.jpg`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.storage
        .from(PHOTO_BUCKET)
        .upload(path, choice.file, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: "3600",
        }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PHOTO_UPLOAD")), 20000);
      }),
    ]);
    if (result.error) throw new Error("PHOTO_UPLOAD");
    return client.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  } finally {
    clearTimeout(timer);
  }
}
export function ownPhotoPath(
  url: string | null,
  userId: string,
  serviceUrl: string,
) {
  if (!url) return null;
  try {
    const address = new URL(url),
      service = new URL(serviceUrl);
    const prefix = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
    if (
      address.origin !== service.origin ||
      !address.pathname.startsWith(prefix)
    )
      return null;
    const path = decodeURIComponent(address.pathname.slice(prefix.length));
    const parts = path.split("/");
    return parts.length === 2 &&
      parts[0] === userId &&
      /^[0-9a-f-]{36}\.jpg$/i.test(parts[1])
      ? path
      : null;
  } catch {
    return null;
  }
}
export async function removePreviousPhoto(
  client: SupabaseClient,
  userId: string,
  oldUrl: string | null,
  newUrl: string | null,
) {
  if (oldUrl === newUrl) return;
  const path = ownPhotoPath(
    oldUrl,
    userId,
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
  );
  if (path) {
    try {
      await client.storage.from(PHOTO_BUCKET).remove([path]);
    } catch {
      /* Profile is already confirmed; cleanup must not undo it. */
    }
  }
}
export function photoError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    PHOTO_TYPE: "Выбери фото в формате JPG, PNG или WebP.",
    PHOTO_SIZE: "Выбери фото размером до 8 МБ.",
    PHOTO_DECODE: "Не удалось прочитать фото. Попробуй другой файл.",
    PHOTO_UPLOAD:
      "Фото не загрузилось. Повтори сохранение или выбери «Без фото».",
    PHOTO_ACCOUNT:
      "Аккаунт изменился. Открой профиль заново перед сохранением.",
  };
  return messages[message] ? t(messages[message]) : null;
}
