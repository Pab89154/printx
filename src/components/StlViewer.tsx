import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

type Props = {
  url: string
  className?: string
  height?: number | '100%'
  /** Admin STL routes need cookies; public catalog does not. */
  credentials?: RequestCredentials
  /** Orbit controls — off for catalog “screenshot” tiles. */
  interactive?: boolean
  /** Hex color for the mesh (e.g. selected shop color). */
  colorHex?: string
  /** When false, wait until the host is near the viewport before loading. */
  eager?: boolean
}

/** iOS Safari / home-screen web apps crash or error when too many WebGL contexts are open. */
const MAX_LIVE_VIEWERS = 2
let liveViewers = 0
const viewerWaitQueue: Array<() => void> = []

type ViewerSlot = {
  promise: Promise<void>
  /** Call if the component unmounts before/while waiting — avoids permanent slot leaks. */
  cancel: () => void
}

function acquireViewerSlot(): ViewerSlot {
  let cancelled = false
  let acquired = false
  let queued: (() => void) | null = null

  const promise = new Promise<void>((resolve) => {
    const take = () => {
      if (cancelled) {
        // Slot opened but this waiter is gone — pass through to the next queued viewer.
        const next = viewerWaitQueue.shift()
        if (next) next()
        return
      }
      liveViewers += 1
      acquired = true
      resolve()
    }
    if (liveViewers < MAX_LIVE_VIEWERS) {
      take()
      return
    }
    queued = take
    viewerWaitQueue.push(take)
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      if (!acquired && queued) {
        const idx = viewerWaitQueue.indexOf(queued)
        if (idx >= 0) viewerWaitQueue.splice(idx, 1)
      }
    },
  }
}

function releaseViewerSlot() {
  liveViewers = Math.max(0, liveViewers - 1)
  const next = viewerWaitQueue.shift()
  if (next) next()
}

/** Shop tiles: paint once to a static image and free the WebGL slot for the next card. */
function freezeViewerToImage(
  host: HTMLElement,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  renderer.render(scene, camera)
  let dataUrl = ''
  try {
    dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.88)
  } catch {
    /* WebGL context lost / blocked */
  }
  host.replaceChildren()
  if (!dataUrl) return
  const img = document.createElement('img')
  img.src = dataUrl
  img.alt = ''
  img.draggable = false
  img.className = 'h-full w-full object-cover'
  host.appendChild(img)
}

function parseHex(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback
  const h = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback
  return Number.parseInt(h, 16)
}

function parseStlOffMain(loader: STLLoader, buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    // Yield so React can finish unmounts before a multi‑MB sync parse blocks the thread.
    setTimeout(() => {
      try {
        resolve(loader.parse(buffer))
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not parse STL.'))
      }
    }, 0)
  })
}

