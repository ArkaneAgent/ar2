"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls"
import { PillStatue } from "@/components/pill-statue"
import { Instructions } from "@/components/instructions"
import { InteractionPrompt } from "@/components/interaction-prompt"
import { DrawingInterface } from "@/components/drawing-interface"
import { PlayerModel } from "@/components/player-model"
import { TextSprite } from "@/components/text-sprite"
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

  // Scene setup
  useEffect(() => {
    if (!containerRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xffffff)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    const startPosition = new THREE.Vector3(0, 1.6, 5)
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
        case "KeyR":
          if (nearbyCanvas && !drawingMode && controls.isLocked) {
            console.log("Entering drawing mode for canvas:", nearbyCanvas.userData?.id)
            enterDrawingMode(nearbyCanvas)
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

    // Place canvases
    placeCanvases()

    // Setup peer connection for multiplayer
    setupPeerConnection()

    // Add a debug function to log connection status
    function logConnectionStatus() {
      console.log("=== CONNECTION STATUS ===")
      console.log("My ID:", myId)
      console.log("Peer instance exists:", !!peerRef.current)
      console.log("Known peers:", Array.from(knownPeersRef.current))
      console.log("Active connections:", Object.keys(connectionsRef.current))
      console.log("Pending connections:", Object.keys(pendingConnectionsRef.current))
      console.log("Player count:", Object.keys(players).length)
      console.log("URL:", window.location.href)
      console.log("========================")
    }

    // Call this function periodically
    const statusInterval = setInterval(logConnectionStatus, 10000)

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
          playerPosition.y + 1.8, // Reduced from 2.9 to 1.8
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

      // Canvas settings
      const canvasSpacing = 4
      const canvasHeight = 2
      const canvasesPerWall = 4

      // Calculate positions
      const wallLength = roomSize - 2
      const totalSpace = canvasesPerWall * canvasSpacing
      const startOffset = (wallLength - totalSpace) / 2 + canvasSpacing / 2

      // Place canvases on all walls
      for (let i = 0; i < canvasesPerWall; i++) {
        // North wall
        const xNorth = -halfSize + startOffset + i * canvasSpacing
        createCanvas(xNorth, canvasHeight, -halfSize + 0.2, 0, 0, 0, `north-${i}`)

        // South wall
        const xSouth = -halfSize + startOffset + i * canvasSpacing
        createCanvas(xSouth, canvasHeight, halfSize - 0.2, Math.PI, 0, 0, `south-${i}`)

        // East wall
        const zEast = -halfSize + startOffset + i * canvasSpacing
        createCanvas(halfSize - 0.2, canvasHeight, zEast, -Math.PI / 2, 0, 0, `east-${i}`)

        // West wall
        const zWest = -halfSize + startOffset + i * canvasSpacing
        createCanvas(-halfSize + 0.2, canvasHeight, zWest, Math.PI / 2, 0, 0, `west-${i}`)
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
        ctx.fillRect(0, 0, 800, 600)

        // Add grid pattern
        ctx.strokeStyle = "#f0f0f0"
        ctx.lineWidth = 1

        // Grid lines
        for (let x = 0; x <= 800; x += 50) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, 600)
          ctx.stroke()
        }

        for (let y = 0; y <= 600; y += 50) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(800, y)
          ctx.stroke()
        }
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
      offScreenCanvas.width = 800
      offScreenCanvas.height = 600
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

      // Adjust position slightly to avoid z-fighting
      if (Math.abs(rotationY) === Math.PI / 2) {
        canvas.position.x += rotationY > 0 ? 0.06 : -0.06
      } else if (Math.abs(rotationY) === Math.PI || rotationY === 0) {
        canvas.position.z += rotationY === 0 ? 0.06 : -0.06
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
      if (drawingMode) return

      // Create a raycaster from camera center
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)

      // Check for intersections with canvases
      const intersects = raycaster.intersectObjects(canvases, false)

      if (intersects.length > 0 && intersects[0].distance < 3) {
        const canvasObject = intersects[0].object as THREE.Mesh
        setNearbyCanvas(canvasObject)
        setInteractionPrompt("Press R or click to draw on canvas")
        document.body.style.cursor = "pointer"

        // Add click handler for the canvas
        if (controls.isLocked && !drawingMode) {
          const handleCanvasClick = () => {
            console.log("Canvas clicked:", canvasObject.userData?.id)
            enterDrawingMode(canvasObject)
            document.removeEventListener("click", handleCanvasClick)
          }

          document.addEventListener("click", handleCanvasClick, { once: true })
        }
      } else {
        if (nearbyCanvas) {
          setNearbyCanvas(null)
          setInteractionPrompt("")
          document.body.style.cursor = "auto"
        }
      }
    }

    function enterDrawingMode(canvasObj: THREE.Mesh) {
      console.log("Entering drawing mode for canvas:", canvasObj.userData?.id)
      console.log("Canvas object:", canvasObj)
      controls.unlock()
      setDrawingMode(true)
      setCurrentCanvas(canvasObj)
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

      console.log("Setting up new peer connection with ID:", randomId)
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

      // Create new player model
      const playerModel = new PlayerModel(
        color,
        new THREE.Vector3(position.x, 0, position.z), // Set y to 0 to ensure player is on the ground
      )

      const nameSprite = new TextSprite(
        playerName,
        new THREE.Vector3(
          position.x,
          position.y + 1.8, // Reduced from 2.2 to 1.8 (about 20% lower)
          position.z,
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
          position: new THREE.Vector3(position.x, position.y, position.z),
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

      console.log("Join gallery called with my ID:", peerId)
      console.log("URL contains peer ID:", connectToPeer)

      if (connectToPeer && connectToPeer !== peerId) {
        // Connect to the specified peer
        console.log("Connecting to peer from URL:", connectToPeer)
        connectToPeerById(connectToPeer)
      }

      // Update the URL with our peer ID for others to connect
      const baseUrl = window.location.origin + window.location.pathname
      const newUrl = `${baseUrl}?p=${peerId}`

      try {
        window.history.replaceState({}, "", newUrl)
        console.log("Updated URL to:", newUrl)
      } catch (e) {
        console.error("Failed to update URL:", e)
      }

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
          // Make sure we're using a consistent ID format
          const playerColor = playerModelsRef.current[myId]?.model
            ? (playerModelsRef.current[myId].model as any).children[0].material.color.getHexString()
            : getRandomColor()

          console.log("Sending player info with ID:", myId)

          conn.send({
            type: "playerInfo",
            data: {
              id: myId,
              username,
              position: {
                x: playerPosition.x,
                y: playerPosition.y,
                z: playerPosition.z,
              },
              rotation: playerRotationRef.current,
              color: playerColor,
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

        // Send canvas data
        canvases.forEach((canvas) => {
          const canvasId = canvas.userData.id
          const savedData = localStorage.getItem(`canvas-${canvasId}`)

          if (savedData) {
            try {
              conn.send({
                type: "canvasData",
                data: {
                  canvasId,
                  imageData: savedData,
                },
              })
            } catch (err) {
              console.error("Error sending canvas data:", err)
            }
          }
        })
      })

      // Handle data messages
      conn.on("data", (data: any) => {
        try {
          // Handle different message types
          switch (data.type) {
            case "playerInfo":
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

    function handlePlayerInfo(playerData: any) {
      if (!playerData || !playerData.id) {
        console.error("Invalid player data:", playerData)
        return
      }

      // Skip if this is our own player ID to prevent duplicates
      if (playerData.id === myId) {
        console.log("Received own player info, ignoring to prevent duplicates")
        return
      }

      console.log("Received player info:", playerData)

      // Check if we already have this player to prevent duplicates
      const existingPlayer = Object.values(players).find(
        (player) =>
          player.id === playerData.id ||
          (player.username === playerData.username &&
            Math.abs(player.position.x - playerData.position.x) < 0.5 &&
            Math.abs(player.position.z - playerData.position.z) < 0.5),
      )

      if (existingPlayer) {
        console.log("Player already exists, updating instead of creating duplicate:", playerData.id)

        // Just update the existing player's position
        if (playerModelsRef.current[existingPlayer.id]) {
          const { model, nameSprite } = playerModelsRef.current[existingPlayer.id]
          model.position.set(playerData.position.x, 0, playerData.position.z)
          nameSprite.position.set(playerData.position.x, playerData.position.y + 1.8, playerData.position.z)
        }
        return
      }

      // Add to known peers
      knownPeersRef.current.add(playerData.id)

      // Create player position vector
      const playerPosition = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z)

      // Create or update player model
      createPlayerModel(playerData.id, playerData.username, playerData.color, playerPosition)
    }

    function handlePlayerMove(playerId: string, moveData: any) {
      if (!playerId || !moveData) return

      // Update player position in state
      setPlayers((prev) => {
        if (!prev[playerId]) return prev

        const updatedPlayer = {
          ...prev[playerId],
          position: new THREE.Vector3(moveData.position.x, moveData.position.y, moveData.position.z),
          rotation: moveData.rotation,
        }

        return {
          ...prev,
          [playerId]: updatedPlayer,
        }
      })

      // Update player model directly for better performance
      if (playerModelsRef.current[playerId]) {
        const { model, nameSprite } = playerModelsRef.current[playerId]

        // Set position ensuring y is 0 to keep player on the ground
        model.position.set(
          moveData.position.x,
          0, // Force y to 0 to keep player on ground
          moveData.position.z,
        )

        model.rotation.y = moveData.rotation

        nameSprite.position.set(
          moveData.position.x,
          moveData.position.y + 1.8, // Reduced from 2.2 to 1.8 (about 20% lower)
          moveData.position.z,
        )
      }
    }

    function handleCanvasData(data: any) {
      if (!data || !data.canvasId) return

      const { canvasId, imageData } = data

      // Find the canvas
      const canvas = canvases.find((c) => c.userData.id === canvasId)
      if (!canvas) return

      // Update the canvas texture
      const offScreenCanvas = canvas.userData.offScreenCanvas
      const offCtx = offScreenCanvas.getContext("2d")

      if (offCtx) {
        // Clear the canvas first
        offCtx.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)

        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
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
        }

        // Handle both direct image data and JSON strings
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
      }
    }

    function handleCanvasUpdate(data: any) {
      // Same as handleCanvasData
      handleCanvasData(data)

      // Forward to other peers
      Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
        if (conn.open) {
          try {
            conn.send({
              type: "canvasData",
              data,
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
      console.log("Exiting drawing mode")
      if (!currentCanvas) {
        console.error("No current canvas to save drawing to")
        return
      }

      console.log("Saving drawing to canvas:", currentCanvas.userData?.id)

      // Get the canvas data
      const canvasId = currentCanvas.userData.id
      const offScreenCanvas = currentCanvas.userData.offScreenCanvas
      const offCtx = offScreenCanvas.getContext("2d")

      if (offCtx) {
        // Clear the canvas first to ensure clean drawing
        offCtx.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height)

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

        // Broadcast to other peers
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

      // Reset state
      setDrawingMode(false)
      setCurrentCanvas(null)

      // Re-lock controls
      setTimeout(() => {
        controls.lock()
      }, 100)
    }

    // Start animation loop
    animate()

    // Add to cleanup
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("resize", onWindowResize)
      clearInterval(statusInterval)

      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement)
      }

      if (peerRef.current) {
        peerRef.current.destroy()
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      renderer.dispose()
    }
  }, [username])

  return (
    <div ref={containerRef} className="h-screen w-screen">
      {!started && !drawingMode && (
        <Instructions>
          <p>Click to move</p>
          <p>WASD - Move</p>
          <p>Space - Jump</p>
          <p>R - Draw on canvas (when near)</p>
          <p>P - Debug connections</p>
          <p>Ctrl+R - Force reconnect</p>
        </Instructions>
      )}

      {interactionPrompt && <InteractionPrompt text={interactionPrompt} />}

      {drawingMode && currentCanvas && <DrawingInterface />}

      {myId && (
        <div className="absolute bottom-4 left-4 z-10 rounded bg-black/70 p-2 text-white">
          <p>Share this URL for others to join:</p>
          <p className="text-xs">{window.location.href}</p>
          <p className="mt-2 text-xs">Connection status: {connectionStatus}</p>
          <p className="text-xs">
            Connected players: {Object.keys(players).length}
            <span
              className={Object.keys(connectionsRef.current).length > 0 ? "text-green-400 ml-2" : "text-red-400 ml-2"}
            >
              {Object.keys(connectionsRef.current).length > 0 ? "● Online" : "● Offline"}
            </span>
          </p>
          <p className="text-xs">Debug: {debugInfo}</p>
          <p className="text-xs">Press P to debug connections</p>
          <p className="text-xs">Press Ctrl+R to force reconnect</p>

          {/* Add a reconnect button */}
          <button onClick={() => forceReconnect()} className="mt-2 bg-blue-600 text-white px-2 py-1 text-xs rounded">
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}

