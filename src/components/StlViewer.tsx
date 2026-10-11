import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

type Props = {
  url: string
  className?: string
  height?: number
  /** Admin STL routes need cookies; public catalog does not. */
  credentials?: RequestCredentials
  /** Orbit controls — off for catalog “screenshot” tiles. */
  interactive?: boolean
  /** Hex color for the mesh (e.g. selected shop color). */
  colorHex?: string
  /** When false, wait until the host is near the viewport before loading. */
  eager?: boolean
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
  credentials = 'include',
  interactive = true,
  colorHex,
  eager = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
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
      { rootMargin: '120px', threshold: 0.01 },
    )
    io.observe(host)
    return () => io.disconnect()
  }, [url, eager])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !activeUrl) return

    let cancelled = false
    let frame = 0
    let mesh: THREE.Mesh | null = null
    let controls: OrbitControls | null = null
    let renderer: THREE.WebGLRenderer | null = null
    const loader = new STLLoader()
    const meshColor = parseHex(colorHex, 0x12b5d4)

    setError('')
    setLoading(true)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf1f5f9)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
    camera.position.set(80, 60, 100)

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.replaceChildren(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    if (!interactive) {
      renderer.domElement.style.pointerEvents = 'none'
    }

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.1)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 0.85)
    dir.position.set(40, 80, 30)
    scene.add(dir)

    if (interactive) {
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
    }

    const syncSize = () => {
      if (!renderer || !hostRef.current) return
      const w = Math.max(hostRef.current.clientWidth || 0, 120)
      const h = Math.max(hostRef.current.clientHeight || height, 120)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    syncSize()

    const ro = new ResizeObserver(() => {
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

    void (async () => {
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
          color: meshColor,
          metalness: 0.12,
          roughness: 0.48,
        })
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
        renderer?.render(scene, camera)
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
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls?.dispose()
      if (mesh) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      renderer?.dispose()
      renderer = null
      host.replaceChildren()
    }
  }, [activeUrl, height, credentials, interactive, colorHex])

  return (
    <div className={`relative ${className}`.trim()}>
      <div
        ref={hostRef}
        className="h-full min-h-[12rem] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
        style={{ height }}
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
