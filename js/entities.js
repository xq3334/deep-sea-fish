"use strict";

/** A fish must be this many times larger than another to swallow it. */
const EAT_SIZE_RATIO = 1.12;
const PLAYER_START_SIZE = 34;
const PLAYER_MAX_SIZE = 260;

/** Interpolates between two angles along the shortest arc. */
function blendAngles(fromAngle, toAngle, amount) {
  return MathUtils.normalizeAngle(fromAngle + MathUtils.normalizeAngle(toAngle - fromAngle) * amount);
}

/** Shared motion model: heading-based steering that also drives the procedural swim animation. */
class SwimmingFish {
  constructor(species, size, x, y, heading) {
    this.species = species;
    this.size = size;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = 0;
    this.swimPhase = Math.random() * MathUtils.TAU;
    this.swimIntensity = 0.5;
    this.bodyBend = 0;
    this.finScale = 1;
    this.glowPhase = Math.random() * MathUtils.TAU;
    this.mouthOpen = 0;
    this.flashAmount = 0;
    this.opacity = 1;
    this.patternSeed = Math.random() * 100;
    this.isHunting = false;
    this.isAlive = true;
    // +1 / -1 keeps the dorsal side up; easing through 0 reads as the fish rolling over.
    this.rollScale = Math.cos(heading) < 0 ? -1 : 1;
  }

  steer(desiredHeading, desiredSpeed, turnRate, acceleration, deltaSeconds) {
    const previousHeading = this.heading;
    this.heading = MathUtils.rotateAngleTowards(this.heading, desiredHeading, turnRate * deltaSeconds);
    const angularVelocity = MathUtils.normalizeAngle(this.heading - previousHeading) / Math.max(deltaSeconds, 1e-4);
    this.bodyBend = MathUtils.smoothDamp(this.bodyBend, MathUtils.clamp(angularVelocity * 0.2, -1, 1), 8, deltaSeconds);

    this.speed = MathUtils.smoothDamp(this.speed, desiredSpeed, acceleration, deltaSeconds);
    this.x += Math.cos(this.heading) * this.speed * deltaSeconds;
    this.y += Math.sin(this.heading) * this.speed * deltaSeconds;

    const relativeSpeed = this.speed / Math.max(this.size, 1);
    this.swimPhase += (3.2 + relativeSpeed * 2.6) * deltaSeconds;
    const targetIntensity = MathUtils.clamp(0.35 + relativeSpeed * 0.32 + Math.abs(this.bodyBend) * 0.3, 0.3, 1.45);
    this.swimIntensity = MathUtils.smoothDamp(this.swimIntensity, targetIntensity, 4, deltaSeconds);

    const horizontalFacing = Math.cos(this.heading);
    if (horizontalFacing < -0.12) this.rollTarget = -1;
    else if (horizontalFacing > 0.12) this.rollTarget = 1;
    else if (this.rollTarget === undefined) this.rollTarget = this.rollScale < 0 ? -1 : 1;
    this.rollScale = MathUtils.smoothDamp(this.rollScale, this.rollTarget, 9, deltaSeconds);

    this.glowPhase += deltaSeconds * 2;
    this.mouthOpen = MathUtils.smoothDamp(this.mouthOpen, 0, 5, deltaSeconds);
    this.flashAmount = Math.max(0, this.flashAmount - deltaSeconds * 2.4);
  }

  get headX() { return this.x + Math.cos(this.heading) * this.size * 0.42; }
  get headY() { return this.y + Math.sin(this.heading) * this.size * 0.42; }
}

class NpcFish extends SwimmingFish {
  constructor(species, size, x, y, heading) {
    super(species, size, x, y, heading);
    this.cruiseSpeed = size * MathUtils.randomRange(0.9, 1.5) + 18;
    this.wanderHeading = heading;
    this.wanderTimer = MathUtils.randomRange(1, 4);
    this.spawnFade = 0;
    this.isFleeing = false;
  }

