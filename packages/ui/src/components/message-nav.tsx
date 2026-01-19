import {
  type ComponentProps,
  For,
  Index,
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

const CharacterSpans = (props: { text: string }) => {
  const characters = createMemo(() => props.text?.split("") ?? [])

  return (
    <Index each={characters()}>
      {(char, index) => (
        <span data-slot="message-nav-char" style={{ "--char-index": index }}>
          {char() === " " ? "\u00A0" : char()}
        </span>
      )}
    </Index>
  )
}

const setupRevealForTitle = (titleEl: HTMLElement) => {
  const innerEl = titleEl.querySelector<HTMLElement>("[data-slot='message-nav-item-title-inner']")
  if (!innerEl) return

  const spans = innerEl.querySelectorAll<HTMLSpanElement>("span")
  if (spans.length === 0) return

  innerEl.offsetHeight

  const totalWidth = innerEl.scrollWidth
  const containerWidth = titleEl.clientWidth
  const numChars = spans.length
  const avgWidth = numChars > 0 ? totalWidth / numChars : 12

  innerEl.style.setProperty("--total-width", `${totalWidth}px`)
  innerEl.style.setProperty("--avg-width", `${avgWidth}px`)

  const liEl = titleEl.closest("[data-slot='message-nav-item']") as HTMLElement | null
  if (liEl) {
    const extraWidth = Math.max(0, totalWidth - containerWidth)
    liEl.style.setProperty("--item-extra-width", `-${extraWidth}px`)
  }

  const style = getComputedStyle(innerEl)
  const factor = parseFloat(style.getPropertyValue("--factor")) || 5
  let spacing = parseFloat(style.getPropertyValue("--spacing"))
  if (isNaN(spacing)) spacing = 0

  let virtualWidth = totalWidth
  if (spans.length > 0) {
    const lastSpan = spans[spans.length - 1]
    lastSpan.offsetHeight
    const lastLeft = lastSpan.offsetLeft

    const ramp = avgWidth * factor
    const neededForLast = lastLeft + spacing + ramp
    virtualWidth = Math.max(totalWidth, neededForLast)
  }

  innerEl.style.setProperty("--virtual-width", `${virtualWidth}px`)

  spans.forEach((span) => {
    span.offsetHeight
    const left = span.offsetLeft
    span.style.setProperty("--char-left", `${left}px`)
  })
}

export type MessageNavProps = ComponentProps<"nav"> & {
  messages: UserMessage[]
  current?: UserMessage
  size: "normal" | "compact"
  onMessageSelect: (message: UserMessage) => void
}

const createCharacterSpans = (text: string): HTMLSpanElement[] => {
  return text.split("").map((char, index) => {
    const span = document.createElement("span")
    span.setAttribute("data-slot", "message-nav-char")
    span.style.setProperty("--char-index", String(index))
    span.textContent = char === " " ? "\u00A0" : char
    return span
  })
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

export const MessageNav = (props: MessageNavProps) => {
  const [local, others] = splitProps(props, ["messages", "current", "size", "onMessageSelect"])
  const titleRefs = new Map<string, HTMLElement>()
  const innerRefs = new Map<string, HTMLSpanElement>()
  const resetTrackers = new Map<string, () => void>()
  let navRef: HTMLElement | undefined
  let listRef: HTMLUListElement | undefined

  const [portalTarget, setPortalTarget] = createSignal<HTMLElement | null>(null)
  const [originalText, setOriginalText] = createSignal<Record<string, string>>({})

  const handleListMouseEnter = () => {
    for (const reset of resetTrackers.values()) {
      reset()
    }
    setTimeout(() => {
      for (const titleEl of titleRefs.values()) {
        setupRevealForTitle(titleEl)
      }
    }, 500)
  }

  const handleListMouseLeave = () => {
    for (const [id, innerEl] of innerRefs.entries()) {
      const text = originalText()?.[id]
      if (!text || !innerEl) continue

      const existingSpans = innerEl.querySelectorAll("[data-slot='message-nav-char']")
      if (existingSpans.length > 0) continue

      innerEl.textContent = ""
      const spans = createCharacterSpans(text)
      spans.forEach((span) => innerEl.appendChild(span))

      const titleEl = titleRefs.get(id)
      if (titleEl) {
        requestAnimationFrame(() => setupRevealForTitle(titleEl))
      }
    }
  }

  const setupAllReveal = () => {
    const original: Record<string, string> = {}

    for (const [id, titleEl] of titleRefs.entries()) {
      const originalText = titleEl.textContent

      original[id] = originalText ?? ""

      setupRevealForTitle(titleEl)
    }

    setOriginalText(original)
  }

  const onTransitionEnd = (id: string, index: number) => {
    const text = originalText()?.[id]
    const innerEl = innerRefs.get(id)

    if (text && innerEl) {
      innerEl.textContent = text
    }
  }

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
            onMouseEnter={handleListMouseEnter}
            onMouseLeave={handleListMouseLeave}
          >
            <For each={local.messages}>
              {(message, index) => {
                let titleRef: HTMLElement | undefined
                let hoverTimeout: ReturnType<typeof setTimeout> | undefined
                let scrollAnimationState: ScrollAnimationState | null = null
                let innerRef: HTMLSpanElement | undefined
                let revealedCount = 0
                let totalSpans = 0
                let lastRevealTriggered = false

                const handleSpanTransitionEnd = (e: TransitionEvent) => {
                  if (e.propertyName !== "transform") return
                  const target = e.target as HTMLElement
                  if (target.getAttribute("data-slot") !== "message-nav-char") return

                  revealedCount++
                  if (revealedCount >= totalSpans && !lastRevealTriggered) {
                    lastRevealTriggered = true
                    onTransitionEnd(message.id, index())
                  }
                }

                const setupTransitionTracking = () => {
                  if (!innerRef) return
                  const spans = innerRef.querySelectorAll<HTMLSpanElement>("[data-slot='message-nav-char']")
                  totalSpans = spans.length
                  revealedCount = 0
                  lastRevealTriggered = false
                }

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
                  }, 500)
                }

                const handleTitleMouseLeave = () => {
                  if (hoverTimeout) {
                    clearTimeout(hoverTimeout)
                    hoverTimeout = undefined
                  }
                  stopScrollAnimation(scrollAnimationState, titleRef)
                  scrollAnimationState = null
                }

                onMount(() => {
                  if (titleRef) {
                    titleRefs.set(message.id, titleRef)

                    requestAnimationFrame(() => {
                      if (titleRef) {
                        setupRevealForTitle(titleRef)
                      }
                    })
                  }

                  if (innerRef) {
                    innerRefs.set(message.id, innerRef)
                    innerRef.addEventListener("transitionend", handleSpanTransitionEnd)
                  }

                  resetTrackers.set(message.id, setupTransitionTracking)
                })

                onCleanup(() => {
                  titleRefs.delete(message.id)
                  innerRefs.delete(message.id)
                  resetTrackers.delete(message.id)

                  if (hoverTimeout) {
                    clearTimeout(hoverTimeout)
                  }

                  stopScrollAnimation(scrollAnimationState, titleRef)

                  if (innerRef) {
                    innerRef.removeEventListener("transitionend", handleSpanTransitionEnd)
                  }
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
                          <CharacterSpans text={title()} />
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
