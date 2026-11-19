"use client";
import { useEffect, useId, useRef, useState } from "react";
import { t, positionLabel } from "@/lib/i18n";
import {
  prepareProfilePhoto,
  photoError,
  type PhotoChoice,
} from "@/lib/profile-photo";
import { useLocale } from "./Language";
import Avatar from "./Avatar";
import PlayerCardFrame from "./PlayerCardFrame";
export default function ProfilePhotoPicker({
  choice,
  onChange,
  initialUrl,
  name,
  position,
  disabled = false,
  onPreparing,
}: {
  choice: PhotoChoice;
  onChange: (choice: PhotoChoice) => void;
  initialUrl: string | null;
  name: string;
  position: string;
  disabled?: boolean;
  onPreparing: (busy: boolean) => void;
}) {
  useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [cutout, setCutout] = useState(false);
  const [cutting, setCutting] = useState(false);
  const original = useRef<Blob | null>(null);
  const generation = useRef(0);
  const src =
    choice.kind === "custom"
      ? choice.preview
      : choice.kind === "none"
        ? null
        : initialUrl;
  const preview = choice.kind === "custom" ? choice.preview : null;
  async function removeBackground() {
    if (!src || preparing || disabled) return;
    const seq = ++generation.current;
    setPreparing(true);
    setCutting(true);
    onPreparing(true);
    setError("");
    let prepared: Awaited<ReturnType<typeof prepareProfilePhoto>> | undefined;
    try {
      let source: Blob;
      if (choice.kind === "custom") source = choice.file;
      else {
        const response = await fetch(src, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("PHOTO_CUTOUT");
        const blob = await response.blob();
        const resized = await prepareProfilePhoto(
          new File([blob], "profile-photo", { type: blob.type }),
        );
        prepared = resized;
        source = resized.file;
      }
      const { removePortraitBackground } =
        await import("@/lib/portrait-cutout");
      const result = await removePortraitBackground(source);
      if (seq === generation.current) {
        original.current = source;
        setCutout(true);
        onChange(result);
      } else URL.revokeObjectURL(result.preview);
    } catch (err) {
      if (seq === generation.current)
        setError(
          photoError(err) ||
            t(
              "Не удалось убрать фон на этом устройстве. Попробуй ещё раз или оставь обычное фото.",
            ),
        );
    } finally {
      if (prepared) URL.revokeObjectURL(prepared.preview);
      if (seq === generation.current) {
        setPreparing(false);
        setCutting(false);
        onPreparing(false);
      }
    }
  }
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  return (
    <section
      className="profile-photo-picker"
      aria-label={t("Фото для карточки")}
    >
      <div
        className="photo-card-preview"
        aria-label={t("Предпросмотр фото в карточке")}
      >
        <PlayerCardFrame />
        <span className="photo-card-brand">BALLERS.</span>
        <Avatar src={src} name={name.trim() || t("Твоё имя")} large />
        <strong>{name.trim() || t("Твоё имя")}</strong>
        <small>{positionLabel(position)}</small>
      </div>
      <div className="photo-picker-actions">
        <h2>{t("Твоё фото — твоя карточка")}</h2>
        <p>{t("Это фото появится в твоей карточке BALLERS и в профиле.")}</p>
        <button
          type="button"
          className="neon-button photo-upload-label"
          disabled={disabled || preparing}
          onClick={() => input.current?.click()}
        >
          {t(src ? "Сменить фото профиля" : "Добавить фото профиля")}
        </button>
        <input
          ref={input}
          hidden
          id={id}
          className="photo-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={t("Выбрать фото профиля")}
          disabled={disabled || preparing}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            const seq = ++generation.current;
            setError("");
            setPreparing(true);
            onPreparing(true);
            try {
              const prepared = await prepareProfilePhoto(file);
              if (seq === generation.current) {
                setCutout(false);
                original.current = null;
                onChange(prepared);
              } else URL.revokeObjectURL(prepared.preview);
            } catch (err) {
              if (seq === generation.current)
                setError(
                  photoError(err) ||
                    t("Не удалось прочитать фото. Попробуй другой файл."),
                );
            } finally {
              if (seq === generation.current) {
                setPreparing(false);
                onPreparing(false);
              }
            }
          }}
        />
        {src && (
          <button
            type="button"
            className="photo-cutout-button"
            disabled={disabled || preparing}
            onClick={() => {
              if (cutout && original.current) {
                const file = original.current;
                onChange({
                  kind: "custom",
                  file,
                  preview: URL.createObjectURL(file),
                  operation: crypto.randomUUID(),
                });
                setCutout(false);
                original.current = null;
              } else void removeBackground();
            }}
          >
            {t(cutout ? "Вернуть фон" : "Убрать фон")}
          </button>
        )}
        {src && (
          <small>
            {t(
              "Фон убирается на твоём устройстве. Результат можно отменить до сохранения.",
            )}
          </small>
        )}
        <div className="photo-picker-secondary">
          <button
            type="button"
            disabled={disabled || preparing || (!src && choice.kind === "none")}
            onClick={() => {
              setError("");
              setCutout(false);
              original.current = null;
              onChange({ kind: "none" });
            }}
          >
            {t("Без фото")}
          </button>
          {choice.kind !== "keep" && (
            <button
              type="button"
              disabled={disabled || preparing}
              onClick={() => {
                setError("");
                setCutout(false);
                original.current = null;
                onChange({ kind: "keep" });
              }}
            >
              {t("Отменить выбор")}
            </button>
          )}
        </div>
        <small>{t("Необязательно · JPG, PNG, WebP до 8 МБ")}</small>
        {preparing && (
          <p role="status">
            {t(
              cutting
                ? "Убираем фон… Первый запуск может занять несколько секунд."
                : "Готовим фото…",
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="photo-picker-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
