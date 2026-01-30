import { message } from "@tauri-apps/plugin-dialog"

import { initI18n, t } from "./i18n"
import { commands } from "./bindings"

export async function installCli(): Promise<void> {
  await initI18n()

  const res = await commands.installCli()
  if (res.status === "ok") {
    await message(t("desktop.cli.installed.message", { path: res.data }), { title: t("desktop.cli.installed.title") })
  } else {
    await message(t("desktop.cli.failed.message", { error: String(res.error) }), {
      title: t("desktop.cli.failed.title"),
    })
  }
}
