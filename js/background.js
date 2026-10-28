"use strict";

/** Traces a smooth open curve through points using midpoint quadratic segments. */
function traceSmoothOpenPath(context, points, startWithMove) {
  if (points.length < 2) return;
  if (startWithMove) context.moveTo(points[0].x, points[0].y);
  else context.lineTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const lastPoint = points[points.length - 1];
  context.lineTo(lastPoint.x, lastPoint.y);
}

/** A pointed leaf / fin blade built from two quadratic curves. */
function drawLeafBlade(context, startX, startY, angle, length, width, fillStyle) {
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const normalX = -directionY;
  const normalY = directionX;
  const tipX = startX + directionX * length;
  const tipY = startY + directionY * length;
  const middleX = startX + directionX * length * 0.42;
  const middleY = startY + directionY * length * 0.42;
  context.fillStyle = fillStyle;
  context.beginPath();
  context.moveTo(startX, startY);
  context.quadraticCurveTo(middleX + normalX * width, middleY + normalY * width, tipX, tipY);
  context.quadraticCurveTo(middleX - normalX * width, middleY - normalY * width, startX, startY);
  context.closePath();
  context.fill();
}

/** A filled, tapering, gently bent tentacle. Returns the tip position. */
function drawTaperedTentacle(context, baseX, baseY, angle, length, baseWidth, bendAmount, fillStyle) {
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const normalX = -directionY;
  const normalY = directionX;
  const tipX = baseX + directionX * length + normalX * bendAmount * length * 0.5;
  const tipY = baseY + directionY * length + normalY * bendAmount * length * 0.5;
  const controlX = baseX + directionX * length * 0.55 + normalX * bendAmount * length * 0.45;
  const controlY = baseY + directionY * length * 0.55 + normalY * bendAmount * length * 0.45;
  const halfWidth = baseWidth / 2;
  context.fillStyle = fillStyle;
  context.beginPath();
  context.moveTo(baseX + normalX * halfWidth, baseY + normalY * halfWidth);
  context.quadraticCurveTo(controlX + normalX * halfWidth * 0.5, controlY + normalY * halfWidth * 0.5, tipX, tipY);
  context.quadraticCurveTo(controlX - normalX * halfWidth * 0.5, controlY - normalY * halfWidth * 0.5, baseX - normalX * halfWidth, baseY - normalY * halfWidth);
  context.closePath();
  context.fill();
  return { x: tipX, y: tipY };
}

class OceanBackground {
  constructor() {
    this.viewWidth = 1;
    this.viewHeight = 1;
    this.pixelRatio = 1;
    this.scrollX = 0;
    this.scrollY = 0;
    this.marineSnowFlakes = [];
    this.lightRays = [];
    this.vignetteCanvas = document.createElement("canvas");
    this.createLightRays();
  }

