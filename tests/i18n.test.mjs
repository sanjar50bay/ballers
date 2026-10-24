import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
import catalog from "../lib/i18n/catalog.json" with { type: "json" };
const source = fs.readFileSync(
  new URL("../lib/i18n/index.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const exports = {};
vm.runInNewContext(js, {
  exports,
  require: (p) => {
    assert.equal(p, "./catalog.json");
    return catalog;
  },
});
for (const [key, entry] of Object.entries(catalog))
  for (const lang of ["ru", "kk"]) {
    assert.equal(typeof entry[lang], "string", key);
    assert.ok(entry[lang].trim(), key);
    assert.ok(!entry[lang].includes("undefined"), key);
  }
assert.equal(exports.t("Создать профиль"), "Создать профиль");
exports.setLocale("kk");
assert.equal(exports.t("Создать профиль"), "Профиль құру");
assert.equal(exports.t("Create Community"), "Қауымдастық құру");
assert.equal(exports.positionLabel("MID"), "Жартылай қорғаушы");
assert.equal(exports.dateLocale(), "kk-KZ");
assert.equal(
  exports.t("Добавить {name} в сообщество как постоянного участника?", {
    name: "Wednesday Football",
  }),
  "Wednesday Football ойыншысын қауымдастыққа тұрақты қатысушы ретінде қосасың ба?",
);
assert.equal(
  exports.notificationText("Приглашение: Wednesday Football"),
  "Шақыру: Wednesday Football",
);
assert.equal(
  exports.notificationText("Подтвердите результат матча #2"),
  "Матч нәтижесін растаңыз №2",
);
assert.match(
  exports.notificationText("Ответ на приглашение изменён ответственным: GOING"),
  /Барамын/,
);
assert.ok(!exports.uiError("duplicate key SQL secret").includes("SQL"));
assert.equal(
  exports.t("Арсен / Wednesday Football"),
  "Арсен / Wednesday Football",
);
exports.setLocale("ru");
assert.equal(exports.t("Профиль құру"), "Создать профиль");
function walk(url) {
  return fs
    .readdirSync(url, { withFileTypes: true })
    .flatMap((x) =>
      x.isDirectory()
        ? walk(new URL(x.name + "/", url))
        : x.name.endsWith(".tsx")
          ? [new URL(x.name, url)]
          : [],
    );
}
let checked = 0;
for (const file of walk(new URL("../app/", import.meta.url))) {
  if (!file.pathname.endsWith("/page.tsx")) continue;
  const s = fs.readFileSync(file, "utf8");
  assert.ok(s.includes("useLocale()"), file.pathname);
  checked++;
}
assert.equal(checked, 22);
console.log(
  `PASS localization: ${Object.keys(catalog).length} complete RU/KK entries, status/date/errors/templates, user content preserved, ${checked} page files subscribed`,
);