  update(deltaSeconds, player, world) {
    this.spawnFade = Math.min(1, this.spawnFade + deltaSeconds * 1.5);
    this.opacity = this.spawnFade;

    this.wanderTimer -= deltaSeconds;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = MathUtils.randomRange(2, 5);
      this.wanderHeading = this.heading + MathUtils.randomRange(-0.9, 0.9);
    }

    let desiredHeading = this.wanderHeading;
    let desiredSpeed = this.cruiseSpeed;
    let turnRate = 1.3;
    this.isHunting = false;
    this.isFleeing = false;

    if (player && player.isAlive) {
      const distanceToPlayer = MathUtils.distance(this.x, this.y, player.x, player.y);
      const awarenessRadius = 160 + Math.max(this.size, player.size) * 3;
      const canEatPlayer = this.size > player.size * EAT_SIZE_RATIO;
      const isPrey = player.size > this.size * EAT_SIZE_RATIO;
      if (distanceToPlayer < awarenessRadius && player.invulnerableTime <= 0 && canEatPlayer) {
        this.isHunting = true;
        desiredHeading = Math.atan2(player.y - this.y, player.x - this.x);
        desiredSpeed = this.cruiseSpeed * 1.9;
        turnRate = 2.1;
      } else if (distanceToPlayer < awarenessRadius * 0.75 && isPrey) {
        this.isFleeing = true;
        desiredHeading = Math.atan2(this.y - player.y, this.x - player.x);
        desiredSpeed = this.cruiseSpeed * 1.7;
        turnRate = 3;
      }
    }

    // Soft walls: steer back toward the playable band instead of colliding.
    const margin = 120;
    if (this.y < world.surfaceY + margin) desiredHeading = blendAngles(desiredHeading, Math.PI / 2, 0.6);
    if (this.y > world.floorY - margin) desiredHeading = blendAngles(desiredHeading, -Math.PI / 2, 0.6);
    if (this.y < world.surfaceY + margin || this.y > world.floorY - margin) {
      this.wanderHeading = desiredHeading;
    }

    this.steer(desiredHeading, desiredSpeed, turnRate, 2.2, deltaSeconds);
  }
}

/** Evolution stages: reaching a stage's size changes the player's fins and glow. */
const PLAYER_STAGES = [
  { name: "幼鱼", minimumSize: 0, finScale: 0.85 },
  { name: "游光鱼", minimumSize: 52, finScale: 1 },
  { name: "流萤鱼", minimumSize: 80, finScale: 1.12 },
  { name: "深海灯王", minimumSize: 120, finScale: 1.25 },
  { name: "渊光之主", minimumSize: 175, finScale: 1.4 },
];

class PlayerFish extends SwimmingFish {
  constructor(x, y) {
    super(FISH_SPECIES.lumenFry, PLAYER_START_SIZE, x, y, 0);
    this.displaySize = PLAYER_START_SIZE;
    this.dashEnergy = 1;
    this.isDashing = false;
    this.invulnerableTime = 2;
    this.stageIndex = 0;
    this.finScale = PLAYER_STAGES[0].finScale;
  }

  get stage() { return PLAYER_STAGES[this.stageIndex]; }

  /** Progress (0..1) from the current stage threshold toward the next one. */
  get stageProgress() {
    const nextStage = PLAYER_STAGES[this.stageIndex + 1];
    if (!nextStage) return 1;
    const span = nextStage.minimumSize - this.stage.minimumSize;
    return MathUtils.clamp((this.size - this.stage.minimumSize) / span, 0, 1);
  }

  /** Returns true when the meal triggers a new evolution stage. */
  grow(eatenSize) {
    // Diminishing returns: tiny prey barely helps a big player, and growth slows as size rises
    // so the size curve stays bounded instead of compounding.
    const rawGain = (eatenSize * eatenSize) / (this.size * 7.5) + 0.6;
    const sizeSlowdown = 1 / (1 + this.size / 90);
    this.size = Math.min(PLAYER_MAX_SIZE, this.size + rawGain * sizeSlowdown);
    const nextStage = PLAYER_STAGES[this.stageIndex + 1];
    if (nextStage && this.size >= nextStage.minimumSize) {
      this.stageIndex++;
      return true;
    }
    return false;
  }

