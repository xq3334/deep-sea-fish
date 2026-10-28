"use strict";

/**
 * Body plans and palettes. Every fish is drawn procedurally from these values:
 * silhouette, fins, pattern and eye all derive from the species definition.
 */
const FISH_SPECIES = {
  silverMinnow: {
    bodyHeightRatio: 0.32, tailStyle: "fork", pattern: "lateral", dorsalHeight: 0.12,
    backColor: "#2d6684", midColor: "#86c9d9", bellyColor: "#eef8f4",
    finColor: "#a8e6ff", accentColor: "#ffffff", irisColor: "#1d3440",
    glowColor: "#a8e6ff", glowStrength: 0,
  },
  coralClown: {
    bodyHeightRatio: 0.46, tailStyle: "round", pattern: "bands", dorsalHeight: 0.14,
    backColor: "#d24a17", midColor: "#ff8236", bellyColor: "#ffc078",
    finColor: "#ff9447", accentColor: "#fff7ee", irisColor: "#2a1206",
    glowColor: "#ff9447", glowStrength: 0,
  },
  royalTang: {
    bodyHeightRatio: 0.56, tailStyle: "lunate", pattern: "chevrons", dorsalHeight: 0.13,
    backColor: "#1a3a9e", midColor: "#2f72dc", bellyColor: "#86bcff",
    finColor: "#ffd23f", accentColor: "#0b1640", irisColor: "#0b1640",
    glowColor: "#4f9cff", glowStrength: 0,
  },
  lanternFish: {
    bodyHeightRatio: 0.34, tailStyle: "fork", pattern: "photophores", dorsalHeight: 0.11,
    backColor: "#1b2340", midColor: "#3b4b7a", bellyColor: "#a3b0dc",
    finColor: "#7d90d4", accentColor: "#7dfcff", irisColor: "#0a1024",
    glowColor: "#7dfcff", glowStrength: 0.26,
  },
  stripedBarracuda: {
    bodyHeightRatio: 0.21, tailStyle: "fork", pattern: "chevrons", dorsalSpikes: true, hasTeeth: true, dorsalHeight: 0.1,
    backColor: "#344857", midColor: "#8ca5b2", bellyColor: "#e6f0f3",
    finColor: "#a7bfcb", accentColor: "#1b2833", irisColor: "#c9a640",
    glowColor: "#a7bfcb", glowStrength: 0,
  },
  spottedGrouper: {
    bodyHeightRatio: 0.42, tailStyle: "round", pattern: "spots", dorsalSpikes: true, dorsalHeight: 0.13,
    backColor: "#4a3326", midColor: "#8c5f3b", bellyColor: "#dcb88c",
    finColor: "#9c6b43", accentColor: "#2a1910", irisColor: "#d2a24a",
    glowColor: "#9c6b43", glowStrength: 0,
  },
  abyssAngler: {
    bodyHeightRatio: 0.62, tailStyle: "round", pattern: "spots", hasLure: true, hasTeeth: true, dorsalHeight: 0.1,
    backColor: "#1a1322", midColor: "#3a2b46", bellyColor: "#6c5a7c",
    finColor: "#4c3a5c", accentColor: "#120c18", irisColor: "#e8d27a",
    glowColor: "#ffe08a", glowStrength: 0.16,
  },
};

