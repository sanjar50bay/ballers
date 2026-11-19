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
  const generation = useRef(0);
  const src =
    choice.kind === "custom"
      ? choice.preview
      : choice.kind === "none"
        ? null
        : initialUrl;
  const preview = choice.kind === "custom" ? choice.preview : null;
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
          {t(src ? "Сменить фото или аватар" : "Добавить фото или аватар")}
        </button>
        <input
          ref={input}
          hidden
          id={id}
          className="photo-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={t("Выбрать фото или аватар")}
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
              if (seq === generation.current) onChange(prepared);
              else URL.revokeObjectURL(prepared.preview);
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
        <div className="photo-picker-secondary">
          <button
            type="button"
            disabled={disabled || preparing || (!src && choice.kind === "none")}
            onClick={() => {
              setError("");
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
                onChange({ kind: "keep" });
              }}
            >
              {t("Отменить выбор")}
            </button>
          )}
        </div>
        <small>{t("Необязательно · JPG, PNG, WebP до 8 МБ")}</small>
        {preparing && <p role="status">{t("Готовим фото…")}</p>}
        {error && (
          <p role="alert" className="photo-picker-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
