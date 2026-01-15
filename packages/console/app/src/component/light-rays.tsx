import { createSignal, createEffect, onMount, onCleanup, Show, For, Accessor, Setter } from "solid-js"
import { Renderer, Program, Triangle, Mesh } from "ogl"
import "./light-rays.css"

export type RaysOrigin =
  | "top-center"
  | "top-left"
  | "top-right"
  | "right"
  | "left"
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"

export interface LightRaysConfig {
  raysOrigin: RaysOrigin
  raysColor: string
  raysSpeed: number
  lightSpread: number
  rayLength: number
  sourceWidth: number
  pulsating: boolean
  pulsatingMin: number
  pulsatingMax: number
  fadeDistance: number
  saturation: number
  followMouse: boolean
  mouseInfluence: number
  noiseAmount: number
  distortion: number
  opacity: number
}

export const defaultConfig: LightRaysConfig = {
  raysOrigin: "top-center",
  raysColor: "#ffffff",
  raysSpeed: 0.2,
  lightSpread: 1.1,
  rayLength: 2.25,
  sourceWidth: 0.1,
  pulsating: true,
  pulsatingMin: 0.7,
  pulsatingMax: 0.9,
  fadeDistance: 1.5,
  saturation: 0.25,
  followMouse: false,
  mouseInfluence: 0.05,
  noiseAmount: 0.0,
  distortion: 0.0,
  opacity: 0.5,
}

interface LightRaysProps {
  config: Accessor<LightRaysConfig>
  class?: string
}

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1]
}

const getAnchorAndDir = (
  origin: RaysOrigin,
  w: number,
  h: number,
): { anchor: [number, number]; dir: [number, number] } => {
  const outside = 0.2
  switch (origin) {
    case "top-left":
      return { anchor: [0, -outside * h], dir: [0, 1] }
    case "top-right":
      return { anchor: [w, -outside * h], dir: [0, 1] }
    case "left":
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] }
    case "right":
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] }
    case "bottom-left":
      return { anchor: [0, (1 + outside) * h], dir: [0, -1] }
    case "bottom-center":
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] }
    case "bottom-right":
      return { anchor: [w, (1 + outside) * h], dir: [0, -1] }
    default: // "top-center"
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] }
  }
}

type Vec2 = [number, number]
type Vec3 = [number, number, number]

interface Uniforms {
  iTime: { value: number }
  iResolution: { value: Vec2 }
  rayPos: { value: Vec2 }
  rayDir: { value: Vec2 }
  raysColor: { value: Vec3 }
  raysSpeed: { value: number }
  lightSpread: { value: number }
  rayLength: { value: number }
  sourceWidth: { value: number }
  pulsating: { value: number }
  pulsatingMin: { value: number }
  pulsatingMax: { value: number }
  fadeDistance: { value: number }
  saturation: { value: number }
  mousePos: { value: Vec2 }
  mouseInfluence: { value: number }
  noiseAmount: { value: number }
  distortion: { value: number }
}

