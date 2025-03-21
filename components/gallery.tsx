"use client"

import { useState, useEffect, useRef } from "react"
import * as THREE from "three"
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls"
import { PillStatue } from "@/components/pill-statue"
import { Instructions } from "@/components/instructions"
import { InteractionPrompt } from "@/components/interaction-prompt"
import { PlayerModel } from "@/components/player-model"
import { TextSprite } from "@/components/text-sprite"
import { NewDrawingInterface } from "@/components/new-drawing-interface"
import Peer from "peerjs"

interface Player {
  id: string
  username: string
  position: THREE.Vector3
  rotation: number
  color: string
  model?: PlayerModel
  nameSprite?: TextSprite
}

interface GalleryProps {
  username: string
}

// Add global type for window.exitDrawingMode
declare global {
  interface Window {
    exitDrawingMode: (canvas: HTMLCanvasElement) => void
    debugPlayers: () => void
    forceReconnect: () => void
    currentInteractiveCanvas: THREE.Mesh | null
  }
}

export default function Gallery({ username }: GalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<Record<string, Peer.DataConnection>>({})
  const pendingConnectionsRef = useRef<Record<string, boolean>>({})
  const [started, setStarted] = useState(false)
  const [drawingMode, setDrawingMode] = useState(false)
  const [nearbyCanvas, setNearbyCanvas] = useState<THREE.Mesh | null>(null)
  const [currentCanvas, setCurrentCanvas] = useState<THREE.Mesh | null>(null)
  const [interactionPrompt, setInteractionPrompt] = useState("")
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [myId, setMyId] = useState<string>("")
  const playerPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 1.6, 5))
  const playerRotationRef = useRef<number>(0)
  const [connectionStatus, setConnectionStatus] = useState("Initializing...")
  const sceneRef = useRef<THREE.Scene | null>(null)
  const knownPeersRef = useRef<Set<string>>(new Set())
  const playerModelsRef = useRef<Record<string, { model: PlayerModel; nameSprite: TextSprite }>>({})
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [debugInfo, setDebugInfo] = useState("")
  const controlsRef = useRef<PointerLockControls | null>(null)
  const canvasesRef = useRef<THREE.Mesh[]>([])
  const [showWelcome, setShowWelcome] = useState(true)
  const brushTextRef = useRef<TextSprite | null>(null)

  useEffect(() => {
    if (showWelcome) {
      const timer = setTimeout(() => {
        setShowWelcome(false)
      }, 5000) // Hide after 5 seconds
      return () => clearTimeout(timer)
    }
  }, [showWelcome])

  // Scene setup
  useEffect(() => {
    if (!containerRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xffffff)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    const startPosition = new THREE.Vector3(0, 1.0, 5) // Consistent starting height
    camera.position.copy(startPosition)

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    containerRef.current.appendChild(renderer.domElement)

    // Controls
    const controls = new PointerLockControls(camera, document.body)
    controlsRef.current = controls

    // Movement variables
    const velocity = new THREE.Vector3()
    const direction = new THREE.Vector3()
    let moveForward = false
    let moveBackward = false
    let moveLeft = false
    let moveRight = false
    let canJump = true

    // Raycaster for interactions
    const raycaster = new THREE.Raycaster()

    // Array to store canvases
    const canvases: THREE.Mesh[] = []
    canvasesRef.current = canvases

    // Array to store walls for collision detection
    const walls: THREE.Box3[] = []

    // Player's actual position (for collision detection)
    const playerPosition = playerPositionRef.current.copy(startPosition)

    // Setup event listeners
    const onKeyDown = (event: KeyboardEvent) => {
      if (drawingMode) return

      switch (event.code) {
        case "KeyW":
          moveForward = true
          break
        case "KeyA":
          moveLeft = true
          break
        case "KeyS":
          moveBackward = true
          break
        case "KeyD":
          moveRight = true
          break
        case "Space":
          if (canJump) {
            velocity.y = 4.0
            canJump = false
          }
          break
        case "KeyE":
          // Check if we're looking at a canvas
          if (nearbyCanvas && !drawingMode && controls.isLocked) {
            console.log("Entering drawing mode for canvas:", nearbyCanvas.userData?.id)
            enterDrawingMode(nearbyCanvas)
          } else if ((window as any).currentInteractiveCanvas && !drawingMode && controls.isLocked) {
            // Use the stored canvas reference if available
            console.log(
              "Entering drawing mode for canvas via global reference:",
              (window as any).currentInteractiveCanvas.userData?.id,
            )
            enterDrawingMode((window as any).currentInteractiveCanvas)
          } else if (!drawingMode && controls.isLocked) {
            console.log("Pressed E but no canvas nearby or not eligible:", {
              nearbyCanvas: !!nearbyCanvas,
              drawingMode,
              isLocked: controls.isLocked,
              globalCanvas: !!(window as any).currentInteractiveCanvas,
            })
          }
          break
        // Add debug key to log all players
        case "KeyP":
          debugPlayers()
          break
        // Add reconnect key
        case "KeyR":
          if (event.ctrlKey) {
            forceReconnect()
          }
          break
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (drawingMode) return

      switch (event.code) {
        case "KeyW":
          moveForward = false
          break
        case "KeyA":
          moveLeft = false
          break
        case "KeyS":
          moveBackward = false
          break
        case "KeyD":
          moveRight = false
          break
      }
    }

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("keyup", onKeyUp)
    window.addEventListener("resize", onWindowResize)

    // Lock/unlock controls
    document.addEventListener("click", () => {
      if (!drawingMode && !started) {
        controls.lock()
        setStarted(true)
      }
    })

    controls.addEventListener("lock", () => {
      setStarted(true)
    })

    controls.addEventListener("unlock", () => {
      if (!drawingMode) {
        setStarted(false)
      }
    })

    // Improved lighting
    // Ambient light - increased intensity for better overall lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2) // Further increased intensity
    scene.add(ambientLight)

    // Hemisphere light for more natural lighting
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0xf0f0f0, 0.5) // Increased intensity
    scene.add(hemisphereLight)

    // Create room
    createRoom()

    // Create pill statue
    const pillStatue = new PillStatue()
    scene.add(pillStatue)

    // Add "$brush" text above the pill statue
    const brushText = new TextSprite(
      "$brush",
      new THREE.Vector3(0, 3.5, 0), // Position above the pill statue
      {
        fontSize: 24,
        fontFace: "Arial",
        textColor: { r: 255, g: 255, b: 255, a: 1.0 },
        backgroundColor: { r: 0, g: 0, b: 0, a: 0.5 },
      },
    )
    scene.add(brushText)
    brushTextRef.current = brushText

    // Place canvases
    placeCanvases()

    // Setup peer connection for multiplayer
    setupPeerConnection()

    // Debug function to log all players
    function debugPlayers() {
      console.log("Current players:", players)
      console.log("Known peers:", Array.from(knownPeersRef.current))
      console.log("Active connections:", Object.keys(connectionsRef.current))
      console.log("Pending connections:", pendingConnectionsRef.current)
      console.log("Player models:", playerModelsRef.current)

      // Count player models in scene
      let playerModelCount = 0
      scene.traverse((object) => {
        if (object instanceof PlayerModel) {
          playerModelCount++
        }
      })

      console.log("Player models in scene:", playerModelCount)

      // Update debug info
      setDebugInfo(
        `Players: ${Object.keys(players).length}, Models: ${playerModelCount}, Connections: ${Object.keys(connectionsRef.current).length}`,
      )
    }

    // Expose debug function to window
    window.debugPlayers = debugPlayers

    // Force reconnect function
    function forceReconnect() {
      console.log("Forcing reconnection...")
      setConnectionStatus("Forcing reconnection...")

      // Destroy current peer
      if (peerRef.current) {
        peerRef.current.destroy()
        peerRef.current = null
      }

      // Clear all connections
      connectionsRef.current = {}
      pendingConnectionsRef.current = {}

      // Remove all player models except our own
      Object.entries(playerModelsRef.current).forEach(([id, { model, nameSprite }]) => {
        if (id !== myId) {
          scene.remove(model)
          scene.remove(nameSprite)
          delete playerModelsRef.current[id]
        }
      })

      // Reset players state except our own
      setPlayers((prev) => {
        const newPlayers: Record<string, Player> = {}
        if (myId && prev[myId]) {
          newPlayers[myId] = prev[myId]
        }
        return newPlayers
      })

      // Reset known peers except our own
      knownPeersRef.current = new Set()
      if (myId) {
        knownPeersRef.current.add(myId)
      }

      // Setup new peer connection
      setupPeerConnection()
    }

    // Expose reconnect function to window
    window.forceReconnect = forceReconnect

    // Animation loop
    let prevTime = performance.now()
    let lastUpdateTime = 0

    function animate() {
      requestAnimationFrame(animate)

      // Update pill statue rotation
      pillStatue.rotation.y += 0.005

      // Update the brush text position to hover above the pill statue
      if (brushTextRef.current) {
        brushTextRef.current.position.set(0, 3.5, 0)
        brushTextRef.current.rotation.y += 0.005 // Rotate with the statue
      }

      // Skip movement if controls are not locked
      if (!controls.isLocked) {
        renderer.render(scene, camera)
        return
      }

      const time = performance.now()
      const delta = (time - prevTime) / 1000

      // Movement with collision detection
      velocity.x -= velocity.x * 10.0 * delta
      velocity.z -= velocity.z * 10.0 * delta

      // Gravity
      velocity.y -= 9.8 * delta

      // Get movement direction
      direction.z = Number(moveForward) - Number(moveBackward)
      direction.x = Number(moveRight) - Number(moveLeft)
      direction.normalize()

      // Apply movement
      if (moveForward || moveBackward) velocity.z -= direction.z * 25.0 * delta
      if (moveLeft || moveRight) velocity.x -= direction.x * 25.0 * delta

      // Store old position for collision detection
      const oldPosition = playerPosition.clone()

      // Calculate new position
      const cameraDirection = new THREE.Vector3(0, 0, -1)
      cameraDirection.applyQuaternion(camera.quaternion)
      cameraDirection.y = 0
      cameraDirection.normalize()

      const sidewaysDirection = new THREE.Vector3(-cameraDirection.z, 0, cameraDirection.x)

      // Apply movement in camera direction
      if (moveForward || moveBackward) {
        const movementVector = cameraDirection.clone().multiplyScalar(-velocity.z * delta)
        playerPosition.add(movementVector)
      }

      if (moveLeft || moveRight) {
        const movementVector = sidewaysDirection.clone().multiplyScalar(-velocity.x * delta)
        playerPosition.add(movementVector)
      }

      // Apply gravity
      playerPosition.y += velocity.y * delta

      // Check floor collision
      if (playerPosition.y < startPosition.y) {
        velocity.y = 0
        playerPosition.y = startPosition.y
        canJump = true
      }

      // Check wall collisions
      const playerBoundingSphere = new THREE.Sphere(playerPosition, 0.5)
      let collision = false

      for (let i = 0; i < walls.length; i++) {
        if (walls[i].intersectsSphere(playerBoundingSphere)) {
          collision = true
          break
        }
      }

      if (collision) {
        playerPosition.copy(oldPosition)
      }

      // Update camera position
      controls.getObject().position.copy(playerPosition)

      // Store current rotation
      playerRotationRef.current = camera.rotation.y

      // Update our own player model if it exists
      if (myId && playerModelsRef.current[myId]) {
        const { model, nameSprite } = playerModelsRef.current[myId]
        model.position.copy(playerPosition)
        model.rotation.y = camera.rotation.y
        nameSprite.position.set(
          playerPosition.x,
          playerPosition.y + 2.9, // Increased height for name tag
          playerPosition.z,
        )
      }

      // Check for canvas interaction
      checkCanvasInteraction()

      // Send position update to peers (limit to 10 updates per second)
      if (time - lastUpdateTime > 100 && peerRef.current) {
        lastUpdateTime = time

        // Send position update to all connected peers
        Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
          if (conn.open) {
            try {
              conn.send({
                type: "playerMove",
                data: {
                  position: {
                    x: playerPosition.x,
                    y: playerPosition.y,
                    z: playerPosition.z,
                  },
                  rotation: camera.rotation.y,
                },
              })
            } catch (err) {
              console.error(`Error sending position update to ${peerId}:`, err)
            }
          }
        })
      }

      prevTime = time
      renderer.render(scene, camera)
    }

    function createRoom() {
      // Room dimensions
      const roomSize = 30
      const wallHeight = 14
      const halfSize = roomSize / 2

      // Floor
      const floorGeometry = new THREE.PlaneGeometry(roomSize, roomSize)
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x2196f3,
        roughness: 0.2,
        metalness: 0.1,
      })

      const floor = new THREE.Mesh(floorGeometry, floorMaterial)
      floor.rotation.x = -Math.PI / 2
      floor.position.y = 0
      floor.receiveShadow = true
      scene.add(floor)

      // Walls
      createWall(0, wallHeight / 2, -halfSize, roomSize, wallHeight, 0.3, halfSize) // North
      createWall(0, wallHeight / 2, halfSize, roomSize, wallHeight, 0.3, halfSize) // South
      createWall(halfSize, wallHeight / 2, 0, 0.3, wallHeight, roomSize, halfSize) // East
      createWall(-halfSize, wallHeight / 2, 0, 0.3, wallHeight, roomSize, halfSize) // West

      // Ceiling
      const ceilingGeometry = new THREE.PlaneGeometry(roomSize, roomSize)
      const ceilingMaterial = new THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.1,
      })

      const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial)
      ceiling.rotation.x = Math.PI / 2
      ceiling.position.y = wallHeight
      ceiling.receiveShadow = true
      scene.add(ceiling)

      // Track lighting
      const trackWidth = 0.4
      const trackDepth = roomSize * 0.8
      const trackSpacing = roomSize / 3

      for (let i = -1; i <= 1; i += 2) {
        const trackGeometry = new THREE.BoxGeometry(trackWidth, 0.2, trackDepth)
        const trackMaterial = new THREE.MeshStandardMaterial({
          color: 0x888888,
          roughness: 0.2,
          metalness: 0.8,
        })

        const track = new THREE.Mesh(trackGeometry, trackMaterial)
        track.position.set((i * trackSpacing) / 2, wallHeight - 0.1, 0)
        track.castShadow = true
        scene.add(track)

        // Add lights
        const numLights = 6 // Increased from 4 to 6
        const lightSpacing = trackDepth / numLights

        for (let j = 0; j < numLights; j++) {
          const lightZ = -trackDepth / 2 + j * lightSpacing + lightSpacing / 2

          // Light fixture
          const fixtureGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16)
          const fixtureMaterial = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.2,
            metalness: 0.9,
          })

          const fixture = new THREE.Mesh(fixtureGeometry, fixtureMaterial)
          fixture.position.set((i * trackSpacing) / 2, wallHeight - 0.3, lightZ)
          fixture.rotation.x = Math.PI / 2
          fixture.castShadow = true
          scene.add(fixture)

          // Spotlight - increased intensity
          const spotlight = new THREE.SpotLight(0xffffff, 1.2) // Increased intensity
          spotlight.position.set((i * trackSpacing) / 2, wallHeight - 0.4, lightZ)

          const targetX = (i * trackSpacing) / 2
          const targetY = 0.5
          const targetZ = lightZ

          spotlight.target.position.set(targetX, targetY, targetZ)
          spotlight.angle = Math.PI / 7 // Wider angle
          spotlight.penumbra = 0.4
          spotlight.decay = 1.3
          spotlight.distance = 20 // Increased distance

          spotlight.castShadow = true // All lights cast shadows now

          spotlight.shadow.mapSize.width = 256
          spotlight.shadow.mapSize.height = 256
          spotlight.shadow.camera.near = 0.5
          spotlight.shadow.camera.far = 20

          scene.add(spotlight)
          scene.add(spotlight.target)
        }
      }

      // Add some additional point lights for better overall lighting
      const pointLightColors = [0xffcc77, 0x77ccff, 0xff77cc, 0x77ffcc]

      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2
        const radius = roomSize / 3

        const pointLight = new THREE.PointLight(pointLightColors[i], 0.5, 15)
        pointLight.position.set(Math.cos(angle) * radius, wallHeight / 2, Math.sin(angle) * radius)

        scene.add(pointLight)
      }
    }

    function createWall(
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      depth: number,
      halfSize: number,
    ) {
      const geometry = new THREE.BoxGeometry(width, height, depth)
      const material = new THREE.MeshStandardMaterial({
        color: z === halfSize ? 0xf0f0f0 : 0xffffff,
        roughness: 0.1,
        metalness: 0.0,
      })

      const wall = new THREE.Mesh(geometry, material)
      wall.position.set(x, y, z)
      wall.castShadow = true
      wall.receiveShadow = true
      scene.add(wall)

      // Add to collision detection
      const wallBox = new THREE.Box3().setFromObject(wall)
      walls.push(wallBox)
    }

    function placeCanvases() {
      // Room dimensions
      const roomSize = 30
      const halfSize = roomSize / 2
      const wallHeight = 14

      // Canvas settings
      const canvasWidth = 2
      const canvasHeight = 1.5
      const canvasSpacing = 5
      const canvasesPerWall = 4
      const canvasVerticalPosition = 2 // Height from floor

      // Calculate positions
      const wallLength = roomSize - 2
      const totalWidth = canvasesPerWall * (canvasWidth + canvasSpacing) - canvasSpacing
      const startOffset = (wallLength - totalWidth) / 2 + canvasWidth / 2

      // Place canvases on all walls
      for (let i = 0; i < canvasesPerWall; i++) {
        // Calculate position for this canvas
        const position = startOffset + i * (canvasWidth + canvasSpacing)

        // North wall
        createCanvas(
          -halfSize + position, // x
          canvasVerticalPosition, // y
          -halfSize + 0.15, // z - slightly offset from wall
          0,
          0,
          0, // rotation
          `north-${i}`,
        )

        // South wall
        createCanvas(
          -halfSize + position, // x
          canvasVerticalPosition, // y
          halfSize - 0.15, // z - slightly offset from wall
          Math.PI,
          0,
          0, // rotation
          `south-${i}`,
        )

        // East wall
        createCanvas(
          halfSize - 0.15, // x - slightly offset from wall
          canvasVerticalPosition, // y
          -halfSize + position, // z
          -Math.PI / 2,
          0,
          0, // rotation
          `east-${i}`,
        )

        // West wall
        createCanvas(
          -halfSize + 0.15, // x - slightly offset from wall
          canvasVerticalPosition, // y
          -halfSize + position, // z
          Math.PI / 2,
          0,
          0, // rotation
          `west-${i}`,
        )
      }
    }

    function createCanvas(
      x: number,
      y: number,
      z: number,
      rotationY: number,
      rotationX: number,
      rotationZ: number,
      id: string,
    ) {
      function setupDefaultCanvas(ctx: CanvasRenderingContext2D) {
        // Fill with white
        ctx.fillStyle = "white"
        ctx.fillRect(0, 0, 1024, 768)

        // Add grid pattern
        ctx.strokeStyle = "#f0f0f0"
        ctx.lineWidth = 1

        // Grid lines
        for (let x = 0; x <= 1024; x += 50) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, 768)
          ctx.stroke()
        }

        for (let y = 0; y <= 768; y += 50) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(1024, y)
          ctx.stroke()
        }

        // Add a prompt text with updated instructions
        ctx.fillStyle = "#888888"
        ctx.font = "30px Arial"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("Press E or click to draw", 1024 / 2, 768 / 2)
      }

      // Frame
      const frameGeometry = new THREE.BoxGeometry(2.4, 1.8, 0.05)
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.05,
        metalness: 0.1,
      })

      const frame = new THREE.Mesh(frameGeometry, frameMaterial)
      frame.position.set(x, y, z)
      frame.rotation.set(rotationX, rotationY, rotationZ)
      frame.castShadow = true
      frame.receiveShadow = true
      scene.add(frame)

      // Canvas surface
      const canvasGeometry = new THREE.PlaneGeometry(2, 1.5)

      // Create a blank canvas texture or load from localStorage
      const offScreenCanvas = document.createElement("canvas")
      offScreenCanvas.width = 1024
      offScreenCanvas.height = 768
      const offCtx = offScreenCanvas.getContext("2d")

      if (offCtx) {
        // Try to load saved canvas data
        const savedDataString = localStorage.getItem(`canvas-${id}`)

        if (savedDataString) {
          try {
            const savedData = JSON.parse(savedDataString)
            const currentTime = Date.now()
            // Check if data is less than 30 minutes old (1800000 ms)
            if (savedData.timestamp && currentTime - savedData.timestamp < 1800000) {
              // Load the saved image
              const img = new Image()
              img.crossOrigin = "anonymous"
              img.onload = () => {
                offCtx.drawImage(img, 0, 0)
                canvasTexture.needsUpdate = true
              }
              img.src = savedData.imageData
            } else {
              // Data is too old, clear it
              localStorage.removeItem(`canvas-${id}`)
              setupDefaultCanvas(offCtx)
            }
          } catch (e) {
            console.error("Error parsing saved canvas data:", e)
            setupDefaultCanvas(offCtx)
          }
        } else {
          setupDefaultCanvas(offCtx)
        }
      }

      const canvasTexture = new THREE.CanvasTexture(offScreenCanvas)

      const canvasMaterial = new THREE.MeshBasicMaterial({
        map: canvasTexture,
        side: THREE.DoubleSide,
      })

      const canvas = new THREE.Mesh(canvasGeometry, canvasMaterial)
      canvas.position.set(x, y, z)
      canvas.rotation.set(rotationX, rotationY, rotationZ)

      // Adjust position to avoid z-fighting - make this more precise
      const offset = 0.03 // Reduced offset for better alignment
      if (Math.abs(rotationY) === Math.PI / 2) {
        // East/West walls
        canvas.position.x += rotationY > 0 ? offset : -offset
      } else if (Math.abs(rotationY) === Math.PI || rotationY === 0) {
        // North/South walls
        canvas.position.z += rotationY === 0 ? offset : -offset
      }

      // Store canvas and context for drawing
      canvas.userData = {
        offScreenCanvas,
        offCtx,
        id,
      }

      scene.add(canvas)
      canvases.push(canvas)
    }

    function checkCanvasInteraction() {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)

      const intersects = raycaster.intersectObjects(canvases)

      if (intersects.length > 0 && intersects[0].distance < 3) {
        const canvasObject = intersects[0].object as THREE.Mesh
        setNearbyCanvas(canvasObject)
        setInteractionPrompt("Press E or click to draw on canvas")

        // Add mouse click support for canvas interaction
        const handleClick = () => {
          if (controls.isLocked && !drawingMode) {
            console.log("Mouse clicked on canvas:", canvasObject.userData?.id)
            enterDrawingMode(canvasObject)
          }
        }

        // Add the event listener once
        document.addEventListener("click", handleClick, { once: true })

        // Store the current canvas for E key interaction
        window.currentInteractiveCanvas = canvasObject
      } else {
        setNearbyCanvas(null)
        setInteractionPrompt("")
        window.currentInteractiveCanvas = null
      }
    }

    function enterDrawingMode(canvasObj: THREE.Mesh) {
      // Make sure to unlock controls first
      controls.unlock()

      // Set a small timeout to ensure the unlock is processed before setting drawing mode
      setTimeout(() => {
        setDrawingMode(true)
        setCurrentCanvas(canvasObj)

        // Explicitly make cursor visible
        document.body.style.cursor = "auto"
      }, 100)
    }

    function setupPeerConnection() {
      // Generate a random peer ID with a prefix to avoid collisions
      const randomId = `gallery-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`

      // Generate a random color for this player
      const playerColor = getRandomColor()

      // Create a new Peer with more reliable configuration
      const peer = new Peer(randomId, {
        debug: 1, // Reduced debug level
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "stun:stun3.l.google.com:19302" },
            { urls: "stun:stun4.l.google.com:19302" },
          ],
        },
      })

      peerRef.current = peer

      // On connection established
      peer.on("open", (id) => {
        console.log("My peer ID is:", id)
        setMyId(id)
        setConnectionStatus("Connected as: " + id)

        // Add ourselves to known peers
        knownPeersRef.current.add(id)

        // Create a player model for ourselves
        createPlayerModel(id, username, playerColor, playerPosition)

        // Join the gallery by connecting to peers from URL
        joinGallery(id)
      })

      // Handle incoming connections
      peer.on("connection", (conn) => {
        console.log("Incoming connection from:", conn.peer)
        setConnectionStatus("Incoming connection from: " + conn.peer)

        // Store the connection
        connectionsRef.current[conn.peer] = conn

        // Mark as no longer pending
        delete pendingConnectionsRef.current[conn.peer]

        // Handle data from this peer
        setupConnectionHandlers(conn)
      })

      // Handle errors
      peer.on("error", (err) => {
        console.error("Peer error:", err)
        setConnectionStatus("Error: " + err.type)

        // If it's a network error, try to reconnect
        if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") {
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("Attempting to reconnect after error...")
            setConnectionStatus("Reconnecting after error...")
            forceReconnect()
          }, 5000)
        }
      })

      // Handle disconnection
      peer.on("disconnected", () => {
        console.log("Disconnected from server. Attempting to reconnect...")
        setConnectionStatus("Disconnected from server. Attempting to reconnect...")

        // Try to reconnect
        peer.reconnect()

        // If reconnection fails, force a full reconnect after a timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (peer.disconnected) {
            console.log("Reconnection failed. Forcing full reconnect...")
            forceReconnect()
          }
        }, 5000)
      })

      return peer
    }

    function createPlayerModel(id: string, playerName: string, color: string, position: THREE.Vector3) {
      // Remove existing model if it exists
      if (playerModelsRef.current[id]) {
        scene.remove(playerModelsRef.current[id].model)
        scene.remove(playerModelsRef.current[id].nameSprite)
      }

      // Create new player model with fixed height to ensure consistent positioning
      const fixedPosition = new THREE.Vector3(position.x, 1.0, position.z) // Set a consistent height of 1.0
      const playerModel = new PlayerModel(color, fixedPosition)

      const nameSprite = new TextSprite(
        playerName,
        new THREE.Vector3(
          fixedPosition.x,
          fixedPosition.y + 2.5, // Consistent height above player
          fixedPosition.z,
        ),
      )

      scene.add(playerModel)
      scene.add(nameSprite)

      // Store the model and sprite
      playerModelsRef.current[id] = {
        model: playerModel,
        nameSprite,
      }

      // Update players state
      setPlayers((prev) => ({
        ...prev,
        [id]: {
          id,
          username: playerName,
          position: fixedPosition,
          rotation: 0,
          color,
          model: playerModel,
          nameSprite,
        },
      }))

      return { model: playerModel, nameSprite }
    }

    function joinGallery(peerId: string) {
      // Check if there's a peer ID in the URL to connect to
      const urlParams = new URLSearchParams(window.location.search)
      const connectToPeer = urlParams.get("p") || urlParams.get("peer") // Support both formats

      if (connectToPeer && connectToPeer !== peerId) {
        // Connect to the specified peer(s)
        connectToPeer.split(",").forEach((targetPeerId) => {
          if (targetPeerId && targetPeerId !== peerId) {
            connectToPeerById(targetPeerId)
          }
        })

        // Request all canvas data after a delay to ensure connections are established
        setTimeout(() => {
          console.log("Initial canvas data request after joining")
          requestAllCanvasData()

          // Make additional requests to ensure we get everything
          setTimeout(() => {
            console.log("Follow-up canvas data request")
            requestAllCanvasData()
          }, 5000)

          setTimeout(() => {
            console.log("Final canvas data request")
            requestAllCanvasData()
          }, 10000)
        }, 2000)
      }

      // Update the URL with our peer ID for others to connect
      const baseUrl = window.location.origin + window.location.pathname
      const newUrl = `${baseUrl}?p=${peerId}`
      window.history.replaceState({}, "", newUrl)

      // Display connection info
      console.log("Share this URL for others to join:", window.location.href)
      setConnectionStatus("Share URL: " + window.location.href)
    }

    function connectToPeerById(targetPeerId: string) {
      if (!peerRef.current || pendingConnectionsRef.current[targetPeerId]) return

      console.log("Connecting to peer:", targetPeerId)
      setConnectionStatus("Connecting to: " + targetPeerId)

      // Mark as pending
      pendingConnectionsRef.current[targetPeerId] = true

      try {
        // Connect to the target peer
        const conn = peerRef.current.connect(targetPeerId, {
          reliable: true,
          serialization: "json",
        })

        // Store the connection
        connectionsRef.current[targetPeerId] = conn

        // Setup handlers for this connection
        setupConnectionHandlers(conn)

        // Set a timeout to clear pending status if connection fails
        setTimeout(() => {
          if (pendingConnectionsRef.current[targetPeerId]) {
            console.log("Connection to", targetPeerId, "timed out")
            delete pendingConnectionsRef.current[targetPeerId]

            // Try to reconnect
            if (!connectionsRef.current[targetPeerId]?.open) {
              delete connectionsRef.current[targetPeerId]
              connectToPeerById(targetPeerId)
            }
          }
        }, 10000)
      } catch (err) {
        console.error("Error connecting to peer:", err)
        delete pendingConnectionsRef.current[targetPeerId]
      }
    }

    function setupConnectionHandlers(conn: Peer.DataConnection) {
      // Handle connection open
      conn.on("open", () => {
        console.log("Connection established with:", conn.peer)
        setConnectionStatus("Connected to: " + conn.peer)

        // No longer pending
        delete pendingConnectionsRef.current[conn.peer]

        // Add to known peers
        knownPeersRef.current.add(conn.peer)

        // Send our player info
        try {
          conn.send({
            type: "playerInfo",
            data: {
              id: peerRef.current?.id,
              username,
              position: {
                x: playerPosition.x,
                y: playerPosition.y,
                z: playerPosition.z,
              },
              rotation: playerRotationRef.current,
              color: playerModelsRef.current[myId]?.model
                ? (playerModelsRef.current[myId].model as any).material?.color?.getHexString()
                : getRandomColor(),
            },
          })
        } catch (err) {
          console.error("Error sending player info:", err)
        }

        // Request peer list
        try {
          conn.send({
            type: "requestPeerList",
            data: {},
          })
        } catch (err) {
          console.error("Error requesting peer list:", err)
        }

        // Send canvas data with improved reliability
        console.log("Sending all canvas data to new peer")

        // Add a small delay to ensure connection is ready
        setTimeout(() => {
          canvases.forEach((canvas) => {
            const canvasId = canvas.userData.id
            const savedDataString = localStorage.getItem(`canvas-${canvasId}`)

            if (savedDataString) {
              try {
                const savedData = JSON.parse(savedDataString)
                // Only send if the data isn't too old
                const currentTime = Date.now()
                if (savedData.timestamp && currentTime - savedData.timestamp < 1800000) {
                  console.log(`Sending canvas data for ${canvasId} to new peer`)
                  try {
                    conn.send({
                      type: "canvasData",
                      data: {
                        canvasId,
                        imageData: JSON.stringify(savedData),
                      },
                    })
                  } catch (e) {
                    console.error(`Error sending canvas data for ${canvasId}:`, e)
                  }
                }
              } catch (err) {
                console.error(`Error processing canvas data for ${canvasId}:`, err)
              }
            }
          })

          // Request canvas data from the peer as well (in case they have newer drawings)
          try {
            conn.send({
              type: "requestAllCanvasData",
              data: {
                requesterId: myId,
              },
            })
          } catch (err) {
            console.error("Error requesting canvas data:", err)
          }
        }, 1000)
      })

      // Handle data messages
      conn.on("data", (data: any) => {
        try {
          // Handle different message types
          switch (data.type) {
            case "playerInfo":
              // Skip if this is our own ID to prevent duplicate player models
              if (data.data.id === myId) {
                console.log("Received my own player info, ignoring to prevent duplication")
                return
              }
              handlePlayerInfo(data.data)
              break

            case "playerMove":
              handlePlayerMove(conn.peer, data.data)
              break

            case "canvasData":
              handleCanvasData(data.data)
              break

            case "updateCanvas":
              handleCanvasUpdate(data.data)
              break

            case "playerLeft":
              handlePlayerLeft(data.data.id)
              break

            case "requestPeerList":
              // Send our list of known peers to the requester
              if (conn.open) {
                try {
                  conn.send({
                    type: "peerList",
                    data: {
                      peers: Array.from(knownPeersRef.current),
                    },
                  })
                } catch (err) {
                  console.error("Error sending peer list:", err)
                }
              }
              break

            case "peerList":
              // Connect to all peers we don't know yet
              if (data.data.peers && Array.isArray(data.data.peers)) {
                data.data.peers.forEach((peerId: string) => {
                  // Skip ourselves and peers we already know
                  if (
                    peerId !== myId &&
                    !knownPeersRef.current.has(peerId) &&
                    !connectionsRef.current[peerId] &&
                    !pendingConnectionsRef.current[peerId]
                  ) {
                    console.log("Discovered new peer from peer list:", peerId)
                    connectToPeerById(peerId)
                  }
                })
              }
              break
            case "requestAllCanvasData":
              // Send all our canvas data to the requester
              console.log("Received request for all canvas data")
              canvases.forEach((canvas) => {
                const canvasId = canvas.userData.id
                const savedDataString = localStorage.getItem(`canvas-${canvasId}`)

                if (savedDataString) {
                  try {
                    const savedData = JSON.parse(savedDataString)
                    // Only send if the data isn't too old
                    const currentTime = Date.now()
                    if (savedData.timestamp && currentTime - savedData.timestamp < 1800000) {
                      console.log(`Sending canvas data for ${canvasId} in response to request`)
                      conn.send({
                        type: "canvasData",
                        data: {
                          canvasId,
                          imageData: savedData.imageData,
                        },
                      })
                    }
                  } catch (err) {
                    console.error(`Error sending canvas data for ${canvasId}:`, err)
                  }
                }
              })
              break
          }
        } catch (err) {
          console.error("Error handling data:", err)
        }
      })

      // Handle connection close
      conn.on("close", () => {
        console.log("Connection closed with peer:", conn.peer)
        setConnectionStatus("Connection closed with: " + conn.peer)

        // Remove the connection
        delete connectionsRef.current[conn.peer]
        delete pendingConnectionsRef.current[conn.peer]

        // Remove the player
        handlePlayerLeft(conn.peer)

        // Remove from known peers
        knownPeersRef.current.delete(conn.peer)
      })

      // Handle connection errors
      conn.on("error", (err) => {
        console.error("Connection error with", conn.peer, ":", err)
        setConnectionStatus("Connection error with " + conn.peer)

        // Remove pending status
        delete pendingConnectionsRef.current[conn.peer]

        // Try to reconnect if the connection is not open
        if (!conn.open) {
          delete connectionsRef.current[conn.peer]

          // Wait a bit before trying to reconnect
          setTimeout(() => {
            if (knownPeersRef.current.has(conn.peer) && !connectionsRef.current[conn.peer]) {
              console.log("Attempting to reconnect to", conn.peer)
              connectToPeerById(conn.peer)
            }
          }, 3000)
        }
      })
    }

    function requestAllCanvasData() {
      console.log("Requesting all canvas data from peers")

      // Add a flag to localStorage to track that we've requested data
      localStorage.setItem("canvas-data-requested", "true")

      // Request from all connected peers
      Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
        if (conn.open) {
          try {
            console.log(`Requesting canvas data from peer: ${peerId}`)
            conn.send({
              type: "requestAllCanvasData",
              data: {
                requesterId: myId,
              },
            })
          } catch (err) {
            console.error(`Error requesting canvas data from ${peerId}:`, err)
          }
        }
      })

      // Set a timeout to check if we received any data
      setTimeout(() => {
        if (localStorage.getItem("canvas-data-requested") === "true") {
          console.log("Canvas data request timeout - trying again")
          localStorage.removeItem("canvas-data-requested")
          // Try again if we have connections
          if (Object.keys(connectionsRef.current).length > 0) {
            requestAllCanvasData()
          }
        }
      }, 5000)
    }

    function handleCanvasData(data: any) {
      if (!data || !data.canvasId) {
        console.error("Invalid canvas data received:", data)
        return
      }

      const { canvasId, imageData } = data
      console.log(`Received canvas data for ${canvasId}`)

      // Mark that we've received data
      localStorage.removeItem("canvas-data-requested")

      // Find the canvas
      const canvas = canvases.find((c) => c.userData.id === canvasId)
      if (!canvas) {
        console.error(`Canvas with id ${canvasId} not found`)
        return
      }

      // Update the canvas texture
      const offScreenCanvas = canvas.userData.offScreenCanvas
      const offCtx = offScreenCanvas.getContext("2d")

      if (offCtx) {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
          // Clear the canvas first to ensure clean drawing
          offCtx.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)
          offCtx.fillStyle = "white"
          offCtx.fillRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)

          // Draw the received image
          offCtx.drawImage(img, 0, 0)

          // Update the texture
          const texture = (canvas.material as THREE.MeshBasicMaterial).map
          if (texture) {
            texture.needsUpdate = true
          }

          // Save to localStorage with timestamp to allow for expiration
          const canvasData = {
            imageData: img.src,
            timestamp: Date.now(),
          }
          localStorage.setItem(`canvas-${canvasId}`, JSON.stringify(canvasData))
          console.log(`Updated canvas ${canvasId} with received data`)
        }

        img.onerror = (err) => {
          console.error(`Error loading image for canvas ${canvasId}:`, err)
        }

        // Handle both direct image data and JSON strings
        try {
          if (typeof imageData === "string") {
            try {
              // Try to parse as JSON first
              const parsed = JSON.parse(imageData)
              img.src = parsed.imageData || imageData
            } catch (e) {
              // If not JSON, use directly
              img.src = imageData
            }
          } else if (imageData && imageData.imageData) {
            img.src = imageData.imageData
          }
        } catch (err) {
          console.error(`Error processing image data for canvas ${canvasId}:`, err)
        }
      }
    }

    function handleCanvasUpdate(data: any) {
      // First update our own canvas
      handleCanvasData(data)

      // Then forward to all other peers to ensure everyone has the latest drawing
      console.log(`Forwarding canvas update for ${data.canvasId} to all peers`)
      Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
        if (conn.open) {
          try {
            conn.send({
              type: "canvasData", // Use canvasData type for consistency
              data: {
                canvasId: data.canvasId,
                imageData: data.imageData,
              },
            })
          } catch (err) {
            console.error(`Error forwarding canvas update to ${peerId}:`, err)
          }
        }
      })
    }

    function handlePlayerLeft(playerId: string) {
      if (!playerId) return

      console.log("Player left:", playerId)

      // Remove player model and sprite from scene
      if (playerModelsRef.current[playerId]) {
        scene.remove(playerModelsRef.current[playerId].model)
        scene.remove(playerModelsRef.current[playerId].nameSprite)
        delete playerModelsRef.current[playerId]
      }

      // Remove from players state
      setPlayers((prev) => {
        const newPlayers = { ...prev }
        delete newPlayers[playerId]
        return newPlayers
      })

      // Remove from known peers
      knownPeersRef.current.delete(playerId)
    }

    // Helper function to generate random color
    function getRandomColor() {
      const letters = "0123456789ABCDEF"
      let color = "#"
      for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)]
      }
      return color
    }

    // Expose functions to React component
    window.exitDrawingMode = (drawingCanvas: HTMLCanvasElement) => {
      if (!currentCanvas) return

      // Get the canvas data
      const canvasId = currentCanvas.userData.id
      const offScreenCanvas = currentCanvas.userData.offScreenCanvas
      const offCtx = offScreenCanvas.getContext("2d")

      if (offCtx) {
        // Clear the canvas first
        offCtx.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)
        offCtx.fillStyle = "white"
        offCtx.fillRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)

        // Copy drawing to the texture
        offCtx.drawImage(drawingCanvas, 0, 0, offScreenCanvas.width, offScreenCanvas.height)

        // Update the texture
        const texture = (currentCanvas.material as THREE.MeshBasicMaterial).map
        if (texture) {
          texture.needsUpdate = true
        }

        // Save to localStorage with timestamp
        const imageData = offScreenCanvas.toDataURL("image/png")
        const canvasData = {
          imageData,
          timestamp: Date.now(),
        }
        localStorage.setItem(`canvas-${canvasId}`, JSON.stringify(canvasData))

        // Broadcast to all peers
        console.log(`Broadcasting canvas update for ${canvasId} to all peers from exitDrawingMode`)
        Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
          if (conn.open) {
            try {
              conn.send({
                type: "updateCanvas",
                data: {
                  canvasId,
                  imageData: JSON.stringify(canvasData),
                },
              })
            } catch (err) {
              console.error(`Error sending canvas update to ${peerId}:`, err)
            }
          }
        })
      }

      // Reset drawing mode
      setDrawingMode(false)
      setCurrentCanvas(null)
      controlsRef.current?.lock()
    }

    // Function to handle player info
    const handlePlayerInfo = (data: any) => {
      const { id, username, position, rotation, color } = data

      // Skip if this is our own ID to prevent duplicate player models
      if (id === myId) {
        console.log("Received my own player info, ignoring to prevent duplication")
        return
      }

      // Check if the player already exists
      if (playerModelsRef.current[id]) {
        console.log(`Player ${id} already exists, updating info`)
        // Update existing player model
        const { model, nameSprite } = playerModelsRef.current[id]
        model.position.copy(new THREE.Vector3(position.x, position.y, position.z))
        model.rotation.y = rotation
        nameSprite.position.set(position.x, position.y + 2.5, position.z)

        // Update players state
        setPlayers((prev) => ({
          ...prev,
          [id]: {
            id,
            username,
            position: new THREE.Vector3(position.x, position.y, position.z),
            rotation,
            color,
            model,
            nameSprite,
          },
        }))
      } else {
        // Create a new player model
        console.log(`Creating new player model for ${id}`)
        const { model, nameSprite } = createPlayerModel(
          id,
          username,
          color,
          new THREE.Vector3(position.x, position.y, position.z),
        )

        // Update players state
        setPlayers((prev) => ({
          ...prev,
          [id]: {
            id,
            username,
            position: new THREE.Vector3(position.x, position.y, position.z),
            rotation,
            color,
            model,
            nameSprite,
          },
        }))
      }
    }

    // Function to handle player movement
    const handlePlayerMove = (peerId: string, data: any) => {
      if (!peerId) return

      // Find the player model
      const playerModel = playerModelsRef.current[peerId]?.model
      const nameSprite = playerModelsRef.current[peerId]?.nameSprite

      if (playerModel) {
        // Update position and rotation
        playerModel.position.set(data.position.x, data.position.y, data.position.z)
        playerModel.rotation.y = data.rotation

        // Update name sprite position
        if (nameSprite) {
          nameSprite.position.set(data.position.x, data.position.y + 2.5, data.position.z)
        }

        // Update players state
        setPlayers((prev) => {
          if (!prev[peerId]) return prev
          return {
            ...prev,
            [peerId]: {
              ...prev[peerId],
              position: new THREE.Vector3(data.position.x, data.position.y, data.position.z),
              rotation: data.rotation,
            },
          }
        })
      }
    }

    // Start animation loop
    animate()

    return () => {
      console.log("Cleaning up gallery component")

      // Remove event listeners
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("resize", onWindowResize)

      // Dispose of renderer
      if (renderer) {
        renderer.dispose()
      }

      // Remove canvas element
      if (containerRef.current && containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild)
      }

      // Clean up peer connections
      if (peerRef.current) {
        Object.values(connectionsRef.current).forEach((conn) => {
          try {
            conn.close()
          } catch (e) {
            console.error("Error closing connection:", e)
          }
        })

        peerRef.current.destroy()
      }

      // Clear any timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [username])

  // Improved function to handle canvas drawing interface
  const handleDrawingComplete = (imageData: string) => {
    if (!currentCanvas) return

    const canvasId = currentCanvas.userData.id
    console.log(`Drawing completed for canvas ${canvasId}`)

    // Save to localStorage with timestamp
    const canvasData = {
      imageData,
      timestamp: Date.now(),
    }
    localStorage.setItem(`canvas-${canvasId}`, JSON.stringify(canvasData))

    // Update the canvas texture
    const offScreenCanvas = currentCanvas.userData.offScreenCanvas
    const offCtx = offScreenCanvas.getContext("2d")

    if (offCtx) {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        // Clear the canvas first
        offCtx.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)
        offCtx.fillStyle = "white"
        offCtx.fillRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)

        // Draw the image
        offCtx.drawImage(img, 0, 0, offScreenCanvas.width, offScreenCanvas.height)

        // Update the texture
        const texture = (currentCanvas.material as THREE.MeshBasicMaterial).map
        if (texture) {
          texture.needsUpdate = true
        }

        // Broadcast to all peers
        console.log(`Broadcasting canvas update for ${canvasId} to all peers from handleDrawingComplete`)
        Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
          if (conn.open) {
            try {
              conn.send({
                type: "updateCanvas",
                data: {
                  canvasId,
                  imageData: JSON.stringify(canvasData),
                },
              })
            } catch (err) {
              console.error(`Error sending canvas update to ${peerId}:`, err)
            }
          }
        })
      }
      img.src = imageData
    }

    // Reset drawing mode
    setDrawingMode(false)
    setCurrentCanvas(null)
    controlsRef.current?.lock()
  }

  // Function to handle saving drawing from the new drawing interface
  const handleSaveDrawing = (imageData: string) => {
    if (!currentCanvas) return

    // Get the canvas data
    const canvasId = currentCanvas.userData.id
    const offScreenCanvas = currentCanvas.userData.offScreenCanvas
    const offCtx = offScreenCanvas.getContext("2d")

    if (offCtx) {
      // Load the image data into the texture
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        // Clear the canvas first
        offCtx.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)
        offCtx.fillStyle = "white"
        offCtx.fillRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)

        // Draw the received image
        offCtx.drawImage(img, 0, 0)

        // Update the texture
        const texture = (currentCanvas.material as THREE.MeshBasicMaterial).map
        if (texture) {
          texture.needsUpdate = true
        }

        // Save to localStorage with timestamp
        const canvasData = {
          imageData,
          timestamp: Date.now(),
        }
        localStorage.setItem(`canvas-${canvasId}`, JSON.stringify(canvasData))

        // Broadcast to all peers
        console.log(`Broadcasting canvas update for ${canvasId} to all peers`)
        Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
          if (conn.open) {
            try {
              conn.send({
                type: "updateCanvas",
                data: {
                  canvasId,
                  imageData,
                },
              })
            } catch (err) {
              console.error(`Error sending canvas update to ${peerId}:`, err)
            }
          }
        })
      }
      img.src = imageData
    }
  }

  // Function to handle closing the drawing interface
  const handleCloseDrawing = () => {
    setDrawingMode(false)
    setCurrentCanvas(null)

    // Re-lock controls after a short delay to ensure UI state is updated
    setTimeout(() => {
      if (controlsRef.current) {
        controlsRef.current.lock()
      }
    }, 200)
  }

  return (
    <div ref={containerRef} className="h-screen w-screen">
      {showWelcome && (
        <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none z-50">
          <div className="bg-black bg-opacity-70 text-white px-8 py-6 rounded-lg text-center transform transition-all duration-500 ease-in-out">
            <h1 className="text-3xl font-bold mb-2">Welcome to the "Brush" Art Gallery</h1>
            <p className="text-lg">Explore, create, and share your art with others</p>
          </div>
        </div>
      )}
      {!started && !drawingMode && <Instructions onClick={() => {}} />}

      {interactionPrompt && <InteractionPrompt text={interactionPrompt} />}

      {/* Use our new drawing interface instead of the old one */}
      {drawingMode && currentCanvas && (
        <NewDrawingInterface
          canvasId={currentCanvas.userData.id}
          onSave={handleSaveDrawing}
          onClose={handleCloseDrawing}
        />
      )}

      {myId && (
        <div className="absolute bottom-4 left-4 z-10 rounded bg-black/70 p-2 text-white">
          <p>Share this URL for others to join:</p>
          <p className="text-xs">{window.location.href}</p>
          <p className="mt-2 text-xs">Connection status: {connectionStatus}</p>
          <p className="text-xs">Connected players: {Object.keys(players).length}</p>
          <p className="text-xs">Debug: {debugInfo}</p>
          <p className="text-xs">Press P to debug connections</p>
          <p className="text-xs">Press Ctrl+R to force reconnect</p>
        </div>
      )}
    </div>
  )
}