const FishRenderer = {
  spineSampleCount: 16,

  /** Normalized half-height of the body: 0 at the nose, a slim peduncle at the tail base. */
  bodyProfile(along) {
    const peduncleFraction = 0.16;
    const rounded = Math.max(Math.sin(Math.PI * Math.pow(along, 0.62)), 0);
    return rounded * (1 - peduncleFraction) + peduncleFraction * along * along;
  },

  buildBodyGeometry(fish, totalLength, bendSign) {
    const bodyLength = totalLength * 0.78;
    const maximumHalfHeight = totalLength * fish.species.bodyHeightRatio * 0.5;
    const headX = totalLength * 0.48;
    const sampleCount = FishRenderer.spineSampleCount;
    const spine = [];
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
      // Denser samples near the head keep the nose round.
      const along = Math.pow(sampleIndex / sampleCount, 1.35);
      const swimWave = Math.sin(fish.swimPhase - along * 4.4) * fish.swimIntensity * totalLength * (0.003 + along * along * 0.03);
      const turnBend = fish.bodyBend * bendSign * along * along * totalLength * 0.16;
      spine.push({ x: headX - along * bodyLength, y: swimWave + turnBend, along, halfHeight: FishRenderer.bodyProfile(along) * maximumHalfHeight });
    }
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
      const previous = spine[Math.max(0, sampleIndex - 1)];
      const next = spine[Math.min(sampleCount, sampleIndex + 1)];
      const tangentLength = Math.hypot(next.x - previous.x, next.y - previous.y) || 1;
      const point = spine[sampleIndex];
      point.tangentX = (next.x - previous.x) / tangentLength;
      point.tangentY = (next.y - previous.y) / tangentLength;
      point.upX = -point.tangentY;
      point.upY = point.tangentX;
    }
    const topEdge = spine.map((point) => ({ x: point.x + point.upX * point.halfHeight, y: point.y + point.upY * point.halfHeight }));
    const bottomEdge = spine.map((point) => ({ x: point.x - point.upX * point.halfHeight, y: point.y - point.upY * point.halfHeight }));
    const outline = topEdge.concat(bottomEdge.slice(1).reverse());
    return { spine, outline, totalLength, bodyLength, maximumHalfHeight, headX, bendSign };
  },

  /** Interpolated spine frame at any normalized position along the body. */
  sampleSpine(geometry, along) {
    const spine = geometry.spine;
    const clampedAlong = MathUtils.clamp(along, 0, 1);
    let upperIndex = 1;
    while (upperIndex < spine.length - 1 && spine[upperIndex].along < clampedAlong) upperIndex++;
    const lower = spine[upperIndex - 1];
    const upper = spine[upperIndex];
    const fraction = (clampedAlong - lower.along) / Math.max(upper.along - lower.along, 1e-6);
    const blend = (key) => MathUtils.lerp(lower[key], upper[key], fraction);
    return { x: blend("x"), y: blend("y"), halfHeight: blend("halfHeight"), upX: blend("upX"), upY: blend("upY"), tangentX: blend("tangentX"), tangentY: blend("tangentY") };
  },
  /** Fills the current path, then draws fine fin rays clipped inside it. */
  fillFinWithRays(context, fillStyle, rayColor, rayWidth, drawRays) {
    context.fillStyle = fillStyle;
    context.fill();
    if (!drawRays) return;
    context.save();
    context.clip();
    context.strokeStyle = rayColor;
    context.lineWidth = rayWidth;
    context.lineCap = "round";
    context.beginPath();
    drawRays();
    context.stroke();
    context.restore();
  },

  drawTailFin(context, fish, geometry, detailed) {
    const species = fish.species;
    const finScale = fish.finScale || 1;
    const tailRoot = geometry.spine[geometry.spine.length - 1];
    const rootHalfHeight = Math.max(tailRoot.halfHeight, geometry.maximumHalfHeight * 0.12);
    const isVeil = species.tailStyle === "veil";
    const tailLength = geometry.totalLength * (isVeil ? 0.42 : 0.27) * finScale;
    const tailSpread = geometry.maximumHalfHeight * (isVeil ? 1.45 : 1.1) * finScale;
    const tailAngle = Math.atan2(tailRoot.tangentY, tailRoot.tangentX)
      + Math.sin(fish.swimPhase - 4.8) * fish.swimIntensity * 0.32;
    const trailingFlex = Math.sin(fish.swimPhase - 5.9) * fish.swimIntensity * 0.3 + fish.bodyBend * geometry.bendSign * 0.25;

    context.save();
    context.translate(tailRoot.x, tailRoot.y);
    context.rotate(tailAngle);
    // Skewing y by x makes the trailing edge lag behind the root, like a flexible membrane.
    context.transform(1, trailingFlex, 0, 1, 0, 0);
    FishRenderer.traceTailPath(context, species.tailStyle, tailLength, tailSpread, rootHalfHeight, fish.swimPhase);

    const finGradient = context.createLinearGradient(0, 0, tailLength, 0);
    finGradient.addColorStop(0, ColorUtils.toRgba(species.finColor, 0.95));
    finGradient.addColorStop(0.55, ColorUtils.toRgba(species.finColor, 0.62));
    finGradient.addColorStop(1, ColorUtils.toRgba(species.finEdgeColor || species.finColor, 0.28));
    const rayCount = isVeil ? 11 : 8;
    FishRenderer.fillFinWithRays(context, finGradient, ColorUtils.toRgba(species.backColor, 0.28), Math.max(0.5, geometry.totalLength * 0.006), detailed && (() => {
      for (let rayIndex = 0; rayIndex < rayCount; rayIndex++) {
        const spreadFraction = rayIndex / (rayCount - 1) * 2 - 1;
        context.moveTo(0, spreadFraction * rootHalfHeight * 0.8);
        context.quadraticCurveTo(tailLength * 0.5, spreadFraction * tailSpread * 0.55, tailLength * 1.2, spreadFraction * tailSpread * 1.25);
      }
    }));
    context.restore();
  },
  /** Tail outline in tail-local space: root at x=0, fin extends toward +x. */
  traceTailPath(context, tailStyle, tailLength, tailSpread, rootHalfHeight, swimPhase) {
    context.beginPath();
    context.moveTo(0, -rootHalfHeight);
    if (tailStyle === "fork") {
      context.quadraticCurveTo(tailLength * 0.45, -tailSpread * 0.55, tailLength, -tailSpread);
      context.quadraticCurveTo(tailLength * 0.62, -tailSpread * 0.2, tailLength * 0.5, 0);
      context.quadraticCurveTo(tailLength * 0.62, tailSpread * 0.2, tailLength, tailSpread);
      context.quadraticCurveTo(tailLength * 0.45, tailSpread * 0.55, 0, rootHalfHeight);
    } else if (tailStyle === "lunate") {
      context.quadraticCurveTo(tailLength * 0.5, -tailSpread * 0.5, tailLength * 1.05, -tailSpread * 1.1);
      context.quadraticCurveTo(tailLength * 0.55, 0, tailLength * 1.05, tailSpread * 1.1);
      context.quadraticCurveTo(tailLength * 0.5, tailSpread * 0.5, 0, rootHalfHeight);
    } else if (tailStyle === "veil") {
      // Long flowing tail whose trailing edge ripples.
      const rippleCount = 5;
      context.bezierCurveTo(tailLength * 0.35, -tailSpread * 0.9, tailLength * 0.8, -tailSpread * 1.15, tailLength, -tailSpread * 0.85);
      for (let rippleIndex = 1; rippleIndex <= rippleCount; rippleIndex++) {
        const edgeFraction = rippleIndex / rippleCount;
        const edgeY = MathUtils.lerp(-tailSpread * 0.85, tailSpread * 0.85, edgeFraction);
        const rippleX = tailLength * (1.02 + 0.07 * Math.sin(swimPhase * 0.8 + rippleIndex * 1.7));
        const previousY = MathUtils.lerp(-tailSpread * 0.85, tailSpread * 0.85, (rippleIndex - 0.5) / rippleCount);
        context.quadraticCurveTo(rippleX + tailLength * 0.06, previousY, tailLength * (0.96 + 0.04 * Math.sin(rippleIndex)), edgeY);
      }
      context.bezierCurveTo(tailLength * 0.8, tailSpread * 1.15, tailLength * 0.35, tailSpread * 0.9, 0, rootHalfHeight);
    } else {
      context.bezierCurveTo(tailLength * 0.5, -tailSpread, tailLength * 1.08, -tailSpread * 0.75, tailLength, 0);
      context.bezierCurveTo(tailLength * 1.08, tailSpread * 0.75, tailLength * 0.5, tailSpread, 0, rootHalfHeight);
    }
    context.closePath();
  },

  /** A point on the body surface: verticalFraction +1 = dorsal edge, -1 = belly edge. */
  pointOnBody(geometry, along, verticalFraction) {
    const frame = FishRenderer.sampleSpine(geometry, along);
    return {
      x: frame.x + frame.upX * frame.halfHeight * verticalFraction,
      y: frame.y + frame.upY * frame.halfHeight * verticalFraction,
      frame,
    };
  },
  /**
   * Dorsal (side = +1) or anal (side = -1) fin: a membrane rooted inside the body edge,
   * swept back toward the tail and rippling with the swim phase.
   */
  drawMembraneFin(context, fish, geometry, startAlong, endAlong, side, heightFraction, withSpikes, detailed) {
    const species = fish.species;
    const sampleCount = withSpikes ? 9 : 7;
    const basePoints = [];
    const tipPoints = [];
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
      const progress = sampleIndex / sampleCount;
      const along = MathUtils.lerp(startAlong, endAlong, progress);
      const basePoint = FishRenderer.pointOnBody(geometry, along, side * 0.82);
      const frame = basePoint.frame;
      const envelope = Math.sin(Math.PI * Math.pow(progress, 0.7));
      const ripple = 1 + Math.sin(fish.swimPhase * 0.9 - along * 7) * 0.12;
      const spikeFactor = withSpikes && sampleIndex % 2 === 1 ? 0.7 : 1;
      const finHeight = geometry.totalLength * heightFraction * (fish.finScale || 1) * envelope * ripple * spikeFactor;
      const normalX = frame.upX * side;
      const normalY = frame.upY * side;
      basePoints.push({ x: basePoint.x, y: basePoint.y });
      tipPoints.push({
        x: basePoint.x + normalX * finHeight + frame.tangentX * finHeight * 0.4,
        y: basePoint.y + normalY * finHeight + frame.tangentY * finHeight * 0.4,
      });
    }
    context.beginPath();
    context.moveTo(basePoints[0].x, basePoints[0].y);
    if (withSpikes) {
      for (const tipPoint of tipPoints) context.lineTo(tipPoint.x, tipPoint.y);
    } else {
      traceSmoothOpenPath(context, tipPoints, false);
    }
    for (let pointIndex = basePoints.length - 1; pointIndex >= 0; pointIndex--) {
      context.lineTo(basePoints[pointIndex].x, basePoints[pointIndex].y);
    }
    context.closePath();

    const middleIndex = Math.floor(sampleCount / 2);
    const finGradient = context.createLinearGradient(
      basePoints[middleIndex].x, basePoints[middleIndex].y, tipPoints[middleIndex].x, tipPoints[middleIndex].y
    );
    finGradient.addColorStop(0, ColorUtils.toRgba(species.finColor, 0.92));
    finGradient.addColorStop(1, ColorUtils.toRgba(species.finEdgeColor || species.finColor, 0.38));
    FishRenderer.fillFinWithRays(context, finGradient, ColorUtils.toRgba(species.backColor, 0.3), Math.max(0.4, geometry.totalLength * 0.005), detailed && (() => {
      for (let pointIndex = 1; pointIndex < basePoints.length - 1; pointIndex++) {
        context.moveTo(basePoints[pointIndex].x, basePoints[pointIndex].y);
        context.lineTo(tipPoints[pointIndex].x, tipPoints[pointIndex].y);
      }
    }));
  },

  drawPairedFin(context, fish, geometry, along, verticalFraction, lengthFraction, widthFraction, flapSpeed, alpha) {
    const species = fish.species;
    const anchor = FishRenderer.pointOnBody(geometry, along, verticalFraction);
    const backAngle = Math.atan2(anchor.frame.tangentY, anchor.frame.tangentX);
    // Angled backward and toward the belly; the belly side is -up.
    const bellyAngle = Math.atan2(-anchor.frame.upY, -anchor.frame.upX);
    const restAngle = backAngle + MathUtils.normalizeAngle(bellyAngle - backAngle) * 0.45;
    const flapAngle = restAngle + Math.sin(fish.swimPhase * flapSpeed) * 0.32;
    const finLength = geometry.totalLength * lengthFraction * (fish.finScale || 1);
    const finGradient = context.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, finLength);
    finGradient.addColorStop(0, ColorUtils.toRgba(species.finColor, alpha));
    finGradient.addColorStop(1, ColorUtils.toRgba(species.finEdgeColor || species.finColor, alpha * 0.35));
    drawLeafBlade(context, anchor.x, anchor.y, flapAngle, finLength, geometry.totalLength * widthFraction, finGradient);
  },
  /** A vertical band across the body, curved slightly toward the tail at mid-height. */
  fillBodyBand(context, geometry, centerAlong, halfWidth, curvature, fillStyle) {
    const verticalSteps = 8;
    const frontEdge = [];
    const backEdge = [];
    for (let stepIndex = 0; stepIndex <= verticalSteps; stepIndex++) {
      const vertical = -1.15 + (stepIndex / verticalSteps) * 2.3;
      const bow = curvature * (1 - vertical * vertical * 0.75);
      frontEdge.push(FishRenderer.pointOnBody(geometry, centerAlong - halfWidth + bow, vertical));
      backEdge.push(FishRenderer.pointOnBody(geometry, centerAlong + halfWidth + bow, vertical));
    }
    context.beginPath();
    traceSmoothOpenPath(context, frontEdge, true);
    traceSmoothOpenPath(context, backEdge.reverse(), false);
    context.closePath();
    context.fillStyle = fillStyle;
    context.fill();
  },

  drawPattern(context, fish, geometry, detailed) {
    const species = fish.species;
    const seed = fish.patternSeed || 1;
    if (species.pattern === "lateral") {
      const upperEdge = [];
      const lowerEdge = [];
      for (let along = 0.08; along <= 0.98; along += 0.06) {
        upperEdge.push(FishRenderer.pointOnBody(geometry, along, 0.16));
        lowerEdge.push(FishRenderer.pointOnBody(geometry, along, -0.04));
      }
      const stripeGradient = context.createLinearGradient(geometry.headX, 0, geometry.headX - geometry.bodyLength, 0);
      stripeGradient.addColorStop(0, ColorUtils.toRgba(species.accentColor, 0.15));
      stripeGradient.addColorStop(0.3, ColorUtils.toRgba(species.accentColor, 0.6));
      stripeGradient.addColorStop(1, ColorUtils.toRgba(species.accentColor, 0.08));
      context.beginPath();
      traceSmoothOpenPath(context, upperEdge, true);
      traceSmoothOpenPath(context, lowerEdge.reverse(), false);
      context.closePath();
      context.fillStyle = stripeGradient;
      context.fill();
    } else if (species.pattern === "bands") {
      const bandLayout = [[0.17, 0.065], [0.47, 0.07], [0.77, 0.045]];
      for (const [centerAlong, halfWidth] of bandLayout) {
        FishRenderer.fillBodyBand(context, geometry, centerAlong, halfWidth + 0.02, -0.03, "rgba(26,12,6,0.9)");
        FishRenderer.fillBodyBand(context, geometry, centerAlong, halfWidth, -0.03, ColorUtils.toRgba(species.accentColor, 0.96));
      }
    } else if (species.pattern === "chevrons") {
      for (let barIndex = 0; barIndex < 7; barIndex++) {
        const centerAlong = 0.26 + barIndex * 0.09;
        const barEdges = [];
        for (let stepIndex = 0; stepIndex <= 4; stepIndex++) {
          const vertical = 1.15 - stepIndex * 0.28;
          barEdges.push(FishRenderer.pointOnBody(geometry, centerAlong - 0.02 + (1 - vertical) * 0.05, vertical));
        }
        for (let stepIndex = 4; stepIndex >= 0; stepIndex--) {
          const vertical = 1.15 - stepIndex * 0.28;
          barEdges.push(FishRenderer.pointOnBody(geometry, centerAlong + 0.02 + (1 - vertical) * 0.05, vertical));
        }
        context.beginPath();
        traceSmoothClosedPath(context, barEdges);
        context.fillStyle = ColorUtils.toRgba(species.accentColor, 0.42);
        context.fill();
      }
    } else if (species.pattern === "spots") {
      const spotCount = detailed ? 28 : 12;
      context.fillStyle = ColorUtils.toRgba(species.accentColor, 0.5);
      context.beginPath();
      for (let spotIndex = 0; spotIndex < spotCount; spotIndex++) {
        const along = 0.14 + MathUtils.hashNoise(spotIndex, seed) * 0.8;
        const vertical = -0.75 + MathUtils.hashNoise(spotIndex + 50, seed) * 1.6;
        const spotRadius = geometry.maximumHalfHeight * (0.05 + MathUtils.hashNoise(spotIndex + 100, seed) * 0.07);
        const spotPoint = FishRenderer.pointOnBody(geometry, along, vertical);
        context.moveTo(spotPoint.x + spotRadius, spotPoint.y);
        context.arc(spotPoint.x, spotPoint.y, spotRadius, 0, MathUtils.TAU);
      }
      context.fill();
    } else if (species.pattern === "photophores") {
      FishRenderer.drawPhotophores(context, fish, geometry);
    }
  },
};