export default function LightRays(props: LightRaysProps) {
  let containerRef: HTMLDivElement | undefined
  let uniformsRef: Uniforms | null = null
  let rendererRef: Renderer | null = null
  let meshRef: Mesh | null = null
  let animationIdRef: number | null = null
  let cleanupFunctionRef: (() => void) | null = null

  const mouseRef = { x: 0.5, y: 0.5 }
  const smoothMouseRef = { x: 0.5, y: 0.5 }

  const [isVisible, setIsVisible] = createSignal(false)

  onMount(() => {
    if (!containerRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsVisible(entry.isIntersecting)
      },
      { threshold: 0.1 },
    )

    observer.observe(containerRef)

    onCleanup(() => {
      observer.disconnect()
    })
  })

  createEffect(() => {
    const visible = isVisible()
    const config = props.config()
    if (!visible || !containerRef) {
      return
    }

    if (cleanupFunctionRef) {
      cleanupFunctionRef()
      cleanupFunctionRef = null
    }

    const initializeWebGL = async () => {
      if (!containerRef) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 10))

      if (!containerRef) {
        return
      }

      const renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio, 2),
        alpha: true,
      })
      rendererRef = renderer

      const gl = renderer.gl
      gl.canvas.style.width = "100%"
      gl.canvas.style.height = "100%"

      while (containerRef.firstChild) {
        containerRef.removeChild(containerRef.firstChild)
      }
      containerRef.appendChild(gl.canvas)

      const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

      const frag = `precision highp float;

uniform float iTime;
uniform vec2  iResolution;

uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float sourceWidth;
uniform float pulsating;
uniform float pulsatingMin;
uniform float pulsatingMax;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
  
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulseCenter = (pulsatingMin + pulsatingMax) * 0.5;
  float pulseAmplitude = (pulsatingMax - pulsatingMin) * 0.5;
  float pulse = pulsating > 0.5 ? (pulseCenter + pulseAmplitude * sin(iTime * speed * 3.0)) : 1.0;

  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  
  // Calculate source position offset based on sourceWidth
  // Negative offset makes rays spread wider (source moves opposite to pixel position)
  float normalizedX = (coord.x / iResolution.x) - 0.5; // -0.5 to 0.5
  float widthOffset = -normalizedX * sourceWidth * iResolution.x;
  
  // Perpendicular to ray direction for width offset
  vec2 perpDir = vec2(-rayDir.y, rayDir.x);
  vec2 adjustedRayPos = rayPos + perpDir * widthOffset;
  
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - adjustedRayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) *
               rayStrength(adjustedRayPos, finalRayDir, coord, 36.2214, 21.11349,
                           1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) *
               rayStrength(adjustedRayPos, finalRayDir, coord, 22.3991, 18.0234,
                           1.1 * raysSpeed);

  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor  = color;
}`

      const uniforms: Uniforms = {
        iTime: { value: 0 },
        iResolution: { value: [1, 1] },

        rayPos: { value: [0, 0] },
        rayDir: { value: [0, 1] },

        raysColor: { value: hexToRgb(config.raysColor) },
        raysSpeed: { value: config.raysSpeed },
        lightSpread: { value: config.lightSpread },
        rayLength: { value: config.rayLength },
        sourceWidth: { value: config.sourceWidth },
        pulsating: { value: config.pulsating ? 1.0 : 0.0 },
        pulsatingMin: { value: config.pulsatingMin },
        pulsatingMax: { value: config.pulsatingMax },
        fadeDistance: { value: config.fadeDistance },
        saturation: { value: config.saturation },
        mousePos: { value: [0.5, 0.5] },
        mouseInfluence: { value: config.mouseInfluence },
        noiseAmount: { value: config.noiseAmount },
        distortion: { value: config.distortion },
      }
      uniformsRef = uniforms

      const geometry = new Triangle(gl)
      const program = new Program(gl, {
        vertex: vert,
        fragment: frag,
        uniforms,
      })
      const mesh = new Mesh(gl, { geometry, program })
      meshRef = mesh

      const updatePlacement = () => {
        if (!containerRef || !renderer) {
          return
        }

        renderer.dpr = Math.min(window.devicePixelRatio, 2)

        const { clientWidth: wCSS, clientHeight: hCSS } = containerRef
        renderer.setSize(wCSS, hCSS)

        const dpr = renderer.dpr
        const w = wCSS * dpr
        const h = hCSS * dpr

        uniforms.iResolution.value = [w, h]

        const currentConfig = props.config()
        const { anchor, dir } = getAnchorAndDir(currentConfig.raysOrigin, w, h)
        uniforms.rayPos.value = anchor
        uniforms.rayDir.value = dir
      }

      const loop = (t: number) => {
        if (!rendererRef || !uniformsRef || !meshRef) {
          return
        }

        const currentConfig = props.config()
        uniforms.iTime.value = t * 0.001

        if (currentConfig.followMouse && currentConfig.mouseInfluence > 0.0) {
          const smoothing = 0.92

          smoothMouseRef.x = smoothMouseRef.x * smoothing + mouseRef.x * (1 - smoothing)
          smoothMouseRef.y = smoothMouseRef.y * smoothing + mouseRef.y * (1 - smoothing)

          uniforms.mousePos.value = [smoothMouseRef.x, smoothMouseRef.y]
        }

        try {
          renderer.render({ scene: mesh })
          animationIdRef = requestAnimationFrame(loop)
        } catch (error) {
          console.warn("WebGL rendering error:", error)
          return
        }
      }

      window.addEventListener("resize", updatePlacement)
      updatePlacement()
      animationIdRef = requestAnimationFrame(loop)

      cleanupFunctionRef = () => {
        if (animationIdRef) {
          cancelAnimationFrame(animationIdRef)
          animationIdRef = null
        }

        window.removeEventListener("resize", updatePlacement)

        if (renderer) {
          try {
            const canvas = renderer.gl.canvas
            const loseContextExt = renderer.gl.getExtension("WEBGL_lose_context")
            if (loseContextExt) {
              loseContextExt.loseContext()
            }

            if (canvas && canvas.parentNode) {
              canvas.parentNode.removeChild(canvas)
            }
          } catch (error) {
            console.warn("Error during WebGL cleanup:", error)
          }
        }

        rendererRef = null
        uniformsRef = null
        meshRef = null
      }
    }

    initializeWebGL()

    onCleanup(() => {
      if (cleanupFunctionRef) {
        cleanupFunctionRef()
        cleanupFunctionRef = null
      }
    })
  })

  createEffect(() => {
    if (!uniformsRef || !containerRef || !rendererRef) {
      return
    }

    const config = props.config()
    const u = uniformsRef
    const renderer = rendererRef

    u.raysColor.value = hexToRgb(config.raysColor)
    u.raysSpeed.value = config.raysSpeed
    u.lightSpread.value = config.lightSpread
    u.rayLength.value = config.rayLength
    u.sourceWidth.value = config.sourceWidth
    u.pulsating.value = config.pulsating ? 1.0 : 0.0
    u.pulsatingMin.value = config.pulsatingMin
    u.pulsatingMax.value = config.pulsatingMax
    u.fadeDistance.value = config.fadeDistance
    u.saturation.value = config.saturation
    u.mouseInfluence.value = config.mouseInfluence
    u.noiseAmount.value = config.noiseAmount
    u.distortion.value = config.distortion

    const { clientWidth: wCSS, clientHeight: hCSS } = containerRef
    const dpr = renderer.dpr
    const { anchor, dir } = getAnchorAndDir(config.raysOrigin, wCSS * dpr, hCSS * dpr)
    u.rayPos.value = anchor
    u.rayDir.value = dir
  })

  createEffect(() => {
    const config = props.config()
    if (!config.followMouse) {
      return
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef || !rendererRef) {
        return
      }
      const rect = containerRef.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      mouseRef.x = x
      mouseRef.y = y
    }

    window.addEventListener("mousemove", handleMouseMove)

    onCleanup(() => {
      window.removeEventListener("mousemove", handleMouseMove)
    })
  })

  return (
    <div
      ref={containerRef}
      class={`light-rays-container ${props.class ?? ""}`.trim()}
      style={{ opacity: props.config().opacity }}
    />
  )
}

