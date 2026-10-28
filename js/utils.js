"use strict";

const MathUtils = {
  TAU: Math.PI * 2,

  clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  },

  lerp(start, end, amount) {
    return start + (end - start) * amount;
  },

  randomRange(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  },

  randomInt(minimum, maximum) {
    return Math.floor(minimum + Math.random() * (maximum - minimum + 1));
  },

  pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  },

  distance(startX, startY, endX, endY) {
    return Math.hypot(endX - startX, endY - startY);
  },

  normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  },

  rotateAngleTowards(currentAngle, targetAngle, maximumStep) {
    const difference = MathUtils.normalizeAngle(targetAngle - currentAngle);
    const step = Math.abs(difference) <= maximumStep ? difference : Math.sign(difference) * maximumStep;
    return MathUtils.normalizeAngle(currentAngle + step);
  },

  /** Frame-rate independent exponential approach toward a target value. */
  smoothDamp(current, target, sharpness, deltaSeconds) {
    return current + (target - current) * (1 - Math.exp(-sharpness * deltaSeconds));
  },

  easeOutCubic(progress) {
    return 1 - Math.pow(1 - progress, 3);
  },

  /** Deterministic pseudo-random value in [0, 1) for an integer index. */
  hashNoise(index, seed) {
    const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
  },

  smoothNoise(position, seed) {
    const baseIndex = Math.floor(position);
    const fraction = position - baseIndex;
    const easedFraction = fraction * fraction * (3 - 2 * fraction);
    return MathUtils.lerp(MathUtils.hashNoise(baseIndex, seed), MathUtils.hashNoise(baseIndex + 1, seed), easedFraction);
  },
};

const ColorUtils = {
  parsedHexCache: new Map(),

  parseHex(hexColor) {
    const cached = ColorUtils.parsedHexCache.get(hexColor);
    if (cached) return cached;
    const hexDigits = hexColor.replace("#", "");
    const parsed = {
      red: parseInt(hexDigits.slice(0, 2), 16),
      green: parseInt(hexDigits.slice(2, 4), 16),
      blue: parseInt(hexDigits.slice(4, 6), 16),
    };
    ColorUtils.parsedHexCache.set(hexColor, parsed);
    return parsed;
  },

  toRgba(hexColor, alpha) {
    const { red, green, blue } = ColorUtils.parseHex(hexColor);
    return `rgba(${red},${green},${blue},${MathUtils.clamp(alpha, 0, 1).toFixed(3)})`;
  },

  mixToRgba(firstHexColor, secondHexColor, amount, alpha) {
    const first = ColorUtils.parseHex(firstHexColor);
    const second = ColorUtils.parseHex(secondHexColor);
    const red = Math.round(MathUtils.lerp(first.red, second.red, amount));
    const green = Math.round(MathUtils.lerp(first.green, second.green, amount));
    const blue = Math.round(MathUtils.lerp(first.blue, second.blue, amount));
    return `rgba(${red},${green},${blue},${MathUtils.clamp(alpha, 0, 1).toFixed(3)})`;
  },
};

/** Draws a soft additive glow; much cheaper than canvas shadowBlur. */
function drawSoftGlow(context, centerX, centerY, radius, hexColor, intensity) {
  if (radius <= 0 || intensity <= 0) return;
  const glowGradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  glowGradient.addColorStop(0, ColorUtils.toRgba(hexColor, intensity));
  glowGradient.addColorStop(0.35, ColorUtils.toRgba(hexColor, intensity * 0.45));
  glowGradient.addColorStop(1, ColorUtils.toRgba(hexColor, 0));
  context.fillStyle = glowGradient;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, MathUtils.TAU);
  context.fill();
}

/** Traces a smooth closed curve through points using midpoint quadratic segments. */
function traceSmoothClosedPath(context, points) {
  const pointCount = points.length;
  if (pointCount < 3) return;
  const lastPoint = points[pointCount - 1];
  context.moveTo((lastPoint.x + points[0].x) / 2, (lastPoint.y + points[0].y) / 2);
  for (let index = 0; index < pointCount; index++) {
    const current = points[index];
    const next = points[(index + 1) % pointCount];
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  context.closePath();
}

const glowSpriteCache = new Map();

/** A pre-rendered radial glow per color; stamping it is far cheaper than building gradients per frame. */
function getGlowSprite(hexColor) {
  const cachedSprite = glowSpriteCache.get(hexColor);
  if (cachedSprite) return cachedSprite;
  const sprite = document.createElement("canvas");
  sprite.width = 64;
  sprite.height = 64;
  const spriteContext = sprite.getContext("2d");
  const gradient = spriteContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, ColorUtils.toRgba(hexColor, 1));
  gradient.addColorStop(0.3, ColorUtils.toRgba(hexColor, 0.45));
  gradient.addColorStop(1, ColorUtils.toRgba(hexColor, 0));
  spriteContext.fillStyle = gradient;
  spriteContext.fillRect(0, 0, 64, 64);
  glowSpriteCache.set(hexColor, sprite);
  return sprite;
}

function drawGlowSprite(context, centerX, centerY, radius, hexColor, alpha) {
  if (alpha <= 0.002 || radius <= 0) return;
  const previousAlpha = context.globalAlpha;
  context.globalAlpha = previousAlpha * Math.min(1, alpha);
  context.drawImage(getGlowSprite(hexColor), centerX - radius, centerY - radius, radius * 2, radius * 2);
  context.globalAlpha = previousAlpha;
}