  update(deltaSeconds, input, world) {
    this.invulnerableTime = Math.max(0, this.invulnerableTime - deltaSeconds);
    this.opacity = this.invulnerableTime > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(this.invulnerableTime * 9)) : 1;
    this.finScale = MathUtils.smoothDamp(this.finScale, this.stage.finScale, 3, deltaSeconds);
    this.displaySize = MathUtils.smoothDamp(this.displaySize, this.size, 6, deltaSeconds);

    const wantsDash = input.isDashPressed && this.dashEnergy > 0.02;
    this.isDashing = wantsDash;
    this.dashEnergy = wantsDash
      ? Math.max(0, this.dashEnergy - deltaSeconds * 0.55)
      : Math.min(1, this.dashEnergy + deltaSeconds * 0.12);

    const baseSpeed = 150 + this.size * 0.9;
    let desiredHeading = this.heading;
    let desiredSpeed = 0;
    if (input.hasDirection) {
      desiredHeading = input.directionAngle;
      desiredSpeed = baseSpeed * input.directionStrength;
    } else if (input.hasPointerTarget) {
      const deltaX = input.pointerWorldX - this.x;
      const deltaY = input.pointerWorldY - this.y;
      const distanceToPointer = Math.hypot(deltaX, deltaY);
      if (distanceToPointer > this.size * 0.25) {
        desiredHeading = Math.atan2(deltaY, deltaX);
        desiredSpeed = baseSpeed * MathUtils.clamp(distanceToPointer / 180, 0, 1);
      }
    }
    if (this.isDashing) desiredSpeed = Math.max(desiredSpeed, baseSpeed) * 2.1;

    this.steer(desiredHeading, desiredSpeed, this.isDashing ? 5.5 : 4.2, this.isDashing ? 6 : 3.2, deltaSeconds);

    const halfSize = this.size * 0.5;
    this.y = MathUtils.clamp(this.y, world.surfaceY + halfSize * 0.6, world.floorY - halfSize);
  }

  /** The renderer draws displaySize so growth eases in smoothly. */
  get renderSize() { return this.displaySize; }
}

/** Glowing plankton: restores dash energy and gives a little score. */
class Plankton {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.baseY = y;
    this.radius = MathUtils.randomRange(2.5, 4.5);
    this.phase = Math.random() * MathUtils.TAU;
    this.color = MathUtils.pickRandom(["#7dfcff", "#b6ff9e", "#ffe58a", "#d3a8ff"]);
    this.isAlive = true;
  }

  update(deltaSeconds, player) {
    this.phase += deltaSeconds;
    let targetX = this.baseX + Math.sin(this.phase * 0.7) * 14;
    let targetY = this.baseY + Math.cos(this.phase * 0.5) * 10;
    // Gentle magnetic pull toward a nearby player makes collection feel good.
    if (player && player.isAlive) {
      const distanceToPlayer = MathUtils.distance(this.x, this.y, player.x, player.y);
      const pullRadius = player.size * 2.2;
      if (distanceToPlayer < pullRadius) {
        const pull = 1 - distanceToPlayer / pullRadius;
        targetX = MathUtils.lerp(targetX, player.headX, pull);
        targetY = MathUtils.lerp(targetY, player.headY, pull);
        this.baseX = MathUtils.lerp(this.baseX, player.x, pull * deltaSeconds * 2);
        this.baseY = MathUtils.lerp(this.baseY, player.y, pull * deltaSeconds * 2);
      }
    }
    this.x = MathUtils.smoothDamp(this.x, targetX, 4, deltaSeconds);
    this.y = MathUtils.smoothDamp(this.y, targetY, 4, deltaSeconds);
  }

  draw(context) {
    const pulse = 0.7 + 0.3 * Math.sin(this.phase * 3);
    drawSoftGlow(context, this.x, this.y, this.radius * 5, this.color, 0.4 * pulse);
    context.fillStyle = ColorUtils.toRgba("#ffffff", 0.9);
    context.beginPath();
    context.arc(this.x, this.y, this.radius * 0.55, 0, MathUtils.TAU);
    context.fill();
  }
}

