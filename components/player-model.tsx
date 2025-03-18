"use client"

import * as THREE from "three"

export class PlayerModel extends THREE.Group {
  constructor(color: string, position: THREE.Vector3) {
    super()

    // Create a pill-shaped player model (thinner than the statue)
    const capsuleLength = 1.5
    const capsuleRadius = 0.4
    const capsuleSegments = 16

    // Main body material with the random color
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.3,
      metalness: 0.2,
    })

    // Create the pill body
    const bodyGeometry = new THREE.CapsuleGeometry(capsuleRadius, capsuleLength, capsuleSegments, capsuleSegments)

    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    // Position the body so it sits exactly on the ground
    body.position.y = capsuleRadius + capsuleLength / 2
    body.castShadow = true
    body.receiveShadow = true
    this.add(body)

    // Add a slight outline
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.BackSide,
    })

    const outlineGeometry = new THREE.CapsuleGeometry(
      capsuleRadius * 1.05,
      capsuleLength * 1.05,
      capsuleSegments,
      capsuleSegments,
    )

    const outline = new THREE.Mesh(outlineGeometry, outlineMaterial)
    outline.position.y = capsuleRadius + capsuleLength / 2
    this.add(outline)

    // Add googly eyes
    this.addGooglyEyes(capsuleRadius, capsuleLength)

    // Position the player - adjust y position to be exactly on the ground
    this.position.copy(position)
    // Ensure the player is exactly on the ground
    this.position.y = 0
  }

  // Add a new method to create googly eyes
  addGooglyEyes(capsuleRadius: number, capsuleLength: number) {
    // Eye whites
    const eyeRadius = capsuleRadius * 0.3
    const eyeGeometry = new THREE.SphereGeometry(eyeRadius, 16, 16)
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff })

    // Left eye
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
    leftEye.position.set(-capsuleRadius * 0.5, capsuleRadius + capsuleLength * 0.8, capsuleRadius * 0.8)
    this.add(leftEye)

    // Right eye
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
    rightEye.position.set(capsuleRadius * 0.5, capsuleRadius + capsuleLength * 0.8, capsuleRadius * 0.8)
    this.add(rightEye)

    // Pupils
    const pupilRadius = eyeRadius * 0.6
    const pupilGeometry = new THREE.SphereGeometry(pupilRadius, 16, 16)
    const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 })

    // Left pupil
    const leftPupil = new THREE.Mesh(pupilGeometry, pupilMaterial)
    leftPupil.position.set(-capsuleRadius * 0.5, capsuleRadius + capsuleLength * 0.8, capsuleRadius * 0.9)
    this.add(leftPupil)

    // Right pupil
    const rightPupil = new THREE.Mesh(pupilGeometry, pupilMaterial)
    rightPupil.position.set(capsuleRadius * 0.5, capsuleRadius + capsuleLength * 0.8, capsuleRadius * 0.9)
    this.add(rightPupil)
  }
}