interface LightRaysControlsProps {
  config: Accessor<LightRaysConfig>
  setConfig: Setter<LightRaysConfig>
}

export function LightRaysControls(props: LightRaysControlsProps) {
  const [isOpen, setIsOpen] = createSignal(true)

  const updateConfig = <K extends keyof LightRaysConfig>(key: K, value: LightRaysConfig[K]) => {
    props.setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const origins: RaysOrigin[] = [
    "top-center",
    "top-left",
    "top-right",
    "left",
    "right",
    "bottom-center",
    "bottom-left",
    "bottom-right",
  ]

  return (
    <div class="light-rays-controls">
      <button class="light-rays-controls-toggle" onClick={() => setIsOpen(!isOpen())}>
        {isOpen() ? "▼" : "▶"} Light Rays
      </button>
      <Show when={isOpen()}>
        <div class="light-rays-controls-panel">
          <div class="control-group">
            <label>Origin</label>
            <select
              value={props.config().raysOrigin}
              onChange={(e) => updateConfig("raysOrigin", e.currentTarget.value as RaysOrigin)}
            >
              <For each={origins}>{(origin) => <option value={origin}>{origin}</option>}</For>
            </select>
          </div>

          <div class="control-group">
            <label>Color</label>
            <input
              type="color"
              value={props.config().raysColor}
              onInput={(e) => updateConfig("raysColor", e.currentTarget.value)}
            />
          </div>

          <div class="control-group">
            <label>Speed: {props.config().raysSpeed.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.01"
              value={props.config().raysSpeed}
              onInput={(e) => updateConfig("raysSpeed", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Light Spread: {props.config().lightSpread.toFixed(2)}</label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.01"
              value={props.config().lightSpread}
              onInput={(e) => updateConfig("lightSpread", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Ray Length: {props.config().rayLength.toFixed(2)}</label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.01"
              value={props.config().rayLength}
              onInput={(e) => updateConfig("rayLength", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Source Width: {props.config().sourceWidth.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={props.config().sourceWidth}
              onInput={(e) => updateConfig("sourceWidth", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Fade Distance: {props.config().fadeDistance.toFixed(2)}</label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.01"
              value={props.config().fadeDistance}
              onInput={(e) => updateConfig("fadeDistance", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Saturation: {props.config().saturation.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={props.config().saturation}
              onInput={(e) => updateConfig("saturation", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Mouse Influence: {props.config().mouseInfluence.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.config().mouseInfluence}
              onInput={(e) => updateConfig("mouseInfluence", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Noise: {props.config().noiseAmount.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.config().noiseAmount}
              onInput={(e) => updateConfig("noiseAmount", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Distortion: {props.config().distortion.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={props.config().distortion}
              onInput={(e) => updateConfig("distortion", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Opacity: {props.config().opacity.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.config().opacity}
              onInput={(e) => updateConfig("opacity", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={props.config().pulsating}
                onChange={(e) => updateConfig("pulsating", e.currentTarget.checked)}
              />
              Pulsating
            </label>
          </div>

          <Show when={props.config().pulsating}>
            <div class="control-group">
              <label>Pulse Min: {props.config().pulsatingMin.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={props.config().pulsatingMin}
                onInput={(e) => updateConfig("pulsatingMin", parseFloat(e.currentTarget.value))}
              />
            </div>

            <div class="control-group">
              <label>Pulse Max: {props.config().pulsatingMax.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={props.config().pulsatingMax}
                onInput={(e) => updateConfig("pulsatingMax", parseFloat(e.currentTarget.value))}
              />
            </div>
          </Show>

          <div class="control-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={props.config().followMouse}
                onChange={(e) => updateConfig("followMouse", e.currentTarget.checked)}
              />
              Follow Mouse
            </label>
          </div>

          <button class="reset-button" onClick={() => props.setConfig(defaultConfig)}>
            Reset to Defaults
          </button>
        </div>
      </Show>
    </div>
  )
}
