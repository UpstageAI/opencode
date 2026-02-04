import { createMemo, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { FileTypeIcon } from "@opencode-ai/ui/file-type-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"

export function SessionOpenMenu(props: { dir: string }) {
  const platform = usePlatform()
  const server = useServer()
  const language = useLanguage()

  const enabled = createMemo(
    () => platform.platform === "desktop" && platform.os === "macos" && server.isLocal() && !!props.dir,
  )

  const open = (app?: string) => {
    if (!props.dir) return
    void platform.openLink(props.dir, app).catch((error) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const copy = () => {
    if (!props.dir) return
    navigator.clipboard
      .writeText(props.dir)
      .then(() => {
        showToast({
          variant: "success",
          icon: "check",
          title: language.t("session.header.copyPath.copied"),
        })
      })
      .catch(() => {
        showToast({
          variant: "error",
          title: language.t("session.header.copyPath.copyFailed"),
        })
      })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenu.Trigger
        as={Button}
        variant="ghost"
        icon="folder"
        class="rounded-sm h-[24px] py-1.5 pr-2 pl-2 gap-1.5 border-none shadow-none data-[expanded]:bg-surface-raised-base-active"
        aria-label={language.t("session.header.open")}
      >
        <span class="text-12-regular text-text-strong">{language.t("session.header.open")}</span>
        <Icon name="chevron-down" size="small" class="icon-base" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="mt-1 w-60">
          <Show when={enabled()}>
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel>{language.t("session.header.openIn")}</DropdownMenu.GroupLabel>
              <DropdownMenu.Item onSelect={() => open("Visual Studio Code")}>
                <FileTypeIcon id="Vscode" class="size-5" />
                <DropdownMenu.ItemLabel>VS Code</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("Cursor")}>
                <FileTypeIcon id="Cursor" class="size-5" />
                <DropdownMenu.ItemLabel>Cursor</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("Finder")}>
                <Icon name="folder" size="small" class="icon-base shrink-0" />
                <DropdownMenu.ItemLabel>Finder</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("Terminal")}>
                <FileTypeIcon id="Console" class="size-5" />
                <DropdownMenu.ItemLabel>Terminal</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("iTerm")}>
                <FileTypeIcon id="Console" class="size-5" />
                <DropdownMenu.ItemLabel>iTerm2</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("Ghostty")}>
                <FileTypeIcon id="Console" class="size-5" />
                <DropdownMenu.ItemLabel>Ghostty</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("Xcode")}>
                <FileTypeIcon id="Swift" class="size-5" />
                <DropdownMenu.ItemLabel>Xcode</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => open("Android Studio")}>
                <FileTypeIcon id="Android" class="size-5" />
                <DropdownMenu.ItemLabel>Android Studio</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Group>
            <DropdownMenu.Separator />
          </Show>
          <DropdownMenu.Item onSelect={copy}>
            <Icon name="copy" size="small" class="icon-base shrink-0" />
            <DropdownMenu.ItemLabel>{language.t("session.header.copyPath")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
