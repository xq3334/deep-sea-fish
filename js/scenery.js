"use strict";

/** Mulberry32: a small seeded generator so the scenery layout is reproducible while tuning. */
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Appends a curved, tapering limb plus a round end cap to a Path2D.
 * Limbs and caps all wind counter-clockwise on screen, so overlapping pieces merge
 * under the nonzero fill rule instead of cancelling into holes.
 */
function appendTaperedLimb(path, startX, startY, controlX, controlY, endX, endY, startWidth, endWidth) {
  const startAngle = Math.atan2(controlY - startY, controlX - startX);
  const endAngle = Math.atan2(endY - controlY, endX - controlX);
  const startNormalX = -Math.sin(startAngle);
  const startNormalY = Math.cos(startAngle);
  const endNormalX = -Math.sin(endAngle);
  const endNormalY = Math.cos(endAngle);
  const controlNormalX = (startNormalX + endNormalX) / 2;
  const controlNormalY = (startNormalY + endNormalY) / 2;
  const startHalfWidth = startWidth / 2;
  const endHalfWidth = endWidth / 2;
  const controlHalfWidth = (startHalfWidth + endHalfWidth) / 2;
  path.moveTo(startX + startNormalX * startHalfWidth, startY + startNormalY * startHalfWidth);
  path.quadraticCurveTo(
    controlX + controlNormalX * controlHalfWidth, controlY + controlNormalY * controlHalfWidth,
    endX + endNormalX * endHalfWidth, endY + endNormalY * endHalfWidth
  );
  path.lineTo(endX - endNormalX * endHalfWidth, endY - endNormalY * endHalfWidth);
  path.quadraticCurveTo(
    controlX - controlNormalX * controlHalfWidth, controlY - controlNormalY * controlHalfWidth,
    startX - startNormalX * startHalfWidth, startY - startNormalY * startHalfWidth
  );
  path.closePath();
  path.moveTo(endX + endHalfWidth, endY);
  path.arc(endX, endY, endHalfWidth, 0, MathUtils.TAU, true);
}

/** Closes a polygon running forward along one edge and back along the other. */
function appendRibbonPolygon(path, forwardEdge, returnEdge) {
  path.moveTo(forwardEdge[0].x, forwardEdge[0].y);
  for (const point of forwardEdge) path.lineTo(point.x, point.y);
  for (let pointIndex = returnEdge.length - 1; pointIndex >= 0; pointIndex--) {
    path.lineTo(returnEdge[pointIndex].x, returnEdge[pointIndex].y);
  }
  path.closePath();
}

/** Mixes a world seed with a chunk index so every chunk gets its own reproducible random sequence. */
function deriveChunkSeed(worldSeed, chunkIndex, layerSalt) {
  return (worldSeed ^ Math.imul(chunkIndex, 0x9e3779b1) ^ Math.imul(layerSalt, 0x85ebca6b)) >>> 0;
}

/** Chunks this many indices beyond the requested range stay cached, so small back-and-forth moves never regenerate. */
const CHUNK_EVICTION_SLACK = 2;

/**
 * Generates fixed-width horizontal strips of content on demand and forgets distant ones.
 * Generation is deterministic per chunk index, so an evicted chunk comes back identical.
 */
class ChunkStream {
  constructor(chunkWidth, generateChunk) {
    this.chunkWidth = chunkWidth;
    this.generateChunk = generateChunk;
    this.loadedChunks = new Map();
  }

  /** Loads chunks covering [left, right] plus one chunk of look-ahead; returns true when the loaded set changed. */
  streamRange(left, right) {
    const firstIndex = Math.floor(left / this.chunkWidth) - 1;
    const lastIndex = Math.floor(right / this.chunkWidth) + 1;
    let hasChanged = false;
    for (let chunkIndex = firstIndex; chunkIndex <= lastIndex; chunkIndex++) {
      if (this.loadedChunks.has(chunkIndex)) continue;
      const chunkLeft = chunkIndex * this.chunkWidth;
      this.loadedChunks.set(chunkIndex, this.generateChunk(chunkIndex, chunkLeft, chunkLeft + this.chunkWidth));
      hasChanged = true;
    }
    for (const chunkIndex of this.loadedChunks.keys()) {
      const isWithinKeepRange = chunkIndex >= firstIndex - CHUNK_EVICTION_SLACK && chunkIndex <= lastIndex + CHUNK_EVICTION_SLACK;
      if (isWithinKeepRange) continue;
      this.loadedChunks.delete(chunkIndex);
      hasChanged = true;
    }
    return hasChanged;
  }

  /** Flattens one item list across all loaded chunks, ordered left to right. */
  collect(propertyName) {
    const sortedIndices = [...this.loadedChunks.keys()].sort((first, second) => first - second);
    return sortedIndices.flatMap((chunkIndex) => this.loadedChunks.get(chunkIndex)[propertyName]);
  }
}

const SCENERY_WORLD_SEED = 20261028;
const SCENERY_TERRAIN_CHUNK_WIDTH = 1600;
const SCENERY_RUIN_CHUNK_WIDTH = 1200;

const SCENERY_GLOW_COLORS = ["#5ef2ff", "#8a7dff", "#d36bff", "#46ffc8"];

/** Foreground silhouettes move faster than the world so they read as closer to the viewer. */
const SCENERY_FOREGROUND_PARALLAX = 1.3;

/** The leviathan swims far behind the ridges, so camera movement shifts it much less than the playfield. */
const LEVIATHAN_PARALLAX_X = 0.15;
const LEVIATHAN_PARALLAX_Y = 0.15;
/** Seconds between the leviathan's spontaneous turns. */
const LEVIATHAN_TURN_INTERVAL = { minimum: 18, maximum: 40 };
/** Once this far past a screen edge (in screen pixels) it is relocated so it can swim back into view. */
const LEVIATHAN_OFFSCREEN_LIMIT = 2400;

/**
 * Seabed scenery: rocks, corals, vents, floor details, foreground silhouettes,
 * distant ruins and a passing leviathan. Shapes are built once as Path2D objects
 * so each frame only fills cached geometry.
 */
class SeaScenery {
  constructor(worldFloorY, getFloorHeightAt) {
    this.worldFloorY = worldFloorY;
    this.getFloorHeightAt = getFloorHeightAt;
    // Every builder reads this.random; chunk generation swaps in a per-chunk seeded sequence.
    this.random = createSeededRandom(SCENERY_WORLD_SEED);
    this.rocks = [];
    this.corals = [];
    this.vents = [];
    this.floorDetailChunks = [];
    this.foregroundPieces = [];
    this.distantRuins = [];
    this.leviathan = null;
    // Gradients are created once on a detached context and reused on the main canvas.
    this.helperContext = document.createElement("canvas").getContext("2d");
    this.terrainStream = new ChunkStream(SCENERY_TERRAIN_CHUNK_WIDTH,
      (chunkIndex, chunkLeft, chunkRight) => this.generateTerrainChunk(chunkIndex, chunkLeft, chunkRight));
    this.ruinStream = new ChunkStream(SCENERY_RUIN_CHUNK_WIDTH,
      (chunkIndex, chunkLeft, chunkRight) => this.generateRuinChunk(chunkIndex, chunkLeft, chunkRight));
    this.createLeviathan();
  }