  resize(viewWidth, viewHeight, pixelRatio) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.pixelRatio = pixelRatio;
    this.createMarineSnow();
    this.renderVignette();
  }

  createLightRays() {
    const rayCount = 7;
    this.lightRays = [];
    for (let rayIndex = 0; rayIndex < rayCount; rayIndex++) {
      this.lightRays.push({
        anchorFraction: (rayIndex + Math.random() * 0.7) / rayCount,
        topWidthFraction: MathUtils.randomRange(0.03, 0.08),
        bottomWidthFraction: MathUtils.randomRange(0.12, 0.24),
        leanFraction: MathUtils.randomRange(-0.28, -0.12),
        swaySpeed: MathUtils.randomRange(0.07, 0.18),
        swayPhase: Math.random() * MathUtils.TAU,
        intensity: MathUtils.randomRange(0.045, 0.1),
        lengthFraction: MathUtils.randomRange(0.65, 1.05),
      });
    }
  }
  createMarineSnow() {
    const flakeCount = Math.round((this.viewWidth * this.viewHeight) / 8000);
    this.marineSnowFlakes = [];
    for (let flakeIndex = 0; flakeIndex < flakeCount; flakeIndex++) {
      this.marineSnowFlakes.push({
        x: Math.random() * this.viewWidth,
        y: Math.random() * this.viewHeight,
        radius: MathUtils.randomRange(0.5, 1.8),
        parallaxDepth: MathUtils.randomRange(0.12, 0.85),
        driftSpeed: MathUtils.randomRange(3, 12),
        twinklePhase: Math.random() * MathUtils.TAU,
        twinkleSpeed: MathUtils.randomRange(0.5, 2),
      });
    }
  }

  renderVignette() {
    const canvas = this.vignetteCanvas;
    canvas.width = Math.max(2, Math.round(this.viewWidth * 0.5));
    canvas.height = Math.max(2, Math.round(this.viewHeight * 0.5));
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const outerRadius = Math.hypot(centerX, centerY);
    const gradient = context.createRadialGradient(centerX, centerY, outerRadius * 0.35, centerX, centerY, outerRadius);
    gradient.addColorStop(0, "rgba(0,4,12,0)");
    gradient.addColorStop(0.65, "rgba(0,4,14,0.28)");
    gradient.addColorStop(1, "rgba(0,2,8,0.82)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawWater(context, depthFraction) {
    const shallowTop = "#0f4a66", shallowBottom = "#041a30";
    const deepTop = "#061a2c", deepBottom = "#010409";
    const waterGradient = context.createLinearGradient(0, 0, 0, this.viewHeight);
    waterGradient.addColorStop(0, ColorUtils.mixToRgba(shallowTop, deepTop, depthFraction, 1));
    waterGradient.addColorStop(1, ColorUtils.mixToRgba(shallowBottom, deepBottom, depthFraction, 1));
    context.fillStyle = waterGradient;
    context.fillRect(0, 0, this.viewWidth, this.viewHeight);

    const surfaceGlowStrength = 0.2 * (1 - depthFraction);
    const surfaceGlow = context.createRadialGradient(
      this.viewWidth * 0.5, -this.viewHeight * 0.35, 0,
      this.viewWidth * 0.5, -this.viewHeight * 0.35, this.viewHeight * 1.1
    );
    surfaceGlow.addColorStop(0, `rgba(150,235,255,${surfaceGlowStrength.toFixed(3)})`);
    surfaceGlow.addColorStop(1, "rgba(150,235,255,0)");
    context.fillStyle = surfaceGlow;
    context.fillRect(0, 0, this.viewWidth, this.viewHeight);
  }

  drawLightRays(context, time, depthFraction, scrollX) {
    const visibility = (1 - depthFraction * 0.85) * 0.6;
    const wrapWidth = this.viewWidth * 1.4;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const ray of this.lightRays) {
      const pulse = 0.55 + 0.45 * Math.sin(time * ray.swaySpeed * MathUtils.TAU + ray.swayPhase);
      const alpha = ray.intensity * pulse * visibility;
      const wrappedX = (((ray.anchorFraction * wrapWidth - scrollX * 0.04) % wrapWidth) + wrapWidth) % wrapWidth;
      const topX = wrappedX - this.viewWidth * 0.2;
      const topHalfWidth = (ray.topWidthFraction * this.viewWidth) / 2;
      const bottomHalfWidth = (ray.bottomWidthFraction * this.viewWidth) / 2;
      const rayLength = ray.lengthFraction * this.viewHeight;
      const bottomX = topX + ray.leanFraction * rayLength + Math.sin(time * 0.3 + ray.swayPhase) * 18;
      const rayGradient = context.createLinearGradient(0, 0, 0, rayLength);
      rayGradient.addColorStop(0, `rgba(170,240,255,${alpha.toFixed(3)})`);
      rayGradient.addColorStop(1, "rgba(170,240,255,0)");
      context.fillStyle = rayGradient;
      context.beginPath();
      context.moveTo(topX - topHalfWidth, 0);
      context.lineTo(topX + topHalfWidth, 0);
      context.lineTo(bottomX + bottomHalfWidth, rayLength);
      context.lineTo(bottomX - bottomHalfWidth, rayLength);
      context.closePath();
      context.fill();
    }
    context.restore();
  }
  /** Distant seabed silhouettes; each layer scrolls at its own parallax factor. */
  drawParallaxRidges(context, cameraX, cameraY, worldFloorY, depthFraction, time = 0) {
    const ridgeLayers = [
      { parallax: 0.22, amplitude: 260, scale: 520, seed: 3, topColor: "#0f4566", bottomColor: "#041a30", lift: 120 },
      { parallax: 0.42, amplitude: 200, scale: 380, seed: 7, topColor: "#0a3352", bottomColor: "#03111f", lift: 60 },
      { parallax: 0.66, amplitude: 150, scale: 260, seed: 11, topColor: "#072640", bottomColor: "#020a14", lift: 10 },
    ];
    const sampleStep = 16;
    for (const layer of ridgeLayers) {
      const baselineY = this.viewHeight * 0.5 + (worldFloorY - cameraY) * layer.parallax - layer.lift;
      if (baselineY - layer.amplitude > this.viewHeight) continue;
      const ridgeGradient = context.createLinearGradient(0, baselineY - layer.amplitude, 0, baselineY + 80);
      ridgeGradient.addColorStop(0, ColorUtils.mixToRgba(layer.topColor, "#020812", depthFraction * 0.6, 0.92));
      ridgeGradient.addColorStop(1, ColorUtils.toRgba(layer.bottomColor, 1));
      context.fillStyle = ridgeGradient;
      context.beginPath();
      context.moveTo(-sampleStep, this.viewHeight + 2);
      const getGroundScreenY = (layerX) => {
        const broadShape = MathUtils.smoothNoise(layerX / layer.scale, layer.seed);
        const fineDetail = MathUtils.smoothNoise(layerX / (layer.scale * 0.31), layer.seed + 17);
        return baselineY - (broadShape * 0.78 + fineDetail * 0.22) * layer.amplitude;
      };
      for (let screenX = -sampleStep; screenX <= this.viewWidth + sampleStep; screenX += sampleStep) {
        context.lineTo(screenX, getGroundScreenY(screenX + cameraX * layer.parallax));
      }
      context.lineTo(this.viewWidth + sampleStep, this.viewHeight + 2);
      context.closePath();
      context.fill();

      // Ruins stand on the middle layer so the front layer can overlap their bases.
      if (layer.seed === 7 && this.scenery) {
        const ruinColor = ColorUtils.mixToRgba(layer.topColor, "#020812", 0.25 + depthFraction * 0.5, 0.95);
        this.scenery.drawDistantRuins(context, cameraX, layer.parallax, getGroundScreenY, ruinColor, time, this.viewWidth);
      }
    }
  }

  drawMarineSnow(context, time, cameraX, cameraY) {
    const width = this.viewWidth;
    const height = this.viewHeight;
    for (const flake of this.marineSnowFlakes) {
      const rawX = flake.x - cameraX * flake.parallaxDepth + Math.sin(time * 0.4 + flake.twinklePhase) * 6;
      const rawY = flake.y - cameraY * flake.parallaxDepth + time * flake.driftSpeed;
      const screenX = ((rawX % width) + width) % width;
      const screenY = ((rawY % height) + height) % height;
      const twinkle = 0.55 + 0.45 * Math.sin(time * flake.twinkleSpeed + flake.twinklePhase);
      const alpha = (0.12 + flake.parallaxDepth * 0.38) * twinkle;
      context.fillStyle = `rgba(205,240,255,${alpha.toFixed(3)})`;
      context.beginPath();
      context.arc(screenX, screenY, flake.radius * (0.6 + flake.parallaxDepth * 0.6), 0, MathUtils.TAU);
      context.fill();
    }
  }

  drawVignette(context) {
    context.drawImage(this.vignetteCanvas, 0, 0, this.viewWidth, this.viewHeight);
  }
  /** The seabed extends without limit horizontally; kelp, anemones and scenery are generated per chunk as the camera moves. */
  createSeabed(worldFloorY) {
    this.worldFloorY = worldFloorY;
    this.kelpStalks = [];
    this.glowAnemones = [];
    this.plantStream = new ChunkStream(SCENERY_TERRAIN_CHUNK_WIDTH,
      (chunkIndex, chunkLeft, chunkRight) => this.generatePlantChunk(chunkIndex, chunkLeft, chunkRight));
    this.scenery = new SeaScenery(worldFloorY, (worldX) => this.getFloorHeightAt(worldX));
  }

  /** Call once per frame with the visible world range before drawing the seabed. */
  streamSeabed(visibleLeft, visibleRight) {
    if (this.plantStream.streamRange(visibleLeft, visibleRight)) {
      this.kelpStalks = this.plantStream.collect("kelpStalks");
      this.glowAnemones = this.plantStream.collect("glowAnemones");
    }
    this.scenery.streamTerrain(visibleLeft, visibleRight);
  }

  generatePlantChunk(chunkIndex, chunkLeft, chunkRight) {
    const random = createSeededRandom(deriveChunkSeed(SCENERY_WORLD_SEED, chunkIndex, 3));
    const randomBetween = (minimum, maximum) => minimum + random() * (maximum - minimum);
    const kelpStalks = [];
    const glowAnemones = [];
    let clusterX = chunkLeft + randomBetween(60, 200);
    while (clusterX < chunkRight) {
      const stalksInCluster = 1 + Math.floor(random() * 4);
      for (let stalkIndex = 0; stalkIndex < stalksInCluster; stalkIndex++) {
        const baseX = clusterX + stalkIndex * randomBetween(12, 26);
        kelpStalks.push({
          baseX,
          baseY: this.getFloorHeightAt(baseX) + 8,
          height: randomBetween(170, 560),
          thickness: randomBetween(7, 13),
          swayPhase: random() * MathUtils.TAU,
          stemColor: ColorUtils.mixToRgba("#123a34", "#1f4f45", random(), 0.95),
          leafColor: ColorUtils.mixToRgba("#1a4a40", "#2c6152", random(), 0.82),
        });
      }
      clusterX += randomBetween(130, 360);
    }
    const anemoneColors = ["#7dfcff", "#ff7bd5", "#b48bff", "#9dff9a"];
    for (let anemoneX = chunkLeft + randomBetween(40, 120); anemoneX < chunkRight; anemoneX += randomBetween(80, 220)) {
      glowAnemones.push({
        x: anemoneX,
        y: this.getFloorHeightAt(anemoneX) + 3,
        radius: randomBetween(6, 12),
        color: anemoneColors[Math.floor(random() * anemoneColors.length)],
        pulsePhase: random() * MathUtils.TAU,
      });
    }
    return { kelpStalks, glowAnemones };
  }

  getFloorHeightAt(worldX) {
    const broadDunes = MathUtils.smoothNoise(worldX / 340, 23) * 90;
    const smallRipples = MathUtils.smoothNoise(worldX / 85, 29) * 18;
    return this.worldFloorY - broadDunes - smallRipples;
  }

  /** The underside of the sea surface, seen from below as a bright shimmering band. */
  drawSurface(context, visibleLeft, visibleRight, visibleTop, time) {
    if (visibleTop > 40) return;
    const surfaceGradient = context.createLinearGradient(0, visibleTop, 0, 30);
    surfaceGradient.addColorStop(0, "rgba(170,235,255,0.55)");
    surfaceGradient.addColorStop(1, "rgba(170,235,255,0)");
    context.fillStyle = surfaceGradient;
    context.fillRect(visibleLeft, visibleTop, visibleRight - visibleLeft, 30 - visibleTop);
    const waveStep = 10;
    const firstWaveX = Math.floor(visibleLeft / waveStep) * waveStep;
    context.beginPath();
    for (let worldX = firstWaveX; worldX <= visibleRight + waveStep; worldX += waveStep) {
      const waveY = Math.sin(worldX * 0.012 + time * 1.4) * 4 + Math.sin(worldX * 0.031 - time * 2.1) * 2;
      if (worldX === firstWaveX) context.moveTo(worldX, waveY);
      else context.lineTo(worldX, waveY);
    }
    context.lineTo(visibleRight + waveStep, visibleTop - 10);
    context.lineTo(firstWaveX, visibleTop - 10);
    context.closePath();
    context.fillStyle = "rgba(190,240,255,0.22)";
    context.fill();
    context.strokeStyle = "rgba(225,250,255,0.6)";
    context.lineWidth = 1.6;
    context.stroke();
  }
  drawSeabed(context, visibleLeft, visibleRight, visibleBottom, time) {
    const scenery = this.scenery;
    if (scenery) scenery.drawBackTerrain(context, visibleLeft, visibleRight, time);
    const floorStep = 14;
    const firstFloorX = Math.floor(visibleLeft / floorStep) * floorStep - floorStep;
    const sandGradient = context.createLinearGradient(0, this.worldFloorY - 120, 0, this.worldFloorY + 200);
    sandGradient.addColorStop(0, "#1c3442");
    sandGradient.addColorStop(0.35, "#0e2130");
    sandGradient.addColorStop(1, "#030a12");
    context.fillStyle = sandGradient;
    context.beginPath();
    context.moveTo(firstFloorX, visibleBottom + 50);
    for (let worldX = firstFloorX; worldX <= visibleRight + floorStep; worldX += floorStep) {
      context.lineTo(worldX, this.getFloorHeightAt(worldX));
    }
    context.lineTo(visibleRight + floorStep, visibleBottom + 50);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(120,190,215,0.12)";
    context.lineWidth = 2;
    context.beginPath();
    for (let worldX = firstFloorX; worldX <= visibleRight + floorStep; worldX += floorStep) {
      const floorY = this.getFloorHeightAt(worldX);
      if (worldX === firstFloorX) context.moveTo(worldX, floorY);
      else context.lineTo(worldX, floorY);
    }
    context.stroke();

    if (scenery) scenery.drawFloorDetails(context, visibleLeft, visibleRight, time);
    for (const stalk of this.kelpStalks) {
      if (stalk.baseX < visibleLeft - 160 || stalk.baseX > visibleRight + 160) continue;
      this.drawKelpStalk(context, stalk, time);
    }
    if (scenery) scenery.drawCorals(context, visibleLeft, visibleRight, time);
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const anemone of this.glowAnemones) {
      if (anemone.x < visibleLeft - 60 || anemone.x > visibleRight + 60) continue;
      this.drawAnemone(context, anemone, time);
    }
    context.restore();
    if (scenery) scenery.drawVentEffects(context, visibleLeft, visibleRight, time);
  }
  /** Kelp is a filled, tapering ribbon whose spine bends more toward the tip. */
  drawKelpStalk(context, stalk, time) {
    const segmentCount = 12;
    const spinePoints = [];
    for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
      const heightFraction = segmentIndex / segmentCount;
      const swayOffset = Math.sin(time * 0.9 + stalk.swayPhase + heightFraction * 2.4) * 34 * heightFraction * heightFraction;
      spinePoints.push({ x: stalk.baseX + swayOffset, y: stalk.baseY - stalk.height * heightFraction, heightFraction });
    }
    const leftEdge = [];
    const rightEdge = [];
    for (let pointIndex = 0; pointIndex < spinePoints.length; pointIndex++) {
      const point = spinePoints[pointIndex];
      const neighbor = spinePoints[Math.min(pointIndex + 1, spinePoints.length - 1)];
      const previous = spinePoints[Math.max(pointIndex - 1, 0)];
      const tangentAngle = Math.atan2(neighbor.y - previous.y, neighbor.x - previous.x);
      const halfWidth = (stalk.thickness / 2) * (1 - point.heightFraction * 0.8);
      leftEdge.push({ x: point.x + Math.cos(tangentAngle - Math.PI / 2) * halfWidth, y: point.y + Math.sin(tangentAngle - Math.PI / 2) * halfWidth });
      rightEdge.push({ x: point.x + Math.cos(tangentAngle + Math.PI / 2) * halfWidth, y: point.y + Math.sin(tangentAngle + Math.PI / 2) * halfWidth });
    }
    context.beginPath();
    traceSmoothOpenPath(context, leftEdge, true);
    traceSmoothOpenPath(context, rightEdge.slice().reverse(), false);
    context.closePath();
    context.fillStyle = stalk.stemColor;
    context.fill();

    for (let pointIndex = 2; pointIndex < spinePoints.length - 1; pointIndex += 1) {
      const point = spinePoints[pointIndex];
      const sideSign = pointIndex % 2 === 0 ? 1 : -1;
      const flutter = Math.sin(time * 1.6 + stalk.swayPhase + pointIndex) * 0.25;
      const leafAngle = -Math.PI / 2 + sideSign * (0.95 - point.heightFraction * 0.3) + flutter;
      const leafLength = stalk.thickness * (3.4 - point.heightFraction * 1.4);
      drawLeafBlade(context, point.x, point.y, leafAngle, leafLength, stalk.thickness * 0.75, stalk.leafColor);
    }
  }

  drawAnemone(context, anemone, time) {
    const pulse = 0.65 + 0.35 * Math.sin(time * 1.8 + anemone.pulsePhase);
    drawSoftGlow(context, anemone.x, anemone.y - anemone.radius, anemone.radius * 4.5, anemone.color, 0.22 * pulse);
    const tentacleCount = 9;
    for (let tentacleIndex = 0; tentacleIndex < tentacleCount; tentacleIndex++) {
      const spreadFraction = tentacleIndex / (tentacleCount - 1) - 0.5;
      const tentacleAngle = -Math.PI / 2 + spreadFraction * 2.1;
      const bend = Math.sin(time * 1.3 + anemone.pulsePhase + tentacleIndex * 0.7) * 0.35;
      const tip = drawTaperedTentacle(
        context, anemone.x, anemone.y, tentacleAngle, anemone.radius * 2.2,
        anemone.radius * 0.42, bend, ColorUtils.toRgba(anemone.color, 0.55 * pulse)
      );
      context.fillStyle = ColorUtils.toRgba("#ffffff", 0.7 * pulse);
      context.beginPath();
      context.arc(tip.x, tip.y, anemone.radius * 0.14, 0, MathUtils.TAU);
      context.fill();
    }
  }
}