/** STL preview for admin + public shop. */
export function StlViewer({
  url,
  className = '',
  height = 280,
  credentials = 'same-origin',
  interactive = true,
  colorHex,
  eager = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const colorHexRef = useRef(colorHex)
  colorHexRef.current = colorHex
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeUrl, setActiveUrl] = useState(eager ? url : '')

  // Lazy-load when the tile scrolls into view (shop grid).
  useEffect(() => {
    if (eager) {
      setActiveUrl(url)
      return
    }
    const host = hostRef.current
    if (!host) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActiveUrl(url)
          io.disconnect()
        }
      },
      { rootMargin: '160px', threshold: 0.01 },
    )
    io.observe(host)
    return () => io.disconnect()
  }, [url, eager])

  // Update mesh tint without re-fetching the STL.
  useEffect(() => {
    const mat = materialRef.current
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!mat) return
    mat.color.setHex(parseHex(colorHex, 0x12b5d4))
    mat.needsUpdate = true
    if (!interactive && renderer && scene && camera) {
      renderer.render(scene, camera)
    }
  }, [colorHex, interactive])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !activeUrl) return

    let cancelled = false
    let frame = 0
    let mesh: THREE.Mesh | null = null
    let controls: OrbitControls | null = null
    let renderer: THREE.WebGLRenderer | null = null
    let acquired = false
    let ro: ResizeObserver | null = null
    const loader = new STLLoader()
    const meshColor = parseHex(colorHexRef.current, 0x12b5d4)

    setError('')
    setLoading(true)

    const scene = new THREE.Scene()
    sceneRef.current = scene
    scene.background = new THREE.Color(0xe2e8f0)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
    camera.position.set(80, 60, 100)
    cameraRef.current = camera

    const slot = acquireViewerSlot()

    void (async () => {
      await slot.promise
      if (cancelled) return
      acquired = true

      try {
        renderer = new THREE.WebGLRenderer({
          antialias: false,
          alpha: false,
          // Needed so shop tiles can snapshot to a JPEG and free the WebGL slot.
          preserveDrawingBuffer: !interactive,
          powerPreference: 'default',
          failIfMajorPerformanceCaveat: false,
        })
      } catch {
        if (!cancelled) {
          setLoading(false)
          setError('3D preview not available on this device.')
        }
        if (acquired) {
          releaseViewerSlot()
          acquired = false
        }
        return
      }

      if (cancelled) {
        renderer.dispose()
        if (acquired) {
          releaseViewerSlot()
          acquired = false
        }
        return
      }

      rendererRef.current = renderer
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, interactive ? 1.5 : 1))
      host.replaceChildren(renderer.domElement)
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      if (!interactive) renderer.domElement.style.pointerEvents = 'none'

      scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.15))
      const dir = new THREE.DirectionalLight(0xffffff, 0.9)
      dir.position.set(40, 80, 30)
      scene.add(dir)

      if (interactive) {
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
      }

      const syncSize = () => {
        if (!renderer || !hostRef.current) return
        const w = Math.max(hostRef.current.clientWidth || 0, 120)
        const h = Math.max(
          hostRef.current.clientHeight || (typeof height === 'number' ? height : 120),
          120,
        )
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h, false)
      }
      syncSize()

      ro = new ResizeObserver(() => {
        syncSize()
        if (renderer) renderer.render(scene, camera)
      })
      ro.observe(host)

      const tick = () => {
        if (cancelled || !renderer) return
        frame = requestAnimationFrame(tick)
        controls?.update()
        renderer.render(scene, camera)
      }
      if (interactive) tick()

      try {
        const res = await fetch(activeUrl, { credentials })
        if (cancelled) return
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'Model file missing — re-upload the STL.'
              : `Could not load model (${res.status}).`,
          )
        }
        const buffer = await res.arrayBuffer()
        if (cancelled) return

        const geometry = await parseStlOffMain(loader, buffer)
        if (cancelled) {
          geometry.dispose()
          return
        }

        geometry.computeVertexNormals()
        geometry.center()
        geometry.computeBoundingSphere()

        const material = new THREE.MeshStandardMaterial({
          color: parseHex(colorHexRef.current, meshColor),
          metalness: 0.08,
          roughness: 0.52,
        })
        materialRef.current = material
        mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        const radius = geometry.boundingSphere?.radius || 40
        const dist = Math.max(radius * 2.6, 10)
        camera.near = Math.max(dist / 200, 0.01)
        camera.far = dist * 50
        camera.position.set(dist * 0.75, dist * 0.55, dist)
        camera.lookAt(0, 0, 0)
        if (controls) {
          controls.target.set(0, 0, 0)
          controls.update()
        }
        syncSize()
        renderer.render(scene, camera)

        // Catalog tiles: keep a JPEG preview and free the WebGL context so the rest of the grid can load.
        if (!interactive && !cancelled) {
          ro?.disconnect()
          ro = null
          freezeViewerToImage(host, renderer, scene, camera)
          materialRef.current = null
          if (rendererRef.current === renderer) rendererRef.current = null
          if (sceneRef.current === scene) sceneRef.current = null
          if (cameraRef.current === camera) cameraRef.current = null
          if (mesh) {
            mesh.geometry.dispose()
            ;(mesh.material as THREE.Material).dispose()
            mesh = null
          }
          renderer.dispose()
          renderer = null
          if (acquired) {
            releaseViewerSlot()
            acquired = false
          }
        }

        if (!cancelled) setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          setError(err instanceof Error ? err.message : 'Could not load 3D preview.')
        }
      }
    })()

    return () => {
      cancelled = true
      slot.cancel()
      cancelAnimationFrame(frame)
      ro?.disconnect()
      controls?.dispose()
      materialRef.current = null
      if (rendererRef.current === renderer) rendererRef.current = null
      if (sceneRef.current === scene) sceneRef.current = null
      if (cameraRef.current === camera) cameraRef.current = null
      if (mesh) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      renderer?.dispose()
      renderer = null
      // Keep freeze JPEG if we already snapshotted (host has <img>, no live renderer).
      if (acquired) {
        host.replaceChildren()
        releaseViewerSlot()
        acquired = false
      }
    }
  }, [activeUrl, height, credentials, interactive, interactive ? '' : colorHex || ''])

  const fillParent = height === '100%'
  const hostStyle = fillParent ? ({ height: '100%', minHeight: 0 } as const) : { height }

  return (
    <div className={`relative h-full w-full ${className}`.trim()}>
      <div
        ref={hostRef}
        className={`h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${
          fillParent ? 'min-h-0' : 'min-h-[12rem]'
        }`}
        style={hostStyle}
      />
      {loading && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-100/70 text-xs font-medium text-muted">
          Loading 3D…
        </div>
      ) : null}
      {error ? (
        <p className="absolute inset-x-2 bottom-2 rounded-lg bg-white/90 px-2 py-1.5 text-center text-xs text-amber-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export type MultiStlPart = {
  url: string
  colorHex?: string
}

type MultiProps = {
  parts: MultiStlPart[]
  className?: string
  height?: number | '100%'
  credentials?: RequestCredentials
  interactive?: boolean
  eager?: boolean
}

/** Multi-mesh STL preview — each part tinted with its slot color. */
export function MultiStlViewer({
  parts,
  className = '',
  height = 280,
  credentials = 'same-origin',
  interactive = true,
  eager = true,
}: MultiProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([])
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const partsKey = parts.map((p) => p.url).join('|')
  const colorsKey = parts.map((p) => p.colorHex || '').join('|')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeKey, setActiveKey] = useState(eager ? partsKey : '')

  useEffect(() => {
    if (eager) {
      setActiveKey(partsKey)
      return
    }
    const host = hostRef.current
    if (!host) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActiveKey(partsKey)
          io.disconnect()
        }
      },
      { rootMargin: '160px', threshold: 0.01 },
    )
    io.observe(host)
    return () => io.disconnect()
  }, [partsKey, eager])

  useEffect(() => {
    const mats = materialsRef.current
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!mats.length) return
    parts.forEach((p, i) => {
      const mat = mats[i]
      if (mat) {
        mat.color.setHex(parseHex(p.colorHex, 0x12b5d4))
        mat.needsUpdate = true
      }
    })
    if (!interactive && renderer && scene && camera) {
      renderer.render(scene, camera)
    }
  }, [colorsKey, interactive, parts])

  useEffect(() => {
    const host = hostRef.current
    const activeParts = parts.filter((p) => p.url.trim())
    if (!host || !activeKey || activeParts.length === 0) return

    let cancelled = false
    let frame = 0
    const meshes: THREE.Mesh[] = []
    let controls: OrbitControls | null = null
    let renderer: THREE.WebGLRenderer | null = null
    let acquired = false
    let ro: ResizeObserver | null = null
    const loader = new STLLoader()

    setError('')
    setLoading(true)
    materialsRef.current = []

    const scene = new THREE.Scene()
    sceneRef.current = scene
    scene.background = new THREE.Color(0xe2e8f0)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
    camera.position.set(80, 60, 100)
    cameraRef.current = camera

    const slot = acquireViewerSlot()

    void (async () => {
      await slot.promise
      if (cancelled) return
      acquired = true

      try {
        renderer = new THREE.WebGLRenderer({
          antialias: false,
          alpha: false,
          preserveDrawingBuffer: !interactive,
          powerPreference: 'default',
          failIfMajorPerformanceCaveat: false,
        })
      } catch {
        if (!cancelled) {
          setLoading(false)
          setError('3D preview not available on this device.')
        }
        if (acquired) {
          releaseViewerSlot()
          acquired = false
        }
        return
      }

      if (cancelled) {
        renderer.dispose()
        if (acquired) {
          releaseViewerSlot()
          acquired = false
        }
        return
      }

      rendererRef.current = renderer
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, interactive ? 1.5 : 1))
      host.replaceChildren(renderer.domElement)
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      if (!interactive) renderer.domElement.style.pointerEvents = 'none'

      scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.15))
      const dir = new THREE.DirectionalLight(0xffffff, 0.9)
      dir.position.set(40, 80, 30)
      scene.add(dir)

      if (interactive) {
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
      }

      const syncSize = () => {
        if (!renderer || !hostRef.current) return
        const w = Math.max(hostRef.current.clientWidth || 0, 120)
        const h = Math.max(
          hostRef.current.clientHeight || (typeof height === 'number' ? height : 120),
          120,
        )
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h, false)
      }
      syncSize()

      ro = new ResizeObserver(() => {
        syncSize()
        if (renderer) renderer.render(scene, camera)
      })
      ro.observe(host)

      const tick = () => {
        if (cancelled || !renderer) return
        frame = requestAnimationFrame(tick)
        controls?.update()
        renderer.render(scene, camera)
      }
      if (interactive) tick()

      try {
        const group = new THREE.Group()
        const mats: THREE.MeshStandardMaterial[] = []

        for (let i = 0; i < activeParts.length; i++) {
          const part = activeParts[i]!
          const res = await fetch(part.url, { credentials })
          if (cancelled) return
          if (!res.ok) {
            throw new Error(
              res.status === 404
                ? 'A part model is missing — re-upload the slot STLs.'
                : `Could not load model (${res.status}).`,
            )
          }
          const buffer = await res.arrayBuffer()
          if (cancelled) return
          const geometry = await parseStlOffMain(loader, buffer)
          if (cancelled) {
            geometry.dispose()
            return
          }
          geometry.computeVertexNormals()
          const material = new THREE.MeshStandardMaterial({
            color: parseHex(part.colorHex, 0x12b5d4),
            metalness: 0.08,
            roughness: 0.52,
          })
          mats.push(material)
          const mesh = new THREE.Mesh(geometry, material)
          group.add(mesh)
          meshes.push(mesh)
        }

        if (cancelled) {
          for (const m of meshes) {
            m.geometry.dispose()
            ;(m.material as THREE.Material).dispose()
          }
          return
        }

        // Center the combined assembly without moving parts relative to each other.
        const box = new THREE.Box3().setFromObject(group)
        const center = box.getCenter(new THREE.Vector3())
        group.position.sub(center)
        scene.add(group)
        materialsRef.current = mats

        const size = box.getSize(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z) * 0.6 || 40
        const dist = Math.max(radius * 2.6, 10)
        camera.near = Math.max(dist / 200, 0.01)
        camera.far = dist * 50
        camera.position.set(dist * 0.75, dist * 0.55, dist)
        camera.lookAt(0, 0, 0)
        if (controls) {
          controls.target.set(0, 0, 0)
          controls.update()
        }
        syncSize()
        renderer.render(scene, camera)

        if (!interactive && !cancelled) {
          ro?.disconnect()
          ro = null
          freezeViewerToImage(host, renderer, scene, camera)
          materialsRef.current = []
          if (rendererRef.current === renderer) rendererRef.current = null
          if (sceneRef.current === scene) sceneRef.current = null
          if (cameraRef.current === camera) cameraRef.current = null
          for (const m of meshes) {
            m.geometry.dispose()
            ;(m.material as THREE.Material).dispose()
          }
          meshes.length = 0
          renderer.dispose()
          renderer = null
          if (acquired) {
            releaseViewerSlot()
            acquired = false
          }
        }

        if (!cancelled) setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          setError(err instanceof Error ? err.message : 'Could not load 3D preview.')
        }
      }
    })()

    return () => {
      cancelled = true
      slot.cancel()
      cancelAnimationFrame(frame)
      ro?.disconnect()
      controls?.dispose()
      materialsRef.current = []
      if (rendererRef.current === renderer) rendererRef.current = null
      if (sceneRef.current === scene) sceneRef.current = null
      if (cameraRef.current === camera) cameraRef.current = null
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      renderer?.dispose()
      renderer = null
      if (acquired) {
        host.replaceChildren()
        releaseViewerSlot()
        acquired = false
      }
    }
    // Non-interactive tiles reload when colors change (after snapshot WebGL is gone).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, height, credentials, interactive, interactive ? '' : colorsKey])

  const fillParent = height === '100%'
  const hostStyle = fillParent ? ({ height: '100%', minHeight: 0 } as const) : { height }

  return (
    <div className={`relative h-full w-full ${className}`.trim()}>
      <div
        ref={hostRef}
        className={`h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${
          fillParent ? 'min-h-0' : 'min-h-[12rem]'
        }`}
        style={hostStyle}
      />
      {loading && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-100/70 text-xs font-medium text-muted">
          Loading 3D…
        </div>
      ) : null}
      {error ? (
        <p className="absolute inset-x-2 bottom-2 rounded-lg bg-white/90 px-2 py-1.5 text-center text-xs text-amber-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}