  /** Makes sure seabed scenery exists around the visible world range; call once per frame before drawing. */
  streamTerrain(visibleLeft, visibleRight) {
    if (!this.terrainStream.streamRange(visibleLeft, visibleRight)) return;
    this.rocks = this.terrainStream.collect("rocks");
    this.corals = this.terrainStream.collect("corals");
    this.vents = this.terrainStream.collect("vents");
    this.floorDetailChunks = this.terrainStream.collect("floorDetailChunks");
    this.foregroundPieces = this.terrainStream.collect("foregroundPieces");
  }

  generateTerrainChunk(chunkIndex, chunkLeft, chunkRight) {
    this.random = createSeededRandom(deriveChunkSeed(SCENERY_WORLD_SEED, chunkIndex, 1));
    return {
      rocks: this.createRocks(chunkLeft, chunkRight),
      corals: this.createCorals(chunkLeft, chunkRight),
      vents: this.createVents(chunkLeft, chunkRight),
      floorDetailChunks: this.createFloorDetails(chunkLeft, chunkRight),
      foregroundPieces: this.createForegroundPieces(chunkLeft, chunkRight),
    };
  }

  /** Ruin chunks live in the middle ridge layer's parallax space, not in world space. */
  generateRuinChunk(chunkIndex, chunkLeft, chunkRight) {
    this.random = createSeededRandom(deriveChunkSeed(SCENERY_WORLD_SEED, chunkIndex, 2));
    return { distantRuins: this.createDistantRuins(chunkLeft, chunkRight) };
  }

  randomBetween(minimum, maximum) {
    return minimum + this.random() * (maximum - minimum);
  }

  pickFrom(list) {
    return list[Math.floor(this.random() * list.length)];
  }

  static isHorizontallyVisible(item, visibleLeft, visibleRight) {
    return item.right >= visibleLeft && item.left <= visibleRight;
  }

  /** Rocks are buried below the lowest floor point under their footprint so no gap shows. */
  getBuriedBaseY(centerX, halfWidth) {
    const floorSamples = [-1, -0.5, 0, 0.5, 1].map((offset) => this.getFloorHeightAt(centerX + offset * halfWidth));
    return Math.max(...floorSamples) + 14;
  }

  createRockPart(outline, holeOutline) {
    const path = new Path2D();
    traceSmoothClosedPath(path, outline);
    if (holeOutline) traceSmoothClosedPath(path, holeOutline);
    const xValues = outline.map((point) => point.x);
    const yValues = outline.map((point) => point.y);
    return {
      path,
      outline,
      fillRule: holeOutline ? "evenodd" : "nonzero",
      left: Math.min(...xValues),
      right: Math.max(...xValues),
      top: Math.min(...yValues),
      bottom: Math.max(...yValues),
    };
  }

