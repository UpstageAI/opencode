import {
  type ComponentProps,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
} from "solid-js"
import { Portal } from "solid-js/web"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { ScrollFade } from "./scroll-fade"
import "./message-nav.css"

export type MessageNavProps = ComponentProps<"nav"> & {
  messages: UserMessage[]
  current?: UserMessage
  size: "normal" | "compact"
  onMessageSelect: (message: UserMessage) => void
}

const SCROLL_SPEED = 60
const PAUSE_DURATION = 800
interface ScrollAnimationState {
  rafId: number | null
  startTime: number
  running: boolean
}

const startScrollAnimation = (
  containerEl: HTMLElement,
): ScrollAnimationState | null => {
  containerEl.offsetHeight

  const extraWidth = containerEl.scrollWidth - containerEl.clientWidth
  if (extraWidth <= 0) return null

  const scrollDuration = (extraWidth / SCROLL_SPEED) * 1000

  const totalDuration = PAUSE_DURATION + scrollDuration + PAUSE_DURATION + scrollDuration + PAUSE_DURATION

  const state: ScrollAnimationState = {
    rafId: null,
    startTime: performance.now(),
    running: true,
  }

  const animate = (currentTime: number) => {
    if (!state.running) return

    const elapsed = currentTime - state.startTime
    const progress = (elapsed % totalDuration) / totalDuration

    const pausePercent = PAUSE_DURATION / totalDuration
    const scrollPercent = scrollDuration / totalDuration

    const pauseEnd1 = pausePercent
    const scrollEnd1 = pauseEnd1 + scrollPercent
    const pauseEnd2 = scrollEnd1 + pausePercent
    const scrollEnd2 = pauseEnd2 + scrollPercent

    let scrollPos = 0

    if (progress < pauseEnd1) {
      scrollPos = 0
    } else if (progress < scrollEnd1) {
      const scrollProgress = (progress - pauseEnd1) / scrollPercent
      scrollPos = scrollProgress * extraWidth
    } else if (progress < pauseEnd2) {
      scrollPos = extraWidth
    } else if (progress < scrollEnd2) {
      const scrollProgress = (progress - pauseEnd2) / scrollPercent
      scrollPos = extraWidth * (1 - scrollProgress)
    } else {
      scrollPos = 0
    }

    containerEl.scrollLeft = scrollPos
    state.rafId = requestAnimationFrame(animate)
  }

  state.rafId = requestAnimationFrame(animate)
  return state
}

const stopScrollAnimation = (state: ScrollAnimationState | null, containerEl?: HTMLElement) => {
  if (state) {
    state.running = false
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId)
    }
  }
  if (containerEl) {
    containerEl.scrollLeft = 0
  }
}

export function MessageNav(
  props: ComponentProps<"nav"> & {
    messages: UserMessage[]
    current?: UserMessage
    size: "normal" | "compact"
    onMessageSelect: (message: UserMessage) => void
    getLabel?: (message: UserMessage) => string | undefined
  },
) {
  const [local, others] = splitProps(props, ["messages", "current", "size", "onMessageSelect", "getLabel"])
  let navRef: HTMLElement | undefined
  let listRef: HTMLUListElement | undefined

  const [portalTarget, setPortalTarget] = createSignal<HTMLElement | null>(null)

  onMount(() => {
    if (navRef) {
      setPortalTarget(navRef)
    }
  })

  return (
    <nav ref={(el) => (navRef = el)} data-component="message-nav" data-size={local.size} {...others}>
      <Show when={portalTarget()}>
        <Portal mount={portalTarget()!}>
          <ul
            ref={(el) => (listRef = el)}
            data-slot="message-nav-list"
            style={{ "--message-nav-items": local.messages.length }}
          >
            <For each={local.messages}>
              {(message, index) => {
                let titleRef: HTMLElement | undefined
                let hoverTimeout: ReturnType<typeof setTimeout> | undefined
                let scrollAnimationState: ScrollAnimationState | null = null
                let innerRef: HTMLSpanElement | undefined

                const handleClick = () => local.onMessageSelect(message)

                const additions = createMemo(
                  () => message.summary?.diffs.reduce((acc, diff) => acc + diff.additions, 0) ?? 0,
                )

                const deletions = createMemo(
                  () => message.summary?.diffs.reduce((acc, diff) => acc + diff.deletions, 0) ?? 0,
                )

                const title = createMemo(() => message.summary?.title ?? "New message")

                const handleTitleMouseEnter = () => {
                  hoverTimeout = setTimeout(() => {
                    if (!titleRef) return

                    titleRef.offsetHeight

                    const isScrollable = titleRef.scrollWidth > titleRef.clientWidth + 1

                    if (isScrollable) {
                      stopScrollAnimation(scrollAnimationState, titleRef)
                      scrollAnimationState = startScrollAnimation(titleRef)
                    }
                  }, 300)
                }

                const handleTitleMouseLeave = () => {
                  if (hoverTimeout) {
                    clearTimeout(hoverTimeout)
                    hoverTimeout = undefined
                  }
                  stopScrollAnimation(scrollAnimationState, titleRef)
                  scrollAnimationState = null
                }

                onCleanup(() => {
                  if (hoverTimeout) {
                    clearTimeout(hoverTimeout)
                  }

                  stopScrollAnimation(scrollAnimationState, titleRef)
                })

                return (
                  <li data-slot="message-nav-item" style={{ "--item-index": index() }}>
                    <button
                      data-slot="message-nav-item-button"
                      data-active={message.id === local.current?.id || undefined}
                      type="button"
                      onClick={handleClick}
                    >
                      <ScrollFade
                        ref={(el) => (titleRef = el)}
                        direction="horizontal"
                        fadeStartSize={12}
                        fadeEndSize={12}
                        trackTransformSelector="[data-slot='message-nav-item-title-inner']"
                        data-slot="message-nav-item-title"
                        onMouseEnter={handleTitleMouseEnter}
                        onMouseLeave={handleTitleMouseLeave}
                      >
                        <span ref={(el) => (innerRef = el)} data-slot="message-nav-item-title-inner">
                          {title()}
                        </span>
                      </ScrollFade>

                      <span data-slot="message-nav-item-diff-changes">
                        <Show when={additions() > 0}>
                          <span data-slot="message-nav-item-additions">{additions()}</span>
                        </Show>
                        <Show when={deletions() > 0}>
                          <span data-slot="message-nav-item-deletions">{deletions()}</span>
                        </Show>
                      </span>
                    </button>
                  </li>
                )
              }}
            </For>
          </ul>
        </Portal>
      </Show>
    </nav>
  )
}
