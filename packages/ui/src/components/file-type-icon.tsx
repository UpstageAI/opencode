import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"
import sprite from "./file-icons/sprite.svg"
import type { IconName } from "./file-icons/types"

export type FileTypeIconProps = JSX.SVGElementTags["svg"] & {
  id: IconName
}

export const FileTypeIcon: Component<FileTypeIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  return (
    <svg
      data-component="file-type-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${local.id}`} />
    </svg>
  )
}
