export type Section = "home" | "games" | "find" | "profile" | "create";
export type LocationInfo = {
  section: Section;
  label: string;
  page: string;
  parent?: { href: string; label: string };
};

export function navigationFor(path: string): LocationInfo {
  const parent = (href: string, label: string) => ({ href, label });
  const community = path.match(/^\/communities\/([^/]+)(?:\/|$)/)?.[1];
  if (path === "/")
    return { section: "home", label: "Главная", page: "Главная" };
  if (path === "/create" || path.endsWith("/create"))
    return {
      section: "create",
      label: "Организация",
      page: path.startsWith("/teams")
        ? "Создать команду"
        : path === "/communities/create"
          ? "Создать сообщество"
          : "Создать игру",
      parent:
        community && community !== "create"
          ? parent(`/communities/${community}`, "К сообществу")
          : parent("/", "На главную"),
    };
  if (
    path === "/my-game" ||
    path.startsWith("/games/") ||
    (community && /\/(game-days|games)(\/|$)/.test(path))
  )
    return {
      section: "games",
      label: "Мои игры",
      page:
        path === "/my-game"
          ? "Мои игры"
          : path.endsWith("/play")
            ? "Игра"
            : path.endsWith("/games")
              ? "Игры сообщества"
              : "Участники игры",
      parent:
        path === "/my-game" ? undefined : parent("/my-game", "К моим играм"),
    };
  if (path.startsWith("/profile") || path === "/career")
    return {
      section: "profile",
      label: "Профиль",
      page:
        path === "/profile"
          ? "Профиль"
          : path === "/career"
            ? "История матчей"
            : path.endsWith("/edit")
              ? "Настройки профиля"
              : "Футбольные предпочтения",
      parent: path === "/profile" ? undefined : parent("/profile", "К профилю"),
    };
  return {
    section: "find",
    label: "Найти",
    page:
      path === "/open-games"
        ? "Открытые игры"
        : path === "/discover"
          ? "Каталог"
          : path === "/communities"
            ? "Мои сообщества"
            : path.startsWith("/teams/")
              ? "Команда"
              : path.startsWith("/players/")
                ? "Игрок"
                : "Сообщество",
    parent:
      path === "/open-games"
        ? undefined
        : path.startsWith("/teams/")
          ? parent("/discover?kind=teams", "К командам")
          : path.startsWith("/players/")
            ? parent("/discover?kind=players", "К игрокам")
            : community || path.startsWith("/discover/community/")
              ? parent("/discover?kind=communities", "К сообществам")
              : parent("/open-games", "К поиску игр"),
  };
}