/** Short-lived visual particles: bubbles, sparks, and eat bursts. */
class Particle {
  constructor(x, y, velocityX, velocityY, lifetime, radius, color, kind) {
    this.x = x;
    this.y = y;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.lifetime = lifetime;
    this.age = 0;
    this.radius = radius;
    this.color = color;
    this.kind = kind;
    this.wobblePhase = Math.random() * MathUtils.TAU;
  }

  get isAlive() { return this.age < this.lifetime; }

  update(deltaSeconds) {
    this.age += deltaSeconds;
    if (this.kind === "bubble") {
      this.velocityY = MathUtils.smoothDamp(this.velocityY, -45 - this.radius * 6, 2, deltaSeconds);
      this.x += Math.sin(this.age * 6 + this.wobblePhase) * 12 * deltaSeconds;
    } else {
      this.velocityX *= Math.exp(-3 * deltaSeconds);
      this.velocityY *= Math.exp(-3 * deltaSeconds);
    }
    this.x += this.velocityX * deltaSeconds;
    this.y += this.velocityY * deltaSeconds;
  }

  draw(context) {
    const lifeFraction = 1 - this.age / this.lifetime;
    if (this.kind === "bubble") {
      const bubbleGradient = context.createRadialGradient(
        this.x - this.radius * 0.35, this.y - this.radius * 0.35, 0, this.x, this.y, this.radius
      );
      bubbleGradient.addColorStop(0, `rgba(255,255,255,${(0.55 * lifeFraction).toFixed(3)})`);
      bubbleGradient.addColorStop(0.7, `rgba(180,235,255,${(0.12 * lifeFraction).toFixed(3)})`);
      bubbleGradient.addColorStop(1, `rgba(200,245,255,${(0.4 * lifeFraction).toFixed(3)})`);
      context.fillStyle = bubbleGradient;
      context.beginPath();
      context.arc(this.x, this.y, this.radius, 0, MathUtils.TAU);
      context.fill();
    } else {
      drawSoftGlow(context, this.x, this.y, this.radius * (1 + (1 - lifeFraction)), this.color, 0.7 * lifeFraction);
    }
  }
}

