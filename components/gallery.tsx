// In the onKeyDown function inside gallery.tsx
// v26 code:
case "KeyE":
  if (nearbyCanvas && !drawingMode && controls.isLocked) {
    console.log("Entering drawing mode for canvas:", nearbyCanvas.userData?.id)
    enterDrawingMode(nearbyCanvas)
  } else if (!drawingMode && controls.isLocked) {
    console.log("Pressed E but no canvas nearby or not eligible:", {
      nearbyCanvas: !!nearbyCanvas,
      drawingMode,
      isLocked: controls.isLocked,
    })
  }
  break;
