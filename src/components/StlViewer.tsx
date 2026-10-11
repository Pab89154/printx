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
}

function parseHex(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback
  const h = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback
  return Number.parseInt(h, 16)
}

/** STL preview for admin + public shop. */
export function StlViewer({
  url,
  className = '',
  height = 280,
  credentials = 'include',
  interactive = true,
  colorHex,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host || !url) return

    let cancelled = false
    setError('')

    const width = Math.max(host.clientWidth || 320, 120)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf1f5f9)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000)
    camera.position.set(80, 60, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    host.replaceChildren(renderer.domElement)
    if (!interactive) {
      renderer.domElement.style.pointerEvents = 'none'
    }

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.1)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 0.85)
    dir.position.set(40, 80, 30)
    scene.add(dir)

    let controls: OrbitControls | null = null
    if (interactive) {
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
    }

    let mesh: THREE.Mesh | null = null
    let frame = 0
    const loader = new STLLoader()
    const meshColor = parseHex(colorHex, 0x12b5d4)

    void (async () => {
      try {
        const res = await fetch(url, { credentials })
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'Model file missing — re-upload the STL.'
              : `Could not load model (${res.status}).`,
          )
        }
        const buffer = await res.arrayBuffer()
        if (cancelled) return
        const geometry = loader.parse(buffer)
        geometry.computeVertexNormals()
        geometry.center()
        const material = new THREE.MeshStandardMaterial({
          color: meshColor,
          metalness: 0.12,
          roughness: 0.48,
        })
        mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        geometry.computeBoundingSphere()
        const radius = geometry.boundingSphere?.radius || 40
        const dist = radius * 2.6
        camera.position.set(dist * 0.75, dist * 0.55, dist)
        if (controls) {
          controls.target.set(0, 0, 0)
          controls.update()
        }
        renderer.render(scene, camera)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load 3D preview.')
        }
      }
    })()

    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls?.update()
      renderer.render(scene, camera)
    }
    tick()

    const onResize = () => {
      if (!hostRef.current) return
      const w = Math.max(hostRef.current.clientWidth || width, 120)
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      controls?.dispose()
      if (mesh) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      renderer.dispose()
      host.replaceChildren()
    }
  }, [url, height, credentials, interactive, colorHex])

  return (
    <div className={className}>
      <div
        ref={hostRef}
        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
        style={{ height }}
      />
      {error ? <p className="mt-2 text-xs text-amber-700">{error}</p> : null}
    </div>
  )
}