  buildSpire(centerX) {
    const height = this.randomBetween(260, 640);
    const baseWidth = this.randomBetween(110, 210);
    const baseY = this.getBuriedBaseY(centerX, baseWidth * 0.7);
    const leanOffset = this.randomBetween(-0.22, 0.22) * height;
    const sampleCount = 9;
    const leftSide = [];
    const rightSide = [];
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
      const heightFraction = sampleIndex / sampleCount;
      const spineX = centerX + leanOffset * heightFraction * heightFraction;
      const halfWidth = (baseWidth / 2) * Math.pow(1 - heightFraction, 0.75) + 7;
      const sampleY = baseY - height * heightFraction;
      leftSide.push({ x: spineX - halfWidth * this.randomBetween(0.8, 1.15), y: sampleY + this.randomBetween(-10, 10) });
      rightSide.push({ x: spineX + halfWidth * this.randomBetween(0.8, 1.15), y: sampleY + this.randomBetween(-10, 10) });
    }
    const outline = [
      { x: centerX - baseWidth * 0.7, y: baseY + 40 },
      ...leftSide,
      ...rightSide.reverse(),
      { x: centerX + baseWidth * 0.7, y: baseY + 40 },
    ];
    return { kind: "spire", baseY, parts: [this.createRockPart(outline, null)] };
  }

  buildArch(centerX) {
    const width = this.randomBetween(380, 560);
    const height = this.randomBetween(260, 400);
    const wallThickness = width * this.randomBetween(0.2, 0.26);
    const baseY = this.getBuriedBaseY(centerX, width / 2);
    const arcSampleCount = 12;
    const outline = [{ x: centerX - width / 2, y: baseY + 40 }];
    for (let sampleIndex = 0; sampleIndex <= arcSampleCount; sampleIndex++) {
      const angle = Math.PI - (sampleIndex / arcSampleCount) * Math.PI;
      const roughness = this.randomBetween(0.94, 1.07);
      outline.push({ x: centerX + Math.cos(angle) * (width / 2) * roughness, y: baseY - Math.sin(angle) * height * roughness });
    }
    outline.push({ x: centerX + width / 2, y: baseY + 40 });

    const innerHalfWidth = width / 2 - wallThickness;
    const innerHeight = height - wallThickness * 0.85;
    // The hole stops above the outer bottom edge; otherwise evenodd would fill the overhang below.
    const holeOutline = [{ x: centerX + innerHalfWidth, y: baseY + 30 }];
    for (let sampleIndex = 0; sampleIndex <= arcSampleCount; sampleIndex++) {
      const angle = (sampleIndex / arcSampleCount) * Math.PI;
      const roughness = this.randomBetween(0.95, 1.04);
      holeOutline.push({ x: centerX + Math.cos(angle) * innerHalfWidth * roughness, y: baseY - Math.sin(angle) * innerHeight * roughness });
    }
    holeOutline.push({ x: centerX - innerHalfWidth, y: baseY + 30 });
    return { kind: "arch", baseY, parts: [this.createRockPart(outline, holeOutline)] };
  }

  buildBoulderPile(centerX) {
    const boulderCount = 2 + Math.floor(this.random() * 3);
    const pileWidth = this.randomBetween(160, 320);
    const baseY = this.getBuriedBaseY(centerX, pileWidth / 2);
    const parts = [];
    for (let boulderIndex = 0; boulderIndex < boulderCount; boulderIndex++) {
      const radius = this.randomBetween(45, 100) * (boulderIndex === 0 ? 1.25 : 1);
      const boulderX = centerX + this.randomBetween(-0.5, 0.5) * pileWidth;
      const boulderY = baseY - radius * this.randomBetween(0.35, 0.7);
      const pointCount = 9;
      const outline = [];
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
        const angle = (pointIndex / pointCount) * MathUtils.TAU;
        const wobble = this.randomBetween(0.8, 1.12);
        outline.push({ x: boulderX + Math.cos(angle) * radius * 1.25 * wobble, y: boulderY + Math.sin(angle) * radius * wobble });
      }
      parts.push(this.createRockPart(outline, null));
    }
    return { kind: "boulders", baseY, parts };
  }

  createRocks(chunkLeft, chunkRight) {
    const rocks = [];
    let rockX = chunkLeft + this.randomBetween(150, 400);
    while (rockX < chunkRight) {
      const roll = this.random();
      let rock;
      if (roll < 0.42) rock = this.buildSpire(rockX);
      else if (roll < 0.82) rock = this.buildBoulderPile(rockX);
      else rock = this.buildArch(rockX);
      this.decorateRock(rock);
      rocks.push(rock);
      rockX += this.randomBetween(420, 900);
    }
    return rocks;
  }

  decorateRock(rock) {
    rock.left = Math.min(...rock.parts.map((part) => part.left)) - 60;
    rock.right = Math.max(...rock.parts.map((part) => part.right)) + 60;
    rock.glowColor = this.pickFrom(SCENERY_GLOW_COLORS);
    rock.phase = this.random() * MathUtils.TAU;
    rock.mossLights = [];
    for (const part of rock.parts) {
      const partWidth = part.right - part.left;
      const partHeight = Math.max(1, part.bottom - part.top);
      part.bodyGradient = this.helperContext.createLinearGradient(
        part.left + partWidth * 0.3, part.top, part.left + partWidth * 0.6, part.bottom
      );
      part.bodyGradient.addColorStop(0, "#22384a");
      part.bodyGradient.addColorStop(0.35, "#112131");
      part.bodyGradient.addColorStop(1, "#03080f");
      part.rimGradient = this.helperContext.createLinearGradient(0, part.top, 0, part.top + partHeight * 0.45);
      part.rimGradient.addColorStop(0, "rgba(140,215,240,0.42)");
      part.rimGradient.addColorStop(1, "rgba(140,215,240,0)");
      for (const outlinePoint of part.outline) {
        if (outlinePoint.y > rock.baseY - 16 || this.random() < 0.45) continue;
        rock.mossLights.push({
          x: outlinePoint.x + this.randomBetween(-6, 6),
          y: outlinePoint.y + this.randomBetween(2, 8),
          radius: this.randomBetween(2.5, 6),
          phase: this.random() * MathUtils.TAU,
        });
      }
    }

    const mainPart = rock.parts[0];
    const mainWidth = mainPart.right - mainPart.left;
    const mainHeight = mainPart.bottom - mainPart.top;
    if (rock.kind === "arch") {
      rock.innerGlow = { x: (mainPart.left + mainPart.right) / 2, y: rock.baseY - mainHeight * 0.3, radius: mainWidth * 0.42 };
      return;
    }
    rock.cracksPath = new Path2D();
    rock.crackGlowPoints = [];
    const crackCount = 1 + Math.floor(this.random() * 2);
    for (let crackIndex = 0; crackIndex < crackCount; crackIndex++) {
      let crackX = (mainPart.left + mainPart.right) / 2 + this.randomBetween(-0.15, 0.15) * mainWidth;
      let crackY = mainPart.top + mainHeight * this.randomBetween(0.2, 0.45);
      rock.cracksPath.moveTo(crackX, crackY);
      rock.crackGlowPoints.push({ x: crackX, y: crackY });
      for (let segmentIndex = 0; segmentIndex < 6; segmentIndex++) {
        crackX += this.randomBetween(-12, 12);
        crackY += mainHeight * this.randomBetween(0.05, 0.1);
        rock.cracksPath.lineTo(crackX, crackY);
      }
    }
  }

  createCorals(chunkLeft, chunkRight) {
    const corals = [];
    let coralX = chunkLeft + this.randomBetween(60, 200);
    while (coralX < chunkRight) {
      const baseY = this.getFloorHeightAt(coralX) + 6;
      const roll = this.random();
      let coral;
      if (roll < 0.32) coral = this.buildStaghornCoral(coralX, baseY);
      else if (roll < 0.55) coral = this.buildSeaFan(coralX, baseY);
      else if (roll < 0.78) coral = this.buildBrainCoral(coralX, baseY);
      else coral = this.buildTubeCoral(coralX, baseY);
      coral.baseX = coralX;
      coral.baseY = baseY;
      coral.phase = this.random() * MathUtils.TAU;
      coral.glowColor = coral.glowColor || this.pickFrom(SCENERY_GLOW_COLORS);
      corals.push(coral);
      coralX += this.randomBetween(110, 300);
    }
    return corals;
  }

  buildStaghornCoral(baseX, baseY) {
    const path = new Path2D();
    const tips = [];
    const bounds = { left: baseX, right: baseX };
    const scale = this.randomBetween(0.7, 1.35);
    const growBranch = (startX, startY, angle, length, width, remainingDepth) => {
      const bentAngle = angle + this.randomBetween(-0.35, 0.35);
      const controlX = startX + Math.cos(angle) * length * 0.5;
      const controlY = startY + Math.sin(angle) * length * 0.5;
      const endX = controlX + Math.cos(bentAngle) * length * 0.5;
      const endY = controlY + Math.sin(bentAngle) * length * 0.5;
      const endWidth = width * 0.64;
      appendTaperedLimb(path, startX, startY, controlX, controlY, endX, endY, width, endWidth);
      bounds.left = Math.min(bounds.left, endX);
      bounds.right = Math.max(bounds.right, endX);
      if (remainingDepth <= 0) {
        tips.push({ x: endX, y: endY, radius: endWidth / 2 });
        return;
      }
      const childCount = this.random() < 0.65 ? 2 : 3;
      for (let childIndex = 0; childIndex < childCount; childIndex++) {
        const spread = (childIndex / (childCount - 1) - 0.5) * this.randomBetween(0.9, 1.4);
        growBranch(endX, endY, bentAngle + spread, length * this.randomBetween(0.62, 0.8), endWidth, remainingDepth - 1);
      }
    };
    const trunkCount = 1 + Math.floor(this.random() * 2);
    for (let trunkIndex = 0; trunkIndex < trunkCount; trunkIndex++) {
      const trunkAngle = -Math.PI / 2 + this.randomBetween(-0.45, 0.45);
      growBranch(baseX + this.randomBetween(-12, 12), baseY, trunkAngle, 46 * scale, 13 * scale, 3);
    }
    return {
      kind: "staghorn",
      path,
      tips,
      bodyColor: this.pickFrom(["#3b2b5e", "#22405c", "#4a2747", "#1f4a4a"]),
      left: bounds.left - 30,
      right: bounds.right + 30,
    };
  }

  /** Gorgonian sea fan: a translucent membrane laced with fine ribs that fork outward. */
  buildSeaFan(baseX, baseY) {
    const ribPath = new Path2D();
    const membranePath = new Path2D();
    const height = this.randomBetween(120, 230);
    const spreadAngle = this.randomBetween(0.9, 1.3);
    const lean = this.randomBetween(-0.25, 0.25);
    const ribCount = 7;
    const rimPoints = [];
    for (let ribIndex = 0; ribIndex < ribCount; ribIndex++) {
      const spreadFraction = ribIndex / (ribCount - 1) - 0.5;
      const ribAngle = -Math.PI / 2 + lean + spreadFraction * spreadAngle * 2;
      const ribLength = height * (1 - Math.abs(spreadFraction) * 0.45) * this.randomBetween(0.9, 1.05);
      const endX = baseX + Math.cos(ribAngle) * ribLength;
      const endY = baseY + Math.sin(ribAngle) * ribLength;
      const controlX = baseX + Math.cos(ribAngle * 0.7 - Math.PI * 0.15) * ribLength * 0.45;
      const controlY = baseY - ribLength * 0.5;
      appendTaperedLimb(ribPath, baseX, baseY, controlX, controlY, endX, endY, 5, 1.6);
      rimPoints.push({ x: endX, y: endY });
      const forkX = (controlX + endX) / 2;
      const forkY = (controlY + endY) / 2;
      appendTaperedLimb(ribPath, forkX, forkY, forkX + Math.cos(ribAngle - 0.4) * 14, forkY + Math.sin(ribAngle - 0.4) * 14,
        forkX + Math.cos(ribAngle - 0.5) * 30, forkY + Math.sin(ribAngle - 0.5) * 30, 2.4, 1.2);
    }
    membranePath.moveTo(baseX, baseY);
    traceSmoothOpenPath(membranePath, rimPoints, false);
    membranePath.closePath();
    const xValues = rimPoints.map((point) => point.x);
    return {
      kind: "seaFan",
      ribPath,
      membranePath,
      rimPoints,
      height,
      bodyColor: this.pickFrom(["#6a2f5a", "#3f3474", "#7a3b4a"]),
      glowColor: this.pickFrom(["#ff6fc8", "#b07dff", "#ff8f8f"]),
      left: Math.min(...xValues) - 30,
      right: Math.max(...xValues) + 30,
    };
  }

  /** Brain coral: a low dome carved by meandering grooves that glow faintly. */
  buildBrainCoral(baseX, baseY) {
    const radiusX = this.randomBetween(34, 70);
    const radiusY = radiusX * this.randomBetween(0.55, 0.75);
    const domePath = new Path2D();
    domePath.ellipse(baseX, baseY, radiusX, radiusY, 0, Math.PI, 0);
    domePath.closePath();
    const groovePath = new Path2D();
    const grooveCount = 5;
    for (let grooveIndex = 1; grooveIndex <= grooveCount; grooveIndex++) {
      const shrink = 1 - (grooveIndex / (grooveCount + 1)) * 0.85;
      const wavePhase = this.random() * MathUtils.TAU;
      const sampleCount = 28;
      for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
        const angle = Math.PI + (sampleIndex / sampleCount) * Math.PI;
        const wave = 1 + Math.sin(angle * 9 + wavePhase) * 0.06;
        const pointX = baseX + Math.cos(angle) * radiusX * shrink * wave;
        const pointY = baseY + Math.sin(angle) * radiusY * shrink * wave;
        if (sampleIndex === 0) groovePath.moveTo(pointX, pointY);
        else groovePath.lineTo(pointX, pointY);
      }
    }
    const [lightColor, darkColor] = this.pickFrom([["#4b3d6e", "#120d22"], ["#2f5562", "#0a1a22"], ["#5e3b4c", "#1a0d16"]]);
    const bodyGradient = this.helperContext.createRadialGradient(
      baseX - radiusX * 0.3, baseY - radiusY * 0.85, radiusX * 0.1, baseX, baseY, radiusX * 1.1
    );
    bodyGradient.addColorStop(0, lightColor);
    bodyGradient.addColorStop(1, darkColor);
    return {
      kind: "brain",
      domePath,
      groovePath,
      bodyGradient,
      radiusX,
      radiusY,
      left: baseX - radiusX - 30,
      right: baseX + radiusX + 30,
    };
  }

  /** A cluster of leaning tubes; each open mouth holds a soft light. */
  buildTubeCoral(baseX, baseY) {
    const bodyPath = new Path2D();
    const tubes = [];
    const tubeCount = 3 + Math.floor(this.random() * 4);
    let left = baseX;
    let right = baseX;
    for (let tubeIndex = 0; tubeIndex < tubeCount; tubeIndex++) {
      const startX = baseX + (tubeIndex - (tubeCount - 1) / 2) * this.randomBetween(9, 14);
      const height = this.randomBetween(36, 110);
      const width = this.randomBetween(9, 16);
      const lean = this.randomBetween(-0.3, 0.3);
      const endX = startX + Math.sin(lean) * height;
      const endY = baseY - Math.cos(lean) * height;
      appendTaperedLimb(bodyPath, startX, baseY, (startX + endX) / 2, (baseY + endY) / 2, endX, endY, width * 0.8, width);
      tubes.push({ x: endX, y: endY, radius: width / 2, angle: lean });
      left = Math.min(left, endX - width);
      right = Math.max(right, endX + width);
    }
    return {
      kind: "tube",
      bodyPath,
      tubes,
      bodyColor: this.pickFrom(["#2b3f63", "#3a2d5c", "#24504f"]),
      left: left - 30,
      right: right + 30,
    };
  }

  /** Hydrothermal chimneys: lumpy mineral towers that glow orange at the mouth and breathe dark smoke. */
  createVents(chunkLeft, chunkRight) {
    const vents = [];
    // The original 6400px world held 5 vents; roughly one per 1600px chunk keeps that density.
    const ventCount = this.random() < 0.8 ? 1 : 0;
    for (let ventIndex = 0; ventIndex < ventCount; ventIndex++) {
      const centerX = MathUtils.lerp(chunkLeft, chunkRight, this.randomBetween(0.2, 0.8));
      const width = this.randomBetween(48, 80);
      const height = this.randomBetween(100, 190);
      const baseY = this.getBuriedBaseY(centerX, width / 2);
      const sampleCount = 7;
      const leftSide = [];
      const rightSide = [];
      for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
        const heightFraction = sampleIndex / sampleCount;
        const halfWidth = (width / 2) * (1 - heightFraction * 0.62) * this.randomBetween(0.85, 1.2);
        const sampleY = baseY - height * heightFraction;
        leftSide.push({ x: centerX - halfWidth, y: sampleY });
        rightSide.push({ x: centerX + halfWidth, y: sampleY });
      }
      const outline = [{ x: centerX - width * 0.7, y: baseY + 40 }, ...leftSide, ...rightSide.reverse(), { x: centerX + width * 0.7, y: baseY + 40 }];
      const chimneyPath = new Path2D();
      traceSmoothClosedPath(chimneyPath, outline);
      const mouthY = baseY - height;
      const bodyGradient = this.helperContext.createLinearGradient(0, mouthY, 0, baseY);
      bodyGradient.addColorStop(0, "#3a2416");
      bodyGradient.addColorStop(0.25, "#150f0e");
      bodyGradient.addColorStop(1, "#04070b");
      vents.push({
        chimneyPath,
        bodyGradient,
        mouthX: centerX,
        mouthY,
        plumeHeight: this.randomBetween(280, 440),
        phase: this.random() * MathUtils.TAU,
        left: centerX - 160,
        right: centerX + 160,
      });
    }
    return vents;
  }

  /** Floor details are grouped into 400px strips so drawing can cull them cheaply. */
  createFloorDetails(terrainChunkLeft, terrainChunkRight) {
    const floorDetailChunks = [];
    const chunkWidth = 400;
    for (let chunkLeft = terrainChunkLeft; chunkLeft < terrainChunkRight; chunkLeft += chunkWidth) {
      const ripplePath = new Path2D();
      const pebblePath = new Path2D();
      const starfishPath = new Path2D();
      const glowSpecks = [];
      for (let rippleIndex = 0; rippleIndex < 7; rippleIndex++) {
        const rippleX = chunkLeft + this.random() * chunkWidth;
        const rippleY = this.getFloorHeightAt(rippleX) + this.randomBetween(14, 60);
        const rippleWidth = this.randomBetween(40, 110);
        ripplePath.moveTo(rippleX - rippleWidth / 2, rippleY);
        ripplePath.quadraticCurveTo(rippleX, rippleY - 5, rippleX + rippleWidth / 2, rippleY);
        ripplePath.quadraticCurveTo(rippleX, rippleY - 2, rippleX - rippleWidth / 2, rippleY);
        ripplePath.closePath();
      }
      for (let pebbleIndex = 0; pebbleIndex < 9; pebbleIndex++) {
        const pebbleX = chunkLeft + this.random() * chunkWidth;
        const pebbleY = this.getFloorHeightAt(pebbleX) + this.randomBetween(2, 30);
        const pebbleRadius = this.randomBetween(3, 9);
        pebblePath.moveTo(pebbleX + pebbleRadius, pebbleY);
        pebblePath.ellipse(pebbleX, pebbleY, pebbleRadius, pebbleRadius * 0.6, 0, 0, MathUtils.TAU);
      }
      if (this.random() < 0.6) {
        const starX = chunkLeft + this.random() * chunkWidth;
        const starY = this.getFloorHeightAt(starX) + this.randomBetween(6, 24);
        const starRadius = this.randomBetween(7, 12);
        const starRotation = this.random() * MathUtils.TAU;
        for (let pointIndex = 0; pointIndex <= 10; pointIndex++) {
          const angle = starRotation + (pointIndex / 10) * MathUtils.TAU;
          const radius = pointIndex % 2 === 0 ? starRadius : starRadius * 0.42;
          const pointX = starX + Math.cos(angle) * radius;
          const pointY = starY + Math.sin(angle) * radius * 0.55;
          if (pointIndex === 0) starfishPath.moveTo(pointX, pointY);
          else starfishPath.lineTo(pointX, pointY);
        }
        starfishPath.closePath();
      }
      for (let speckIndex = 0; speckIndex < 6; speckIndex++) {
        const speckX = chunkLeft + this.random() * chunkWidth;
        glowSpecks.push({
          x: speckX,
          y: this.getFloorHeightAt(speckX) + this.randomBetween(4, 50),
          radius: this.randomBetween(5, 11),
          color: this.pickFrom(SCENERY_GLOW_COLORS),
          phase: this.random() * MathUtils.TAU,
        });
      }
      floorDetailChunks.push({ ripplePath, pebblePath, starfishPath, glowSpecks, left: chunkLeft, right: chunkLeft + chunkWidth });
    }
    return floorDetailChunks;
  }

  /** Near-camera silhouettes: a dark rock lump with a few tall weed blades growing from it. */
  createForegroundPieces(chunkLeft, chunkRight) {
    const foregroundPieces = [];
    let pieceX = chunkLeft + this.randomBetween(200, 700);
    while (pieceX < chunkRight) {
      const baseY = this.worldFloorY + 30;
      const rockWidth = this.randomBetween(160, 300);
      const rockHeight = this.randomBetween(50, 110);
      const outline = [];
      const pointCount = 8;
      for (let pointIndex = 0; pointIndex <= pointCount; pointIndex++) {
        const angle = Math.PI + (pointIndex / pointCount) * Math.PI;
        const wobble = this.randomBetween(0.85, 1.1);
        outline.push({ x: pieceX + Math.cos(angle) * (rockWidth / 2) * wobble, y: baseY + Math.sin(angle) * rockHeight * wobble });
      }
      outline.push({ x: pieceX + rockWidth / 2, y: baseY + 200 }, { x: pieceX - rockWidth / 2, y: baseY + 200 });
      const rockPath = new Path2D();
      traceSmoothClosedPath(rockPath, outline);
      const blades = [];
      const bladeCount = 2 + Math.floor(this.random() * 4);
      for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex++) {
        blades.push({
          baseX: pieceX + this.randomBetween(-0.35, 0.35) * rockWidth,
          baseY: baseY - rockHeight * 0.5,
          height: this.randomBetween(140, 340),
          width: this.randomBetween(10, 20),
          phase: this.random() * MathUtils.TAU,
          hasLight: this.random() < 0.5,
        });
      }
      foregroundPieces.push({ rockPath, blades, left: pieceX - rockWidth, right: pieceX + rockWidth });
      pieceX += this.randomBetween(900, 1700);
    }
    return foregroundPieces;
  }

  /** Sunken temple fragments placed in the parallax space of the middle ridge layer. */
  createDistantRuins(chunkLeft, chunkRight) {
    const distantRuins = [];
    let ruinX = chunkLeft + this.randomBetween(200, 600);
    while (ruinX < chunkRight) {
      const path = new Path2D();
      const columnCount = 3 + Math.floor(this.random() * 3);
      const columnSpacing = this.randomBetween(34, 48);
      const columnWidth = columnSpacing * 0.42;
      const fullHeight = this.randomBetween(110, 180);
      const totalWidth = (columnCount - 1) * columnSpacing;
      const columnTops = [];
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const columnX = -totalWidth / 2 + columnIndex * columnSpacing;
        const isBroken = this.random() < 0.4;
        const columnHeight = isBroken ? fullHeight * this.randomBetween(0.35, 0.7) : fullHeight;
        // A slanted top makes broken columns read as snapped stone.
        const slant = isBroken ? this.randomBetween(-10, 10) : 0;
        path.moveTo(columnX - columnWidth / 2, 20);
        path.lineTo(columnX - columnWidth / 2, -columnHeight + slant);
        path.lineTo(columnX + columnWidth / 2, -columnHeight - slant);
        path.lineTo(columnX + columnWidth / 2, 20);
        path.closePath();
        columnTops.push({ x: columnX, height: columnHeight, isBroken });
      }
      const hasArch = this.random() < 0.5;
      let sigil = null;
      if (hasArch) {
        const archRadiusOuter = totalWidth / 2 + columnWidth / 2;
        const archRadiusInner = archRadiusOuter - columnWidth * 0.9;
        path.moveTo(-archRadiusOuter, -fullHeight);
        path.arc(0, -fullHeight, archRadiusOuter, Math.PI, 0);
        path.lineTo(archRadiusInner, -fullHeight);
        path.arc(0, -fullHeight, archRadiusInner, 0, Math.PI, true);
        path.closePath();
        sigil = { x: 0, y: -fullHeight * 0.62, radius: Math.min(archRadiusInner * 0.55, fullHeight * 0.22) };
      } else {
        path.rect(-totalWidth / 2 - columnWidth, -fullHeight - 12, totalWidth * 0.6 + columnWidth, 12);
      }
      distantRuins.push({
        layerX: ruinX,
        path,
        sigil,
        halfWidth: totalWidth / 2 + columnWidth * 2,
        glowColor: this.pickFrom(["#5ef2ff", "#8a7dff", "#46ffc8"]),
        phase: this.random() * MathUtils.TAU,
      });
      ruinX += this.randomBetween(900, 1500);
    }
    return distantRuins;
  }

  createLeviathan() {
    const photophores = [];
    for (let lightIndex = 0; lightIndex < 14; lightIndex++) {
      const alongBody = lightIndex / 13;
      photophores.push({ x: MathUtils.lerp(-180, 210, alongBody), y: 14 + Math.sin(alongBody * Math.PI) * 26, phase: this.random() * MathUtils.TAU });
    }
    const bodyOutline = [
      { x: 250, y: 0 }, { x: 205, y: -42 }, { x: 80, y: -72 }, { x: -20, y: -95 }, { x: -50, y: -62 },
      { x: -200, y: -26 }, { x: -275, y: -62 }, { x: -245, y: 0 }, { x: -275, y: 58 },
      { x: -200, y: 26 }, { x: -60, y: 58 }, { x: 80, y: 66 }, { x: 205, y: 40 },
    ];
    const bodyPath = new Path2D();
    traceSmoothClosedPath(bodyPath, bodyOutline);
    this.leviathan = {
      speed: 38,
      scale: 1.15,
      photophores,
      bodyPath,
      // Position lives in the leviathan's own parallax layer; null until the first update knows the view size.
      layerX: null,
      cruiseDepth: this.worldFloorY * 0.4,
      direction: 1,
      // Eases between +1 and -1; passing through 0 reads as the body turning side-on.
      facing: 1,
      turnTimer: MathUtils.randomRange(LEVIATHAN_TURN_INTERVAL.minimum, LEVIATHAN_TURN_INTERVAL.maximum),
    };
  }

  /** The leviathan swims on its own; the camera only changes where that position lands on screen. */
  updateLeviathan(deltaSeconds, cameraX, viewWidth) {
    const leviathan = this.leviathan;
    const cameraLayerX = cameraX * LEVIATHAN_PARALLAX_X;
    if (leviathan.layerX === null) this.placeLeviathanOffscreen(cameraLayerX, viewWidth, -1);

    leviathan.turnTimer -= deltaSeconds;
    if (leviathan.turnTimer <= 0) {
      leviathan.direction *= -1;
      leviathan.turnTimer = MathUtils.randomRange(LEVIATHAN_TURN_INTERVAL.minimum, LEVIATHAN_TURN_INTERVAL.maximum);
    }
    leviathan.facing = MathUtils.smoothDamp(leviathan.facing, leviathan.direction, 0.8, deltaSeconds);
    // Moving along facing (not direction) makes it slow down through the turn instead of sliding backwards.
    leviathan.layerX += leviathan.facing * leviathan.speed * deltaSeconds;

    const screenX = leviathan.layerX - cameraLayerX;
    const isLeftFarBehind = screenX < -LEVIATHAN_OFFSCREEN_LIMIT || screenX > viewWidth + LEVIATHAN_OFFSCREEN_LIMIT;
    if (isLeftFarBehind) this.placeLeviathanOffscreen(cameraLayerX, viewWidth, Math.random() < 0.5 ? -1 : 1);
  }

  /** On an unbounded map the player can outswim it; it then returns from off-screen, heading into view. */
  placeLeviathanOffscreen(cameraLayerX, viewWidth, side) {
    const leviathan = this.leviathan;
    const gapBeyondEdge = MathUtils.randomRange(500, 1800);
    const screenX = side < 0 ? -gapBeyondEdge : viewWidth + gapBeyondEdge;
    leviathan.layerX = cameraLayerX + screenX;
    leviathan.direction = -side;
    leviathan.facing = leviathan.direction;
    leviathan.turnTimer = MathUtils.randomRange(LEVIATHAN_TURN_INTERVAL.minimum, LEVIATHAN_TURN_INTERVAL.maximum);
  }

  /** Rocks and vent chimneys; drawn before the sand so the sand buries their bases. */
  drawBackTerrain(context, visibleLeft, visibleRight, time) {
    const visibleRocks = this.rocks.filter((rock) => SeaScenery.isHorizontallyVisible(rock, visibleLeft, visibleRight));
    const visibleVents = this.vents.filter((vent) => SeaScenery.isHorizontallyVisible(vent, visibleLeft, visibleRight));
    for (const rock of visibleRocks) {
      for (const part of rock.parts) {
        context.fillStyle = part.bodyGradient;
        context.fill(part.path, part.fillRule);
        context.fillStyle = part.rimGradient;
        context.fill(part.path, part.fillRule);
      }
      if (rock.cracksPath) {
        const pulse = 0.55 + 0.45 * Math.sin(time * 0.9 + rock.phase);
        context.strokeStyle = ColorUtils.toRgba(rock.glowColor, 0.55 * pulse);
        context.lineWidth = 2;
        context.stroke(rock.cracksPath);
      }
    }
    for (const vent of visibleVents) {
      context.fillStyle = vent.bodyGradient;
      context.fill(vent.chimneyPath);
    }

    context.save();
    context.globalCompositeOperation = "lighter";
    for (const rock of visibleRocks) {
      const pulse = 0.55 + 0.45 * Math.sin(time * 0.9 + rock.phase);
      if (rock.innerGlow) {
        drawGlowSprite(context, rock.innerGlow.x, rock.innerGlow.y, rock.innerGlow.radius * 1.3, rock.glowColor, 0.2 * pulse);
      }
      for (const crackPoint of rock.crackGlowPoints || []) {
        drawGlowSprite(context, crackPoint.x, crackPoint.y + 30, 60, rock.glowColor, 0.28 * pulse);
      }
      for (const moss of rock.mossLights) {
        const twinkle = 0.5 + 0.5 * Math.sin(time * 1.7 + moss.phase);
        drawGlowSprite(context, moss.x, moss.y, moss.radius * 3.2, rock.glowColor, 0.55 * twinkle);
      }
    }
    context.restore();
  }

  drawFloorDetails(context, visibleLeft, visibleRight, time) {
    const visibleChunks = this.floorDetailChunks.filter((chunk) => SeaScenery.isHorizontallyVisible(chunk, visibleLeft, visibleRight));
    context.fillStyle = "rgba(120,170,190,0.07)";
    for (const chunk of visibleChunks) context.fill(chunk.ripplePath);
    context.fillStyle = "rgba(3,10,18,0.6)";
    for (const chunk of visibleChunks) context.fill(chunk.pebblePath);
    context.fillStyle = "rgba(150,64,92,0.5)";
    for (const chunk of visibleChunks) context.fill(chunk.starfishPath);
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const chunk of visibleChunks) {
      for (const speck of chunk.glowSpecks) {
        const twinkle = 0.5 + 0.5 * Math.sin(time * 1.3 + speck.phase);
        drawGlowSprite(context, speck.x, speck.y, speck.radius * 2.2, speck.color, 0.35 * twinkle);
      }
    }
    context.restore();
  }

  /** Rotates the canvas around a coral's base so fans sway like they are in a current. */
  applyCoralSway(context, coral, time) {
    const swayAngle = Math.sin(time * 0.7 + coral.phase) * 0.05;
    context.translate(coral.baseX, coral.baseY);
    context.rotate(swayAngle);
    context.translate(-coral.baseX, -coral.baseY);
  }

  drawCorals(context, visibleLeft, visibleRight, time) {
    const visibleCorals = this.corals.filter((coral) => SeaScenery.isHorizontallyVisible(coral, visibleLeft, visibleRight));
    for (const coral of visibleCorals) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 1.2 + coral.phase);
      if (coral.kind === "staghorn") {
        context.fillStyle = coral.bodyColor;
        context.fill(coral.path);
      } else if (coral.kind === "seaFan") {
        context.save();
        this.applyCoralSway(context, coral, time);
        context.fillStyle = ColorUtils.toRgba(coral.bodyColor, 0.3);
        context.fill(coral.membranePath);
        context.fillStyle = coral.bodyColor;
        context.fill(coral.ribPath);
        context.restore();
      } else if (coral.kind === "brain") {
        context.fillStyle = coral.bodyGradient;
        context.fill(coral.domePath);
        context.strokeStyle = ColorUtils.toRgba(coral.glowColor, 0.14 + 0.12 * pulse);
        context.lineWidth = 1.5;
        context.stroke(coral.groovePath);
      } else {
        context.fillStyle = coral.bodyColor;
        context.fill(coral.bodyPath);
        context.fillStyle = "#04060c";
        for (const tube of coral.tubes) {
          context.beginPath();
          context.ellipse(tube.x, tube.y, tube.radius * 0.8, tube.radius * 0.38, tube.angle, 0, MathUtils.TAU);
          context.fill();
        }
      }
    }

    context.save();
    context.globalCompositeOperation = "lighter";
    for (const coral of visibleCorals) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 1.2 + coral.phase);
      if (coral.kind === "staghorn") {
        coral.tips.forEach((tip, tipIndex) => {
          const twinkle = 0.55 + 0.45 * Math.sin(time * 2 + coral.phase + tipIndex * 1.7);
          drawGlowSprite(context, tip.x, tip.y, tip.radius * 5 + 6, coral.glowColor, 0.5 * twinkle);
        });
      } else if (coral.kind === "seaFan") {
        context.save();
        this.applyCoralSway(context, coral, time);
        drawGlowSprite(context, coral.baseX, coral.baseY - coral.height * 0.55, coral.height * 0.8, coral.glowColor, 0.1 * pulse);
        coral.rimPoints.forEach((rimPoint, rimIndex) => {
          const twinkle = 0.5 + 0.5 * Math.sin(time * 1.6 + coral.phase + rimIndex);
          drawGlowSprite(context, rimPoint.x, rimPoint.y, 9, coral.glowColor, 0.45 * twinkle);
        });
        context.restore();
      } else if (coral.kind === "brain") {
        drawGlowSprite(context, coral.baseX, coral.baseY - coral.radiusY * 0.5, coral.radiusX * 1.6, coral.glowColor, 0.1 * pulse);
      } else {
        for (const tube of coral.tubes) {
          drawGlowSprite(context, tube.x, tube.y, tube.radius * 4, coral.glowColor, 0.55 * pulse);
        }
      }
    }
    context.restore();
  }

  /** Dark smoke puffs rising from each chimney plus the orange heat glow at the mouth. */
  drawVentEffects(context, visibleLeft, visibleRight, time) {
    const visibleVents = this.vents.filter((vent) => SeaScenery.isHorizontallyVisible(vent, visibleLeft, visibleRight));
    if (visibleVents.length === 0) return;
    const puffCount = 12;
    const getPuff = (vent, puffIndex) => {
      const progress = (time * 0.09 + puffIndex / puffCount + vent.phase) % 1;
      return {
        progress,
        x: vent.mouthX + Math.sin(progress * 5 + time * 0.5 + vent.phase) * 26 * progress + progress * 40,
        y: vent.mouthY - progress * vent.plumeHeight,
        radius: 10 + progress * 48,
      };
    };
    for (const vent of visibleVents) {
      for (let puffIndex = 0; puffIndex < puffCount; puffIndex++) {
        const puff = getPuff(vent, puffIndex);
        const alpha = 0.32 * (1 - puff.progress) * Math.min(1, puff.progress * 8);
        context.fillStyle = `rgba(8,10,12,${alpha.toFixed(3)})`;
        context.beginPath();
        context.arc(puff.x, puff.y, puff.radius, 0, MathUtils.TAU);
        context.fill();
      }
    }
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const vent of visibleVents) {
      const flicker = 0.78 + 0.22 * Math.sin(time * 7 + vent.phase) * Math.sin(time * 3.1 + vent.phase * 2);
      drawGlowSprite(context, vent.mouthX, vent.mouthY, 40, "#ffb36b", 0.8 * flicker);
      drawGlowSprite(context, vent.mouthX, vent.mouthY + 24, 160, "#ff6a2a", 0.22 * flicker);
      for (let puffIndex = 0; puffIndex < puffCount; puffIndex++) {
        const puff = getPuff(vent, puffIndex);
        if (puff.progress > 0.3) continue;
        drawGlowSprite(context, puff.x, puff.y, puff.radius * 1.4, "#ff7a2e", 0.22 * (1 - puff.progress / 0.3));
      }
    }
    context.restore();
  }

  /** Called in screen space right after the middle ridge layer, so ruins sit on its crest. */
  drawDistantRuins(context, cameraX, parallax, getGroundScreenY, fillColor, time, viewWidth) {
    const layerLeft = cameraX * parallax;
    if (this.ruinStream.streamRange(layerLeft, layerLeft + viewWidth)) {
      this.distantRuins = this.ruinStream.collect("distantRuins");
    }
    for (const ruin of this.distantRuins) {
      const screenX = ruin.layerX - cameraX * parallax;
      if (screenX + ruin.halfWidth < 0 || screenX - ruin.halfWidth > viewWidth) continue;
      context.save();
      context.translate(screenX, getGroundScreenY(ruin.layerX) + 12);
      context.fillStyle = fillColor;
      context.fill(ruin.path);
      if (ruin.sigil) {
        const sigil = ruin.sigil;
        const pulse = 0.55 + 0.45 * Math.sin(time * 0.8 + ruin.phase);
        context.globalCompositeOperation = "lighter";
        drawGlowSprite(context, sigil.x, sigil.y, sigil.radius * 3.4, ruin.glowColor, 0.3 * pulse);
        context.strokeStyle = ColorUtils.toRgba(ruin.glowColor, 0.5 * pulse);
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(sigil.x, sigil.y, sigil.radius, 0, MathUtils.TAU);
        context.stroke();
        context.beginPath();
        for (let cornerIndex = 0; cornerIndex < 3; cornerIndex++) {
          const angle = time * 0.2 + ruin.phase + (cornerIndex / 3) * MathUtils.TAU;
          const cornerX = sigil.x + Math.cos(angle) * sigil.radius * 0.72;
          const cornerY = sigil.y + Math.sin(angle) * sigil.radius * 0.72;
          if (cornerIndex === 0) context.moveTo(cornerX, cornerY);
          else context.lineTo(cornerX, cornerY);
        }
        context.closePath();
        context.stroke();
      }
      context.restore();
    }
  }

  /**
   * Drawn inside the world transform, scaled around the camera so these pieces
   * move faster than the playfield and read as being close to the viewer.
   */
  drawForeground(context, cameraX, cameraY, visibleLeft, visibleRight, time) {
    const halfVisibleWidth = (visibleRight - visibleLeft) / 2 / SCENERY_FOREGROUND_PARALLAX;
    const layerLeft = cameraX - halfVisibleWidth;
    const layerRight = cameraX + halfVisibleWidth;
    const visiblePieces = this.foregroundPieces.filter((piece) => SeaScenery.isHorizontallyVisible(piece, layerLeft, layerRight));
    if (visiblePieces.length === 0) return;
    context.save();
    context.translate(cameraX, cameraY);
    context.scale(SCENERY_FOREGROUND_PARALLAX, SCENERY_FOREGROUND_PARALLAX);
    context.translate(-cameraX, -cameraY);
    const bladeTips = [];
    for (const piece of visiblePieces) {
      context.fillStyle = "rgba(1,4,9,0.94)";
      for (const blade of piece.blades) {
        const segmentCount = 8;
        const leftEdge = [];
        const rightEdge = [];
        for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
          const heightFraction = segmentIndex / segmentCount;
          const sway = Math.sin(time * 0.8 + blade.phase + heightFraction * 2) * 40 * heightFraction * heightFraction;
          const spineX = blade.baseX + sway;
          const spineY = blade.baseY - blade.height * heightFraction;
          const halfWidth = (blade.width / 2) * (1 - heightFraction * 0.9);
          leftEdge.push({ x: spineX - halfWidth, y: spineY });
          rightEdge.push({ x: spineX + halfWidth, y: spineY });
        }
        const bladePath = new Path2D();
        appendRibbonPolygon(bladePath, leftEdge, rightEdge);
        context.fill(bladePath);
        if (blade.hasLight) bladeTips.push({ point: leftEdge[segmentCount], phase: blade.phase });
      }
      context.fill(piece.rockPath);
    }
    context.globalCompositeOperation = "lighter";
    for (const tip of bladeTips) {
      const twinkle = 0.5 + 0.5 * Math.sin(time * 1.5 + tip.phase);
      drawGlowSprite(context, tip.point.x, tip.point.y, 16, "#5ef2ff", 0.4 * twinkle);
    }
    context.restore();
  }

  /** A huge far-water silhouette; its screen position is its own layer position seen through the camera's parallax. */
  drawLeviathan(context, viewWidth, viewHeight, cameraX, cameraY, time, depthFraction) {
    const leviathan = this.leviathan;
    if (leviathan.layerX === null) return;
    const centerX = leviathan.layerX - cameraX * LEVIATHAN_PARALLAX_X;
    if (centerX < -500 || centerX > viewWidth + 500) return;
    const bobOffset = Math.sin(time * 0.12) * 40;
    const centerY = viewHeight * 0.42 + (leviathan.cruiseDepth - cameraY) * LEVIATHAN_PARALLAX_Y + bobOffset;
    const visibility = 0.35 + 0.65 * depthFraction;
    const swimFlex = 1 + Math.sin(time * 0.9) * 0.04;
    context.save();
    context.translate(centerX, centerY);
    // The body path faces +x; mirroring by facing turns it around without a second path.
    context.scale(leviathan.scale * leviathan.facing, leviathan.scale * swimFlex);
    context.fillStyle = `rgba(1,6,13,${(0.55 * visibility).toFixed(3)})`;
    context.fill(leviathan.bodyPath);
    context.globalCompositeOperation = "lighter";
    drawGlowSprite(context, 215, -6, 22, "#9dfcff", 0.5 * visibility);
    for (const light of leviathan.photophores) {
      const twinkle = 0.45 + 0.55 * Math.sin(time * 1.4 + light.phase);
      drawGlowSprite(context, light.x, light.y, 9, "#5ef2ff", 0.4 * twinkle * visibility);
    }
    context.restore();
  }
}
