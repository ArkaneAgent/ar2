"use client"

import { useEffect, useRef, useState } from "react"

interface NewDrawingInterfaceProps {
  canvasId: string
  onSave: (imageData: string) => void
  onClose: () => void
}

export function NewDrawingInterface({ canvasId, onSave, onClose }: NewDrawingInterfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [color, setColor] = useState("#000000")
  const [brushSize, setBrushSize] = useState(5)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  // Initialize canvas once on mount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctxRef.current = ctx

    // Initialize canvas with white background
    ctx.fillStyle = "white"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Try to load existing drawing if available
    const savedData = localStorage.getItem(`canvas-${canvasId}`)
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData)
        if (parsedData.imageData) {
          const img = new Image()
          img.crossOrigin = "anonymous"
          img.onload = () => {
            ctx.drawImage(img, 0, 0)
          }
          img.src = parsedData.imageData
        }
      } catch (e) {
        console.error("Error loading saved canvas:", e)
      }
    }

    // Ensure cursor is visible by setting it explicitly
    document.body.style.cursor = "auto"
    canvas.style.cursor = "crosshair"

    // Prevent the browser from showing cursor visibility prompts
    document.exitPointerLock =
      document.exitPointerLock || (document as any).mozExitPointerLock || (document as any).webkitExitPointerLock

    if (document.pointerLockElement) {
      document.exitPointerLock()
    }

    return () => {
      // Reset cursor when component unmounts
      document.body.style.cursor = "auto"
    }
  }, [canvasId])

  // Set up event listeners
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleMouseDown = (e: MouseEvent) => {
      setIsDrawing(true)
      const rect = canvas.getBoundingClientRect()
      lastPosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing || !lastPosRef.current || !ctxRef.current) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      ctxRef.current.beginPath()
      ctxRef.current.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctxRef.current.lineTo(x, y)
      ctxRef.current.strokeStyle = color
      ctxRef.current.lineWidth = brushSize
      ctxRef.current.lineCap = "round"
      ctxRef.current.lineJoin = "round"
      ctxRef.current.stroke()

      lastPosRef.current = { x, y }
    }

    const handleMouseUp = () => {
      setIsDrawing(false)
      lastPosRef.current = null
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSaveAndClose()
      }
    }

    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("mousemove", handleMouseMove)
    canvas.addEventListener("mouseup", handleMouseUp)
    canvas.addEventListener("mouseleave", handleMouseUp)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("mousemove", handleMouseMove)
      canvas.removeEventListener("mouseup", handleMouseUp)
      canvas.removeEventListener("mouseleave", handleMouseUp)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isDrawing, color, brushSize])

  const handleSaveAndClose = () => {
    if (canvasRef.current) {
      try {
        // Get the image data with maximum quality
        const imageData = canvasRef.current.toDataURL("image/png", 1.0)

        // Log the size of the data for debugging
        console.log(`Canvas data size: ${Math.round(imageData.length / 1024)} KB`)

        // Save the drawing
        onSave(imageData)

        // Add a small delay before closing to ensure data is processed
        setTimeout(() => {
          onClose()
        }, 100)
      } catch (err) {
        console.error("Error saving canvas:", err)
        alert("There was an error saving your drawing. Please try again.")
      }
    } else {
      onClose()
    }
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas || !ctxRef.current) return

    ctxRef.current.fillStyle = "white"
    ctxRef.current.fillRect(0, 0, canvas.width, canvas.height)
  }

  // Predefined colors
  const colorOptions = [
    "#000000", // Black
    "#FFFFFF", // White
    "#FF0000", // Red
    "#00FF00", // Green
    "#0000FF", // Blue
    "#FFFF00", // Yellow
    "#FF00FF", // Magenta
    "#00FFFF", // Cyan
    "#FFA500", // Orange
    "#800080", // Purple
    "#A52A2A", // Brown
    "#808080", // Gray
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="flex flex-col items-center rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-2xl font-bold">Drawing Canvas: {canvasId}</h2>

        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="border-2 border-gray-300 bg-white shadow-lg"
          style={{ cursor: "crosshair" }} // Explicitly set cursor style
        />

        <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-4 rounded-md bg-gray-100 p-4">
          <div className="flex flex-col items-center">
            <label htmlFor="colorPicker" className="mb-1 text-sm font-medium">
              Color
            </label>
            <input
              type="color"
              id="colorPicker"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-8 cursor-pointer"
            />
          </div>

          <div className="flex flex-col items-center">
            <label className="mb-1 text-sm font-medium">Quick Colors</label>
            <div className="flex flex-wrap gap-1">
              {colorOptions.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setColor(c)}
                  className="h-6 w-6 rounded-full border border-gray-300"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? "2px solid black" : "none",
                    border: c === "#FFFFFF" ? "1px solid #ccc" : "none",
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center">
            <label className="mb-1 text-sm font-medium">Brush Size: {brushSize}px</label>
            <input
              type="range"
              min="1"
              max="30"
              value={brushSize}
              onChange={(e) => setBrushSize(Number.parseInt(e.target.value))}
              className="w-32"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-4">
          <button onClick={handleClear} className="rounded bg-red-500 px-4 py-2 font-bold text-white hover:bg-red-600">
            Clear Canvas
          </button>
          <button
            onClick={handleSaveAndClose}
            className="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-600"
          >
            Save & Close
          </button>
        </div>

        <p className="mt-4 text-sm text-gray-500">Press ESC to save and exit</p>
        <div className="mt-4 max-w-md text-center text-xs text-gray-500">
          <p className="font-medium">About Drawing Persistence:</p>
          <p>Drawings are saved in your browser's storage and shared with other players in your current session.</p>
          <p>They will not appear in different lobbies or when joining with a different URL.</p>
          <p>Drawings older than 30 minutes may be automatically cleared.</p>
        </div>
      </div>
    </div>
  )
}