FISH_SPECIES.silverMinnow.eyeScale = 0.38;
FISH_SPECIES.stripedBarracuda.eyeScale = 0.46;
FISH_SPECIES.abyssAngler.eyeScale = 0.2;

/** The player's species: a translucent glowing fish with a long veil tail. */
FISH_SPECIES.lumenFry = {
  bodyHeightRatio: 0.38, tailStyle: "veil", pattern: "photophores", dorsalHeight: 0.15, eyeScale: 0.36,
  backColor: "#0b5c78", midColor: "#2fc4c8", bellyColor: "#e4fff8",
  finColor: "#7dfcff", finEdgeColor: "#c58bff", accentColor: "#bffcff", irisColor: "#06303a",
  glowColor: "#5ff2e0", glowStrength: 0.3,
};

Object.assign(FishRenderer, {
  drawPhotophores(context, fish, geometry) {
    const species = fish.species;
    const pulse = 0.7 + 0.3 * Math.sin(fish.glowPhase || 0);
    const dotRadius = Math.max(0.7, geometry.maximumHalfHeight * 0.075);
    const rows = [
      { vertical: -0.66, count: 9, startAlong: 0.16, spanAlong: 0.74 },
      { vertical: -0.22, count: 6, startAlong: 0.24, spanAlong: 0.5 },
    ];
    for (const row of rows) {
      for (let dotIndex = 0; dotIndex < row.count; dotIndex++) {
        const along = row.startAlong + (dotIndex / row.count) * row.spanAlong;
        const point = FishRenderer.pointOnBody(geometry, along, row.vertical);
        drawSoftGlow(context, point.x, point.y, dotRadius * 4.2, species.accentColor, 0.4 * pulse);
        context.fillStyle = ColorUtils.toRgba("#ffffff", 0.88 * pulse);
        context.beginPath();
        context.arc(point.x, point.y, dotRadius, 0, MathUtils.TAU);
        context.fill();
      }
    }
  },

  /** Staggered overlapping circles filled with even-odd produce a fine scale lattice. */
  drawScaleLattice(context, geometry) {
    const scaleRadius = geometry.maximumHalfHeight * 0.17;
    context.beginPath();
    for (let columnIndex = 0; columnIndex < 15; columnIndex++) {
      const along = 0.24 + columnIndex * 0.047;
      const frame = FishRenderer.sampleSpine(geometry, along);
      const rowCount = Math.max(2, Math.round((frame.halfHeight * 2) / (scaleRadius * 1.5)));
      for (let rowIndex = 0; rowIndex <= rowCount; rowIndex++) {
        const vertical = -1 + ((rowIndex + (columnIndex % 2) * 0.5) / rowCount) * 2;
        if (vertical > 1.05) continue;
        const point = FishRenderer.pointOnBody(geometry, along, vertical);
        context.moveTo(point.x + scaleRadius, point.y);
        context.arc(point.x, point.y, scaleRadius, 0, MathUtils.TAU);
      }
    }
    context.fillStyle = "rgba(255,255,255,0.06)";
    context.fill("evenodd");
  },
  drawBody(context, fish, geometry, detailed) {
    const species = fish.species;
    const halfHeight = geometry.maximumHalfHeight;
    context.beginPath();
    traceSmoothClosedPath(context, geometry.outline);
    const bodyGradient = context.createLinearGradient(0, -halfHeight, 0, halfHeight);
    bodyGradient.addColorStop(0, species.backColor);
    bodyGradient.addColorStop(0.48, species.midColor);
    bodyGradient.addColorStop(1, species.bellyColor);
    context.fillStyle = bodyGradient;
    context.fill();

    context.save();
    context.clip();
    FishRenderer.drawPattern(context, fish, geometry, detailed);
    if (detailed) FishRenderer.drawScaleLattice(context, geometry);

    const sheenGradient = context.createLinearGradient(0, -halfHeight, 0, halfHeight * 0.2);
    sheenGradient.addColorStop(0, "rgba(255,255,255,0)");
    sheenGradient.addColorStop(0.45, "rgba(255,255,255,0.16)");
    sheenGradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = sheenGradient;
    context.fillRect(geometry.headX - geometry.bodyLength, -halfHeight, geometry.bodyLength, halfHeight * 1.2);

    if (detailed) {
      const gillTop = FishRenderer.pointOnBody(geometry, 0.17, 0.78);
      const gillMiddle = FishRenderer.pointOnBody(geometry, 0.25, 0);
      const gillBottom = FishRenderer.pointOnBody(geometry, 0.16, -0.78);
      context.beginPath();
      context.moveTo(gillTop.x, gillTop.y);
      context.quadraticCurveTo(gillMiddle.x, gillMiddle.y, gillBottom.x, gillBottom.y);
      context.lineCap = "round";
      context.strokeStyle = ColorUtils.toRgba(species.backColor, 0.35);
      context.lineWidth = Math.max(0.6, halfHeight * 0.06);
      context.stroke();
    }

    // Soft inner rim gives the body volume without a hard outline.
    context.beginPath();
    traceSmoothClosedPath(context, geometry.outline);
    context.strokeStyle = ColorUtils.toRgba(species.backColor, 0.32);
    context.lineWidth = halfHeight * 0.22;
    context.stroke();

    if (fish.flashAmount > 0) {
      context.fillStyle = `rgba(255,255,255,${(fish.flashAmount * 0.7).toFixed(3)})`;
      context.fillRect(geometry.headX - geometry.bodyLength - 2, -halfHeight - 2, geometry.bodyLength + 4, halfHeight * 2 + 4);
    }
    context.restore();
  },

  drawEye(context, fish, geometry) {
    const species = fish.species;
    const eyeCenter = FishRenderer.pointOnBody(geometry, 0.1, 0.24);
    const eyeRadius = Math.max(1.2, geometry.maximumHalfHeight * (species.eyeScale || 0.3));
    const isMenacing = fish.isHunting;
    context.fillStyle = "rgba(0,0,0,0.22)";
    context.beginPath();
    context.arc(eyeCenter.x, eyeCenter.y, eyeRadius * 1.16, 0, MathUtils.TAU);
    context.fill();

    const scleraGradient = context.createRadialGradient(eyeCenter.x - eyeRadius * 0.3, eyeCenter.y - eyeRadius * 0.3, 0, eyeCenter.x, eyeCenter.y, eyeRadius);
    scleraGradient.addColorStop(0, "#ffffff");
    scleraGradient.addColorStop(1, ColorUtils.mixToRgba(species.bellyColor, "#9fb4c0", 0.4, 1));
    context.fillStyle = scleraGradient;
    context.beginPath();
    context.arc(eyeCenter.x, eyeCenter.y, eyeRadius, 0, MathUtils.TAU);
    context.fill();

    const irisColor = isMenacing ? "#ff2f3d" : species.irisColor;
    const irisCenterX = eyeCenter.x + eyeRadius * 0.12;
    const irisGradient = context.createRadialGradient(irisCenterX, eyeCenter.y, 0, irisCenterX, eyeCenter.y, eyeRadius * 0.8);
    irisGradient.addColorStop(0, ColorUtils.mixToRgba(irisColor, "#ffffff", 0.35, 1));
    irisGradient.addColorStop(1, irisColor);
    context.fillStyle = irisGradient;
    context.beginPath();
    context.arc(irisCenterX, eyeCenter.y, eyeRadius * 0.78, 0, MathUtils.TAU);
    context.fill();

    context.fillStyle = "#05070c";
    context.beginPath();
    context.arc(irisCenterX + eyeRadius * 0.08, eyeCenter.y, eyeRadius * (isMenacing ? 0.3 : 0.44), 0, MathUtils.TAU);
    context.fill();

    context.fillStyle = "rgba(255,255,255,0.92)";
    context.beginPath();
    context.arc(eyeCenter.x - eyeRadius * 0.22, eyeCenter.y - eyeRadius * 0.34, eyeRadius * 0.24, 0, MathUtils.TAU);
    context.fill();
    context.fillStyle = "rgba(255,255,255,0.55)";
    context.beginPath();
    context.arc(eyeCenter.x + eyeRadius * 0.34, eyeCenter.y + eyeRadius * 0.3, eyeRadius * 0.1, 0, MathUtils.TAU);
    context.fill();
  },
  /** Filled mouth wedge; opening grows with fish.mouthOpen (0..1). */
  drawMouth(context, fish, geometry) {
    const species = fish.species;
    const halfHeight = geometry.maximumHalfHeight;
    const nose = geometry.spine[0];
    const corner = FishRenderer.pointOnBody(geometry, 0.085, -0.28);
    const minimumOpening = species.hasTeeth ? 0.12 : 0.03;
    const opening = Math.max(minimumOpening, fish.mouthOpen || 0) * halfHeight * 0.75;
    const tipX = nose.x + halfHeight * 0.02;
    const upperLipY = nose.y - halfHeight * 0.06 - opening * 0.35;
    const lowerLipY = nose.y - halfHeight * 0.06 + opening;

    context.fillStyle = "rgba(14,6,10,0.88)";
    context.beginPath();
    context.moveTo(tipX, upperLipY);
    context.quadraticCurveTo(corner.x + halfHeight * 0.08, upperLipY + opening * 0.1, corner.x, corner.y);
    context.quadraticCurveTo(corner.x + halfHeight * 0.1, lowerLipY, tipX - halfHeight * 0.02, lowerLipY);
    context.closePath();
    context.fill();

    if (!species.hasTeeth) return;
    const toothCount = 5;
    const toothLength = Math.max(0.8, halfHeight * 0.13);
    context.fillStyle = "rgba(245,240,226,0.95)";
    context.beginPath();
    for (let toothIndex = 0; toothIndex < toothCount; toothIndex++) {
      const fraction = (toothIndex + 0.5) / toothCount;
      const toothX = MathUtils.lerp(tipX, corner.x, fraction * 0.9);
      const upperY = MathUtils.lerp(upperLipY, corner.y, fraction * fraction);
      const lowerY = MathUtils.lerp(lowerLipY, corner.y, fraction * fraction);
      const toothHalfWidth = toothLength * 0.32;
      context.moveTo(toothX - toothHalfWidth, upperY);
      context.lineTo(toothX + toothHalfWidth, upperY);
      context.lineTo(toothX, upperY + toothLength);
      context.closePath();
      context.moveTo(toothX - toothHalfWidth, lowerY);
      context.lineTo(toothX + toothHalfWidth, lowerY);
      context.lineTo(toothX, lowerY - toothLength * 0.8);
      context.closePath();
    }
    context.fill();
  },

  drawLure(context, fish, geometry) {
    const species = fish.species;
    const base = FishRenderer.pointOnBody(geometry, 0.16, 0.9);
    const sway = Math.sin(fish.glowPhase * 0.7) * 0.25;
    const tip = drawTaperedTentacle(
      context, base.x, base.y, -Math.PI * 0.3, geometry.totalLength * 0.4,
      Math.max(1, geometry.maximumHalfHeight * 0.07), 0.9 + sway, ColorUtils.toRgba(species.finColor, 0.95)
    );
    const pulse = 0.75 + 0.25 * Math.sin(fish.glowPhase * 2.2);
    const bulbRadius = Math.max(1.5, geometry.maximumHalfHeight * 0.13);
    context.save();
    context.globalCompositeOperation = "lighter";
    drawSoftGlow(context, tip.x, tip.y, bulbRadius * 9, species.glowColor, 0.5 * pulse);
    context.restore();
    const bulbGradient = context.createRadialGradient(tip.x - bulbRadius * 0.3, tip.y - bulbRadius * 0.3, 0, tip.x, tip.y, bulbRadius);
    bulbGradient.addColorStop(0, "#ffffff");
    bulbGradient.addColorStop(1, species.glowColor);
    context.fillStyle = bulbGradient;
    context.beginPath();
    context.arc(tip.x, tip.y, bulbRadius, 0, MathUtils.TAU);
    context.fill();
  },

  /**
   * Draws a fish centered at (fish.x, fish.y) heading along fish.heading.
   * Fish facing left are mirrored vertically so the dorsal side always stays on top.
   */
  drawFish(context, fish, pixelsPerUnit) {
    const totalLength = fish.renderSize || fish.size;
    const detailed = totalLength * pixelsPerUnit > 46;
    const rollScale = fish.rollScale !== undefined ? fish.rollScale : (Math.cos(fish.heading) < 0 ? -1 : 1);
    const bendSign = rollScale < 0 ? -1 : 1;
    // Never fully flatten: a sliver of body stays visible mid-roll.
    const verticalScale = bendSign * Math.max(Math.abs(rollScale), 0.14);
    const geometry = FishRenderer.buildBodyGeometry(fish, totalLength, bendSign);
    const species = fish.species;

    context.save();
    context.translate(fish.x, fish.y);
    context.rotate(fish.heading);
    context.scale(1, verticalScale);
    context.globalAlpha = MathUtils.clamp(fish.opacity === undefined ? 1 : fish.opacity, 0, 1);

    if (species.glowStrength > 0) {
      const pulse = 0.75 + 0.25 * Math.sin(fish.glowPhase || 0);
      context.save();
      context.globalCompositeOperation = "lighter";
      drawSoftGlow(context, 0, 0, totalLength * 0.95, species.glowColor, species.glowStrength * pulse);
      context.restore();
    }

    FishRenderer.drawPairedFin(context, fish, geometry, 0.3, -0.35, 0.2, 0.05, 1.3, 0.45);
    FishRenderer.drawTailFin(context, fish, geometry, detailed);
    FishRenderer.drawMembraneFin(context, fish, geometry, 0.24, 0.66, 1, species.dorsalHeight, !!species.dorsalSpikes, detailed);
    FishRenderer.drawMembraneFin(context, fish, geometry, 0.56, 0.8, -1, species.dorsalHeight * 0.6, false, detailed);
    FishRenderer.drawPairedFin(context, fish, geometry, 0.62, -0.85, 0.11, 0.035, 1.1, 0.7);
    FishRenderer.drawBody(context, fish, geometry, detailed);
    FishRenderer.drawPairedFin(context, fish, geometry, 0.27, -0.2, 0.22, 0.06, 1.6, 0.85);
    FishRenderer.drawEye(context, fish, geometry);
    FishRenderer.drawMouth(context, fish, geometry);
    if (species.hasLure) FishRenderer.drawLure(context, fish, geometry);
    context.restore();
  },
});
