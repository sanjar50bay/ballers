"use client";
import { useLocale } from "@/app/components/Language";

/* eslint-disable @next/next/no-img-element -- Native remote avatars need an error fallback. */
import { useState } from "react";
export default function Avatar({
  src,
  name,
  large = false,
}: {
  src?: string | null;
  name: string;
  large?: boolean;
}) {
  useLocale();

  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span
      className={`ballers-avatar ${large ? "ballers-avatar-large" : ""}`}
      aria-label={name}
    >
      {src && src !== failedSrc ? (
        <img src={src} alt={name} onError={() => setFailedSrc(src)} />
      ) : (
        name
          .split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0])
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
