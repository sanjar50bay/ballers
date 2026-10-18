import type { CSSProperties } from "react";
export default function Icon({
  name,
  size = 24,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "home" ? (
        <path d="M3 10 12 3 21 10v11h-6v-7H9v7H3Z" />
      ) : name === "ball" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m12 7 4.8 3.5-1.8 5.6H9l-1.8-5.6L12 7Zm0 0V3m4.8 7.5 3.6-1.2M15 16.1l2.2 3.1M9 16.1l-2.2 3.1m.4-9-3.6-1.2" />
        </>
      ) : name === "people" ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M2 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5v2" />
        </>
      ) : name === "profile" ? (
        <>
          <circle cx="12" cy="7" r="4" />
          <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
        </>
      ) : name === "bell" ? (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </>
      ) : name === "pin" ? (
        <>
          <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
          <circle cx="12" cy="10" r="2" />
        </>
      ) : name === "search" ? (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 6 6" />
        </>
      ) : name === "plus" ? (
        <path d="M12 4v16M4 12h16" />
      ) : (
        <path d="m9 5 7 7-7 7" />
      )}
    </svg>
  );
}