/** Drifting jellyfish: touching it shocks the player, shrinking them and draining dash energy. */
class Jellyfish {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.bellRadius = MathUtils.randomRange(22, 40);
    this.pulsePhase = Math.random() * MathUtils.TAU;
    this.driftHeading = MathUtils.randomRange(0, MathUtils.TAU);
    this.color = MathUtils.pickRandom(["#ff7bd5", "#b48bff", "#7dd3ff"]);
    this.shockFlash = 0;
    this.tentacleCount = 7;
    this.tentaclePhases = Array.from({ length: this.tentacleCount }, () => Math.random() * MathUtils.TAU);
    this.isAlive = true;
  }

  update(deltaSeconds, world) {
    this.pulsePhase += deltaSeconds * 1.8;
    // Thrust only during the contraction half of the pulse, like a real bell.
    const contraction = Math.max(0, Math.sin(this.pulsePhase));
    this.driftHeading += MathUtils.randomRange(-0.4, 0.4) * deltaSeconds;
    const upwardBias = -0.6;
    this.x += Math.cos(this.driftHeading) * 10 * deltaSeconds;
    this.y += (Math.sin(this.driftHeading) * 8 + upwardBias * contraction * 28 + 9) * deltaSeconds;
    this.y = MathUtils.clamp(this.y, world.surfaceY + 120, world.floorY - 160);
    this.shockFlash = Math.max(0, this.shockFlash - deltaSeconds * 3);
  }

  /** Bell plus the upper part of the tentacles count as the sting area. */
  touches(fish) {
    const stingRadius = this.bellRadius * 1.1 + fish.size * 0.3;
    const stingCenterY = this.y + this.bellRadius * 0.6;
    return MathUtils.distance(this.x, stingCenterY, fish.x, fish.y) < stingRadius;
  }

  draw(context, time) {
    const contraction = Math.max(0, Math.sin(this.pulsePhase));
    const bellWidth = this.bellRadius * (1 - contraction * 0.14);
    const bellHeight = this.bellRadius * (0.82 + contraction * 0.12);
    const glowIntensity = 0.18 + this.shockFlash * 0.5;

    context.save();
    context.globalCompositeOperation = "lighter";
    drawSoftGlow(context, this.x, this.y, this.bellRadius * 3.2, this.color, glowIntensity);
    context.restore();

    const tentacleLength = this.bellRadius * 3.2;
    for (let tentacleIndex = 0; tentacleIndex < this.tentacleCount; tentacleIndex++) {
      const spreadFraction = tentacleIndex / (this.tentacleCount - 1) - 0.5;
      const baseX = this.x + spreadFraction * bellWidth * 1.5;
      const points = [];
      for (let segmentIndex = 0; segmentIndex <= 8; segmentIndex++) {
        const along = segmentIndex / 8;
        const wave = Math.sin(time * 2.2 + this.tentaclePhases[tentacleIndex] + along * 5) * along * this.bellRadius * 0.35;
        points.push({ x: baseX + wave + spreadFraction * along * this.bellRadius * 0.6, y: this.y + along * tentacleLength * (1 - contraction * 0.1) });
      }
      const ribbonWidth = this.bellRadius * 0.07;
      const leftEdge = points.map((point, index) => ({ x: point.x - ribbonWidth * (1 - index / 8), y: point.y }));
      const rightEdge = points.map((point, index) => ({ x: point.x + ribbonWidth * (1 - index / 8), y: point.y })).reverse();
      const tentacleGradient = context.createLinearGradient(0, this.y, 0, this.y + tentacleLength);
      tentacleGradient.addColorStop(0, ColorUtils.toRgba(this.color, 0.6));
      tentacleGradient.addColorStop(1, ColorUtils.toRgba(this.color, 0));
      context.fillStyle = tentacleGradient;
      context.beginPath();
      traceSmoothOpenPath(context, leftEdge, true);
      traceSmoothOpenPath(context, rightEdge, false);
      context.closePath();
      context.fill();
    }

    const bellGradient = context.createRadialGradient(this.x, this.y - bellHeight * 0.4, 0, this.x, this.y, bellWidth * 1.1);
    bellGradient.addColorStop(0, ColorUtils.mixToRgba(this.color, "#ffffff", 0.6 + this.shockFlash * 0.4, 0.75));
    bellGradient.addColorStop(0.6, ColorUtils.toRgba(this.color, 0.45));
    bellGradient.addColorStop(1, ColorUtils.toRgba(this.color, 0.18));
    context.fillStyle = bellGradient;
    context.beginPath();
    context.moveTo(this.x - bellWidth, this.y);
    context.bezierCurveTo(this.x - bellWidth, this.y - bellHeight * 1.35, this.x + bellWidth, this.y - bellHeight * 1.35, this.x + bellWidth, this.y);
    // Scalloped rim along the bell's lower edge.
    const scallopCount = 6;
    for (let scallopIndex = scallopCount - 1; scallopIndex >= 0; scallopIndex--) {
      const rimX = this.x - bellWidth + (scallopIndex / scallopCount) * bellWidth * 2;
      const middleX = rimX + bellWidth / scallopCount;
      context.quadraticCurveTo(middleX, this.y + bellHeight * 0.16, rimX, this.y);
    }
    context.closePath();
    context.fill();

    context.fillStyle = ColorUtils.toRgba("#ffffff", 0.35);
    context.beginPath();
    context.ellipse(this.x - bellWidth * 0.3, this.y - bellHeight * 0.65, bellWidth * 0.28, bellHeight * 0.16, -0.4, 0, MathUtils.TAU);
    context.fill();
  }
}
