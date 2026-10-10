import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

type Props = {
  url: string
  className?: string
  height?: number
}

/** Interactive STL preview for admin Approvals / Designs. */
export function StlViewer({ url, className = '', height = 280 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !url) return

    const width = host.clientWidth || 320
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf1f5f9)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000)
    camera.position.set(80, 60, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    host.replaceChildren(renderer.domElement)

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.1)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 0.85)
    dir.position.set(40, 80, 30)
    scene.add(dir)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    let mesh: THREE.Mesh | null = null
    let frame = 0
    let cancelled = false

    const loader = new STLLoader()
    loader.load(
      url,
      (geometry) => {
        if (cancelled) {
          geometry.dispose()
          return
        }
        geometry.computeVertexNormals()
        geometry.center()
        const material = new THREE.MeshStandardMaterial({
          color: 0x12b5d4,
          metalness: 0.15,
          roughness: 0.45,
        })
        mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        geometry.computeBoundingSphere()
        const radius = geometry.boundingSphere?.radius || 40
        const dist = radius * 2.6
        camera.position.set(dist * 0.7, dist * 0.55, dist)
        controls.target.set(0, 0, 0)
        controls.update()
      },
      undefined,
      () => {
        /* load error — leave empty canvas */
      },
    )

    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    const onResize = () => {
      if (!hostRef.current) return
      const w = hostRef.current.clientWidth || width
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      if (mesh) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      renderer.dispose()
      host.replaceChildren()
    }
  }, [url, height])

  return (
    <div
      ref={hostRef}
      className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${className}`}
      style={{ height }}
    />
  )
}
