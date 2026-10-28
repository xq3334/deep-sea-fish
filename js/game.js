"use strict";

/** The world is unbounded horizontally; only the sea surface and floor limit vertical movement. */
const WORLD_CONFIG = { surfaceY: 0, floorY: 2600, startX: 0 };
const POPULATION_CONFIG = { fishCount: 30, planktonCount: 70, jellyfishCount: 7 };
const COMBO_WINDOW_SECONDS = 2.6;
const BEST_SCORE_STORAGE_KEY = "deep-sea-fish-best-score";

/** Unifies mouse, touch and keyboard into steering intent for the player. */
class InputController {
  constructor(canvas, dashButton, joystickElement) {
    this.pointerScreenX = 0;
    this.pointerScreenY = 0;
    this.hasPointer = false;
    this.isPointerDashing = false;
    this.isKeyboardDashing = false;
    this.isButtonDashing = false;
    this.pressedKeys = new Set();
    this.joystickElement = joystickElement;
    this.joystickPointerId = null;
    this.joystickAngle = 0;
    this.joystickStrength = 0;
    this.bindPointer(canvas);
    this.bindKeyboard();
    this.bindDashButton(dashButton);
    this.bindJoystick(joystickElement);
  }

  /**
   * Virtual stick: the knob follows the finger inside the ring. Direction is the knob angle,
   * strength is how far it is pushed, with a small dead zone so a resting thumb does not drift.
   */
  bindJoystick(joystickElement) {
    const knobElement = joystickElement.querySelector(".joystick-knob");
    const deadZoneFraction = 0.12;
    const updateFromEvent = (event) => {
      const ringBounds = joystickElement.getBoundingClientRect();
      const ringRadius = ringBounds.width / 2;
      const offsetX = event.clientX - (ringBounds.left + ringRadius);
      const offsetY = event.clientY - (ringBounds.top + ringRadius);
      const offsetDistance = Math.hypot(offsetX, offsetY);
      const clampedDistance = Math.min(offsetDistance, ringRadius);
      const knobScale = offsetDistance > 0 ? clampedDistance / offsetDistance : 0;
      knobElement.style.transform = `translate(${(offsetX * knobScale).toFixed(1)}px, ${(offsetY * knobScale).toFixed(1)}px)`;
      const pushFraction = clampedDistance / ringRadius;
      this.joystickAngle = Math.atan2(offsetY, offsetX);
      this.joystickStrength = pushFraction < deadZoneFraction ? 0 : (pushFraction - deadZoneFraction) / (1 - deadZoneFraction);
    };
    joystickElement.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.joystickPointerId = event.pointerId;
      joystickElement.classList.add("active");
      updateFromEvent(event);
      try {
        joystickElement.setPointerCapture(event.pointerId);
      } catch (captureError) {
        // Capture only keeps the drag alive when the finger leaves the ring; steering still works without it.
      }
    });
    joystickElement.addEventListener("pointermove", (event) => {
      if (event.pointerId === this.joystickPointerId) updateFromEvent(event);
    });
    const releaseJoystick = (event) => {
      if (event.pointerId === this.joystickPointerId) this.resetJoystick();
    };
    joystickElement.addEventListener("pointerup", releaseJoystick);
    joystickElement.addEventListener("pointercancel", releaseJoystick);
    joystickElement.addEventListener("lostpointercapture", releaseJoystick);
  }

  resetJoystick() {
    this.joystickPointerId = null;
    this.joystickStrength = 0;
    this.joystickElement.classList.remove("active");
    const knobElement = this.joystickElement.querySelector(".joystick-knob");
    knobElement.style.transform = "";
  }

  bindPointer(canvas) {
    const updatePointer = (event) => {
      this.pointerScreenX = event.clientX;
      this.pointerScreenY = event.clientY;
      this.hasPointer = true;
    };
    canvas.addEventListener("pointermove", updatePointer);
    canvas.addEventListener("pointerdown", (event) => {
      updatePointer(event);
      if (event.pointerType === "mouse" && event.button === 0) this.isPointerDashing = true;
      canvas.setPointerCapture(event.pointerId);
    });
    const releasePointer = (event) => {
      if (event.pointerType === "mouse") this.isPointerDashing = false;
      // On touch the fish glides to a stop once the finger lifts.
      else this.hasPointer = false;
    };
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") this.isPointerDashing = false;
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  bindKeyboard() {
    const steeringKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
    window.addEventListener("keydown", (event) => {
      if (!steeringKeys.has(event.code)) return;
      if (event.target instanceof HTMLButtonElement && event.code === "Space") return;
      event.preventDefault();
      this.pressedKeys.add(event.code);
      if (event.code === "Space") this.isKeyboardDashing = true;
    });
    window.addEventListener("keyup", (event) => {
      this.pressedKeys.delete(event.code);
      if (event.code === "Space") this.isKeyboardDashing = false;
    });
    window.addEventListener("blur", () => this.releaseAll());
  }

  /** Drops every held key and dash flag, so nothing stays "stuck" after a pause or focus loss. */
  releaseAll() {
    this.pressedKeys.clear();
    this.isKeyboardDashing = false;
    this.isPointerDashing = false;
    this.isButtonDashing = false;
    if (this.joystickElement) this.resetJoystick();
  }

  bindDashButton(dashButton) {
    const setPressed = (isPressed) => {
      this.isButtonDashing = isPressed;
      dashButton.classList.toggle("pressed", isPressed);
    };
    dashButton.addEventListener("pointerdown", (event) => { event.preventDefault(); setPressed(true); });
    dashButton.addEventListener("pointerup", () => setPressed(false));
    dashButton.addEventListener("pointercancel", () => setPressed(false));
    dashButton.addEventListener("pointerleave", () => setPressed(false));
  }

  /** Builds the per-frame intent object consumed by PlayerFish.update. */
  readIntent(screenToWorld) {
    const horizontal = (this.pressedKeys.has("KeyD") || this.pressedKeys.has("ArrowRight") ? 1 : 0)
      - (this.pressedKeys.has("KeyA") || this.pressedKeys.has("ArrowLeft") ? 1 : 0);
    const vertical = (this.pressedKeys.has("KeyS") || this.pressedKeys.has("ArrowDown") ? 1 : 0)
      - (this.pressedKeys.has("KeyW") || this.pressedKeys.has("ArrowUp") ? 1 : 0);
    const hasKeyboardDirection = horizontal !== 0 || vertical !== 0;
    // The joystick wins over keys because on a phone it is the only steering input in use.
    const hasJoystickDirection = this.joystickPointerId !== null && this.joystickStrength > 0;
    const hasDirection = hasJoystickDirection || hasKeyboardDirection;
    const pointerWorld = screenToWorld(this.pointerScreenX, this.pointerScreenY);
    let directionAngle = Math.atan2(vertical, horizontal);
    let directionStrength = hasKeyboardDirection ? 1 : 0;
    if (hasJoystickDirection) {
      directionAngle = this.joystickAngle;
      directionStrength = this.joystickStrength;
    }
    return {
      hasDirection,
      directionAngle,
      directionStrength,
      hasPointerTarget: this.hasPointer,
      pointerWorldX: pointerWorld.x,
      pointerWorldY: pointerWorld.y,
      isDashPressed: this.isPointerDashing || this.isKeyboardDashing || this.isButtonDashing,
    };
  }
}

/** Chooses a species that suits both the fish's size and how deep it spawns. */
function pickSpeciesForSize(size, depthFraction) {
  const candidates = [];
  if (size < 32) candidates.push("silverMinnow", "silverMinnow", "coralClown");
  if (size >= 22 && size < 75) candidates.push("coralClown", "royalTang");
  if (size >= 18 && size < 90 && depthFraction > 0.35) candidates.push("lanternFish", "lanternFish");
  if (size >= 50) candidates.push("stripedBarracuda");
  if (size >= 75) candidates.push("spottedGrouper", "royalTang");
  if (size >= 95 && depthFraction > 0.5) candidates.push("abyssAngler", "abyssAngler");
  if (size >= 150) candidates.push("spottedGrouper", "abyssAngler");
  return FISH_SPECIES[MathUtils.pickRandom(candidates.length ? candidates : ["silverMinnow"])];
}

/** Mix of prey, rivals and predators relative to the player's current size. */
function rollSpawnSize(referenceSize) {
  const roll = Math.random();
  let sizeFactor;
  if (roll < 0.56) sizeFactor = MathUtils.randomRange(0.35, 0.85);
  else if (roll < 0.82) sizeFactor = MathUtils.randomRange(0.9, 1.35);
  else sizeFactor = MathUtils.randomRange(1.5, 2.7);
  return MathUtils.clamp(referenceSize * sizeFactor, 10, 460);
}

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.context = this.canvas.getContext("2d");
    this.interface = {
      hud: document.getElementById("hud"),
      score: document.getElementById("hud-score"),
      combo: document.getElementById("hud-combo"),
      stage: document.getElementById("hud-stage"),
      growthBar: document.getElementById("hud-growth"),
      energyBar: document.getElementById("hud-energy"),
      banner: document.getElementById("stage-banner"),
      dashButton: document.getElementById("dash-button"),
      startScreen: document.getElementById("start-screen"),
      gameOverScreen: document.getElementById("game-over-screen"),
      resultScore: document.getElementById("result-score"),
      resultBest: document.getElementById("result-best"),
      resultStage: document.getElementById("result-stage"),
      pauseScreen: document.getElementById("pause-screen"),
      pauseButton: document.getElementById("pause-button"),
      muteButton: document.getElementById("mute-button"),
      joystick: document.getElementById("joystick"),
    };
    this.sound = new SoundEngine();
    this.isPaused = false;
    this.wasPlayerDashing = false;
    this.lastThreatSoundTime = -Infinity;
    this.background = new OceanBackground();
    this.input = new InputController(this.canvas, this.interface.dashButton, this.interface.joystick);
    this.isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
    document.body.classList.toggle("touch-device", this.isTouchDevice);
    this.bestScore = this.loadBestScore();
    this.state = "menu";
    this.time = 0;
    this.lastFrameTime = performance.now();
    this.camera = { x: WORLD_CONFIG.startX, y: WORLD_CONFIG.floorY * 0.35, zoom: 1, shake: 0 };

    this.resize();
    this.background.createSeabed(WORLD_CONFIG.floorY);
    window.addEventListener("resize", () => this.resize());
    document.getElementById("start-button").addEventListener("click", () => this.startRun());
    document.getElementById("restart-button").addEventListener("click", () => this.startRun());
    document.getElementById("resume-button").addEventListener("click", () => this.setPaused(false));
    this.interface.pauseButton.addEventListener("click", () => this.setPaused(!this.isPaused));
    this.interface.muteButton.addEventListener("click", () => this.toggleMuted());
    this.bindGameKeys();
    this.bindAutoPause();
    this.updateMuteButton();

    this.resetWorld(null);
    requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  resize() {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.viewWidth = Math.max(1, window.innerWidth);
    this.viewHeight = Math.max(1, window.innerHeight);
    this.canvas.width = Math.round(this.viewWidth * this.pixelRatio);
    this.canvas.height = Math.round(this.viewHeight * this.pixelRatio);
    this.background.resize(this.viewWidth, this.viewHeight, this.pixelRatio);
  }

  loadBestScore() {
    try {
      return Number(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY)) || 0;
    } catch (storageError) {
      return 0;
    }
  }

  saveBestScore() {
    try {
      window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(this.bestScore));
    } catch (storageError) {
      // Storage can be unavailable (private mode); the best score then lives in memory only.
    }
  }

  computeTargetZoom() {
    const isPlayerRelevant = this.player && this.state !== "menu";
    const referenceSize = isPlayerRelevant ? this.player.size : PLAYER_START_SIZE * 1.3;
    const screenScale = MathUtils.clamp(Math.min(this.viewWidth, this.viewHeight) / 820, 0.55, 1.25);
    const growthZoom = MathUtils.clamp(Math.pow(PLAYER_START_SIZE / referenceSize, 0.62), 0.3, 1);
    // Never zoom out so far that the world stops filling the screen.
    const minimumZoom = this.viewHeight / (WORLD_CONFIG.floorY + 220);
    return Math.max(screenScale * growthZoom, minimumZoom);
  }

  getVisibleRadius() {
    return Math.hypot(this.viewWidth, this.viewHeight) / 2 / this.camera.zoom;
  }

  getVisibleBounds(padding) {
    const halfWidth = this.viewWidth / 2 / this.camera.zoom + padding;
    const halfHeight = this.viewHeight / 2 / this.camera.zoom + padding;
    return { left: this.camera.x - halfWidth, right: this.camera.x + halfWidth, top: this.camera.y - halfHeight, bottom: this.camera.y + halfHeight };
  }

  screenToWorld(screenX, screenY) {
    return { x: this.camera.x + (screenX - this.viewWidth / 2) / this.camera.zoom, y: this.camera.y + (screenY - this.viewHeight / 2) / this.camera.zoom };
  }

  worldToScreen(worldX, worldY) {
    return { x: (worldX - this.camera.x) * this.camera.zoom + this.viewWidth / 2, y: (worldY - this.camera.y) * this.camera.zoom + this.viewHeight / 2 };
  }

  /** Rebuilds the population. With no player, the menu shows a calm ambient scene. */
  resetWorld(player) {
    this.player = player;
    this.fishes = [];
    this.planktons = [];
    this.jellyfishes = [];
    this.particles = [];
    this.score = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    for (let fishIndex = 0; fishIndex < POPULATION_CONFIG.fishCount; fishIndex++) this.spawnFish(false);
    for (let planktonIndex = 0; planktonIndex < POPULATION_CONFIG.planktonCount; planktonIndex++) this.spawnPlankton(false);
    for (let jellyIndex = 0; jellyIndex < POPULATION_CONFIG.jellyfishCount; jellyIndex++) this.spawnJellyfish(false);
  }

  /** Picks a world position; off-screen spawns keep fish from popping in where the player can see. */
  pickSpawnPoint(mustBeOffscreen, minimumY, maximumY) {
    const visibleRadius = this.getVisibleRadius();
    // Spawns outside the despawn radius would be culled on the next frame and respawned forever.
    const maximumSpawnDistance = this.getDespawnRadius() - 100;
    const horizontalSpawnRange = maximumSpawnDistance;
    const pickCandidateX = () => this.camera.x + MathUtils.randomRange(-horizontalSpawnRange, horizontalSpawnRange);
    for (let attempt = 0; attempt < 24; attempt++) {
      const candidateX = pickCandidateX();
      const candidateY = MathUtils.randomRange(minimumY, maximumY);
      const distanceToCamera = MathUtils.distance(candidateX, candidateY, this.camera.x, this.camera.y);
      const isFarEnough = !mustBeOffscreen || distanceToCamera > visibleRadius + 80;
      const isWithinKeepRange = distanceToCamera < maximumSpawnDistance;
      const isAwayFromPlayer = !this.player || MathUtils.distance(candidateX, candidateY, this.player.x, this.player.y) > 380;
      if (isFarEnough && isWithinKeepRange && isAwayFromPlayer) return { x: candidateX, y: candidateY };
    }
    // Fallback: just off-screen to the left or right of the camera, at camera depth, which is always inside the keep range.
    const fallbackSide = Math.random() < 0.5 ? -1 : 1;
    const fallbackY = MathUtils.clamp(this.camera.y + MathUtils.randomRange(-200, 200), minimumY, maximumY);
    return { x: this.camera.x + fallbackSide * (visibleRadius + 160), y: fallbackY };
  }

  spawnFish(mustBeOffscreen) {
    const referenceSize = this.player ? this.player.size : PLAYER_START_SIZE * 1.4;
    const size = rollSpawnSize(referenceSize);
    const spawnPoint = this.pickSpawnPoint(mustBeOffscreen, WORLD_CONFIG.surfaceY + 140, WORLD_CONFIG.floorY - 160);
    const depthFraction = spawnPoint.y / WORLD_CONFIG.floorY;
    const species = pickSpeciesForSize(size, depthFraction);
    const heading = Math.random() < 0.5 ? MathUtils.randomRange(-0.4, 0.4) : Math.PI + MathUtils.randomRange(-0.4, 0.4);
    this.fishes.push(new NpcFish(species, size, spawnPoint.x, spawnPoint.y, heading));
  }

  spawnPlankton(mustBeOffscreen) {
    const spawnPoint = this.pickSpawnPoint(mustBeOffscreen, WORLD_CONFIG.surfaceY + 60, WORLD_CONFIG.floorY - 120);
    this.planktons.push(new Plankton(spawnPoint.x, spawnPoint.y));
  }

  spawnJellyfish(mustBeOffscreen) {
    const spawnPoint = this.pickSpawnPoint(mustBeOffscreen, WORLD_CONFIG.surfaceY + 220, WORLD_CONFIG.floorY - 260);
    this.jellyfishes.push(new Jellyfish(spawnPoint.x, spawnPoint.y));
  }

  startRun() {
    this.sound.unlock();
    const player = new PlayerFish(WORLD_CONFIG.startX, WORLD_CONFIG.floorY * 0.3);
    this.camera.x = player.x;
    this.camera.y = player.y;
    this.resetWorld(player);
    this.state = "playing";
    this.isPaused = false;
    this.wasPlayerDashing = false;
    this.lastThreatSoundTime = -Infinity;
    this.lastStageName = player.stage.name;
    this.interface.startScreen.classList.add("hidden");
    this.interface.gameOverScreen.classList.add("hidden");
    this.interface.pauseScreen.classList.add("hidden");
    this.interface.hud.classList.remove("hidden");
    this.interface.pauseButton.classList.remove("hidden");
    this.updatePauseButton();
    this.interface.dashButton.classList.toggle("hidden", !this.isTouchDevice);
    this.interface.joystick.classList.toggle("hidden", !this.isTouchDevice);
    this.input.resetJoystick();
    this.showBanner(player.stage.name);
    this.updateHud();
  }

  endRun(predator) {
    this.state = "dying";
    this.player.isAlive = false;
    this.deathTimer = 1.3;
    if (predator) predator.mouthOpen = 1;
    this.interface.pauseButton.classList.add("hidden");
    this.sound.playDeath();
    this.camera.shake = 14;
    this.emitBurst(this.player.x, this.player.y, this.player.species.glowColor, 26, this.player.size * 0.9);
    this.bestScore = Math.max(this.bestScore, Math.round(this.score));
    this.saveBestScore();
  }

  showGameOver() {
    this.state = "gameover";
    this.interface.hud.classList.add("hidden");
    this.interface.dashButton.classList.add("hidden");
    this.interface.joystick.classList.add("hidden");
    this.input.resetJoystick();
    this.interface.resultScore.textContent = String(Math.round(this.score));
    this.interface.resultBest.textContent = String(this.bestScore);
    this.interface.resultStage.textContent = this.player.stage.name;
    this.interface.gameOverScreen.classList.remove("hidden");
  }

  /** Pausing is only meaningful mid-run; menus and the death animation ignore it. */
  setPaused(shouldPause) {
    if (this.state !== "playing" || this.isPaused === shouldPause) return;
    this.isPaused = shouldPause;
    this.interface.pauseScreen.classList.toggle("hidden", !shouldPause);
    this.updatePauseButton();
    if (shouldPause) {
      this.sound.suspend();
      this.input.releaseAll();
      document.getElementById("resume-button").focus();
    } else {
      this.sound.resume();
      // Skip the paused interval so the next frame does not simulate a huge time step.
      this.lastFrameTime = performance.now();
    }
  }

  updatePauseButton() {
    const pauseButton = this.interface.pauseButton;
    pauseButton.textContent = this.isPaused ? "继续" : "暂停";
    pauseButton.setAttribute("aria-label", this.isPaused ? "继续游戏" : "暂停游戏");
  }

  toggleMuted() {
    this.sound.unlock();
    this.sound.toggleMuted();
    this.updateMuteButton();
  }

  updateMuteButton() {
    const muteButton = this.interface.muteButton;
    const isMuted = this.sound.isMuted;
    muteButton.textContent = isMuted ? "音效 关" : "音效 开";
    muteButton.setAttribute("aria-pressed", String(isMuted));
    muteButton.setAttribute("aria-label", isMuted ? "开启音效" : "静音");
  }

  bindGameKeys() {
    window.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      if (event.code === "KeyP" || event.code === "Escape") {
        event.preventDefault();
        this.setPaused(!this.isPaused);
      } else if (event.code === "KeyM") {
        event.preventDefault();
        this.toggleMuted();
      }
    });
  }

  /** Switching tabs or windows pauses the run so the player never dies while away. */
  bindAutoPause() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.setPaused(true);
    });
    window.addEventListener("blur", () => this.setPaused(true));
  }

  /** Tags every fish as prey, rival or predator relative to the player; the renderer draws the matching outline. */
  updateThreatLevels() {
    // After death the player object still exists, but outlines should vanish with the HUD.
    const player = this.state === "playing" ? this.player : null;
    let hasNewHunter = false;
    for (const fish of this.fishes) {
      if (!player) {
        fish.threatLevel = null;
        continue;
      }
      if (player.size > fish.size * EAT_SIZE_RATIO) fish.threatLevel = "prey";
      else if (fish.size > player.size * EAT_SIZE_RATIO) fish.threatLevel = "predator";
      else fish.threatLevel = "rival";
      if (fish.isHunting && !fish.wasHuntingPlayer) hasNewHunter = true;
      fish.wasHuntingPlayer = fish.isHunting;
    }
    // Throttled so several predators turning at once do not stack into noise.
    if (hasNewHunter && this.time - this.lastThreatSoundTime > 2.5) {
      this.lastThreatSoundTime = this.time;
      this.sound.playThreat();
    }
  }

  showBanner(text) {
    const banner = this.interface.banner;
    banner.textContent = text;
    banner.classList.add("visible");
    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => banner.classList.remove("visible"), 1800);
  }

  emitBurst(x, y, color, count, spread) {
    for (let particleIndex = 0; particleIndex < count; particleIndex++) {
      const angle = Math.random() * MathUtils.TAU;
      const speed = MathUtils.randomRange(0.6, 1.6) * spread;
      this.particles.push(new Particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        MathUtils.randomRange(0.5, 1.1), MathUtils.randomRange(4, 9) + spread * 0.06, color, "spark"));
    }
    for (let bubbleIndex = 0; bubbleIndex < Math.ceil(count / 3); bubbleIndex++) {
      this.emitBubble(x + MathUtils.randomRange(-spread, spread) * 0.3, y + MathUtils.randomRange(-spread, spread) * 0.3, MathUtils.randomRange(2, 5));
    }
  }

  emitBubble(x, y, radius) {
    this.particles.push(new Particle(x, y, MathUtils.randomRange(-10, 10), MathUtils.randomRange(-20, -5), MathUtils.randomRange(1.4, 2.6), radius, "#ffffff", "bubble"));
  }

  /** Mouth of the eater must reach the prey's body; uses head position so eating feels deliberate. */
  isWithinBite(eater, prey) {
    const biteRadius = eater.size * 0.32 + prey.size * 0.28;
    return MathUtils.distance(eater.headX, eater.headY, prey.x, prey.y) < biteRadius;
  }

  handlePlayerInteractions(deltaSeconds) {
    const player = this.player;
    for (const fish of this.fishes) {
      if (!fish.isAlive || fish.spawnFade < 0.6) continue;
      const playerCanEat = player.size > fish.size * EAT_SIZE_RATIO;
      const fishCanEat = fish.size > player.size * EAT_SIZE_RATIO;
      const distanceToPlayer = MathUtils.distance(player.headX, player.headY, fish.x, fish.y);
      if (playerCanEat && distanceToPlayer < player.size * 0.9) player.mouthOpen = Math.max(player.mouthOpen, 0.7);
      if (playerCanEat && this.isWithinBite(player, fish)) {
        this.eatFish(fish);
      } else if (fishCanEat && player.invulnerableTime <= 0 && this.isWithinBite(fish, player)) {
        this.endRun(fish);
        return;
      }
    }
    for (const plankton of this.planktons) {
      if (!plankton.isAlive) continue;
      if (MathUtils.distance(player.headX, player.headY, plankton.x, plankton.y) < player.size * 0.35 + plankton.radius) {
        plankton.isAlive = false;
        this.sound.playPlankton();
        player.dashEnergy = Math.min(1, player.dashEnergy + 0.12);
        this.score += 2;
        this.emitBurst(plankton.x, plankton.y, plankton.color, 4, 30);
      }
    }
    for (const jellyfish of this.jellyfishes) {
      if (player.invulnerableTime > 0 || !jellyfish.touches(player)) continue;
      jellyfish.shockFlash = 1;
      this.sound.playShock();
      player.size = Math.max(PLAYER_START_SIZE * 0.8, player.size * 0.9);
      player.dashEnergy = Math.max(0, player.dashEnergy - 0.4);
      player.invulnerableTime = 1.4;
      player.flashAmount = 1;
      this.camera.shake = 10;
      this.comboCount = 0;
      this.emitBurst(player.x, player.y, jellyfish.color, 14, 80);
    }
    this.comboTimer = Math.max(0, this.comboTimer - deltaSeconds);
    if (this.comboTimer === 0) this.comboCount = 0;
  }

  eatFish(fish) {
    const player = this.player;
    fish.isAlive = false;
    player.mouthOpen = 1;
    player.flashAmount = 0.6;
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = COMBO_WINDOW_SECONDS;
    const comboMultiplier = 1 + Math.min(this.comboCount - 1, 9) * 0.25;
    this.score += Math.round(fish.size * 1.5 * comboMultiplier);
    this.emitBurst(fish.x, fish.y, fish.species.glowStrength > 0 ? fish.species.glowColor : fish.species.finColor, 12, fish.size * 1.2);
    this.camera.shake = Math.max(this.camera.shake, 3);
    this.sound.playEat(fish.size / player.size, this.comboCount);
    if (player.grow(fish.size)) {
      this.sound.playEvolve();
      this.showBanner(player.stage.name);
      this.emitBurst(player.x, player.y, player.species.glowColor, 40, player.size * 1.6);
    }
  }

  /** NPC predators eat smaller NPCs too, so the ecosystem feels alive. */
  handleNpcPredation() {
    for (const predator of this.fishes) {
      if (!predator.isAlive || !predator.isHunting && Math.random() > 0.02) continue;
      for (const prey of this.fishes) {
        if (prey === predator || !prey.isAlive) continue;
        if (predator.size > prey.size * 1.6 && this.isWithinBite(predator, prey)) {
          prey.isAlive = false;
          predator.mouthOpen = 1;
          this.emitBurst(prey.x, prey.y, prey.species.finColor, 6, prey.size);
          break;
        }
      }
    }
  }

  update(deltaSeconds) {
    this.time += deltaSeconds;
    const world = WORLD_CONFIG;
    const isPlaying = this.state === "playing";

    if (isPlaying) {
      const intent = this.input.readIntent((screenX, screenY) => this.screenToWorld(screenX, screenY));
      this.player.update(deltaSeconds, intent, world);
      if (this.player.isDashing && !this.wasPlayerDashing) this.sound.playDash();
      this.wasPlayerDashing = this.player.isDashing;
      if (this.player.isDashing && Math.random() < deltaSeconds * 26) {
        const tailX = this.player.x - Math.cos(this.player.heading) * this.player.size * 0.5;
        const tailY = this.player.y - Math.sin(this.player.heading) * this.player.size * 0.5;
        this.emitBubble(tailX, tailY, MathUtils.randomRange(1.5, 3.5));
      }
    } else if (this.state === "dying") {
      this.deathTimer -= deltaSeconds;
      if (this.deathTimer <= 0) this.showGameOver();
    }

    const activePlayer = isPlaying ? this.player : null;
    for (const fish of this.fishes) fish.update(deltaSeconds, activePlayer, world);
    for (const plankton of this.planktons) plankton.update(deltaSeconds, activePlayer);
    for (const jellyfish of this.jellyfishes) jellyfish.update(deltaSeconds, world);
    for (const particle of this.particles) particle.update(deltaSeconds);

    if (isPlaying) this.handlePlayerInteractions(deltaSeconds);
    this.updateThreatLevels();
    this.handleNpcPredation();
    this.maintainPopulation();
    this.updateCamera(deltaSeconds);
    const scenery = this.background.scenery;
    if (scenery) scenery.updateLeviathan(deltaSeconds, this.camera.x, this.viewWidth);
    if (isPlaying) this.updateHud();
  }

  /** Entities beyond this distance from the camera are recycled; spawning must stay inside it. */
  getDespawnRadius() {
    return this.getVisibleRadius() * 2.6 + 600;
  }

  /** Removes eaten or far-away entities and refills the population off-screen. */
  maintainPopulation() {
    const despawnRadius = this.getDespawnRadius();
    const referenceSize = this.player && this.state === "playing" ? this.player.size : PLAYER_START_SIZE * 1.4;
    this.fishes = this.fishes.filter((fish) => {
      if (!fish.isAlive) return false;
      const isFar = MathUtils.distance(fish.x, fish.y, this.camera.x, this.camera.y) > despawnRadius;
      // Fish far smaller than the player stop being interesting; recycle them into relevant sizes.
      const isIrrelevant = fish.size < referenceSize * 0.18 && MathUtils.distance(fish.x, fish.y, this.camera.x, this.camera.y) > this.getVisibleRadius() + 100;
      return !isFar && !isIrrelevant;
    });
    // The map is unbounded, so anything left far behind must be recycled or the population would thin out around the player.
    const isNearCamera = (entity) => MathUtils.distance(entity.x, entity.y, this.camera.x, this.camera.y) <= despawnRadius;
    this.planktons = this.planktons.filter((plankton) => plankton.isAlive && isNearCamera(plankton));
    this.jellyfishes = this.jellyfishes.filter((jellyfish) => isNearCamera(jellyfish));
    this.particles = this.particles.filter((particle) => particle.isAlive);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);

    while (this.fishes.length < POPULATION_CONFIG.fishCount) this.spawnFish(true);
    while (this.planktons.length < POPULATION_CONFIG.planktonCount) this.spawnPlankton(true);
    while (this.jellyfishes.length < POPULATION_CONFIG.jellyfishCount) this.spawnJellyfish(true);
  }

  updateCamera(deltaSeconds) {
    const camera = this.camera;
    camera.zoom = MathUtils.smoothDamp(camera.zoom, this.computeTargetZoom(), 1.6, deltaSeconds);
    let targetX = camera.x;
    let targetY = camera.y;
    if (this.player && this.state !== "menu") {
      // Lead slightly ahead of the player so you can see what you swim into.
      const leadDistance = Math.min(this.player.speed * 0.35, 160);
      targetX = this.player.x + Math.cos(this.player.heading) * leadDistance;
      targetY = this.player.y + Math.sin(this.player.heading) * leadDistance;
    } else {
      targetX = WORLD_CONFIG.startX + Math.sin(this.time * 0.05) * 900;
      targetY = WORLD_CONFIG.floorY * 0.42 + Math.sin(this.time * 0.08) * 180;
    }
    camera.x = MathUtils.smoothDamp(camera.x, targetX, 3.2, deltaSeconds);
    camera.y = MathUtils.smoothDamp(camera.y, targetY, 3.2, deltaSeconds);

    const halfVisibleHeight = this.viewHeight / 2 / camera.zoom;
    camera.y = MathUtils.clamp(camera.y, WORLD_CONFIG.surfaceY - 80 + halfVisibleHeight, Math.max(WORLD_CONFIG.surfaceY - 80 + halfVisibleHeight, WORLD_CONFIG.floorY + 140 - halfVisibleHeight));
    camera.shake = Math.max(0, camera.shake - deltaSeconds * 30);
  }

  updateHud() {
    const player = this.player;
    const ui = this.interface;
    ui.score.textContent = String(Math.round(this.score));
    ui.stage.textContent = player.stage.name;
    ui.growthBar.style.width = `${(player.stageProgress * 100).toFixed(1)}%`;
    ui.energyBar.style.width = `${(player.dashEnergy * 100).toFixed(1)}%`;
    const comboText = this.comboCount >= 2 ? `连吞 ×${this.comboCount}` : "";
    if (ui.combo.textContent !== comboText) ui.combo.textContent = comboText;
  }

  render() {
    const context = this.context;
    const camera = this.camera;
    const depthFraction = MathUtils.clamp(camera.y / WORLD_CONFIG.floorY, 0, 1);
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);

    this.background.drawWater(context, depthFraction);
    const scenery = this.background.scenery;
    if (scenery) scenery.drawLeviathan(context, this.viewWidth, this.viewHeight, camera.x, camera.y, this.time, depthFraction);
    this.background.drawParallaxRidges(context, camera.x, camera.y, WORLD_CONFIG.floorY, depthFraction, this.time);
    this.background.drawLightRays(context, this.time, depthFraction, camera.x);
    this.background.drawMarineSnow(context, this.time, camera.x, camera.y);

    const shakeX = camera.shake > 0 ? MathUtils.randomRange(-1, 1) * camera.shake : 0;
    const shakeY = camera.shake > 0 ? MathUtils.randomRange(-1, 1) * camera.shake : 0;
    context.save();
    context.translate(this.viewWidth / 2 + shakeX, this.viewHeight / 2 + shakeY);
    context.scale(camera.zoom, camera.zoom);
    context.translate(-camera.x, -camera.y);

    const bounds = this.getVisibleBounds(80);
    this.background.streamSeabed(bounds.left, bounds.right);
    this.background.drawSurface(context, bounds.left, bounds.right, bounds.top, this.time);
    this.background.drawSeabed(context, bounds.left, bounds.right, bounds.bottom, this.time);

    const isVisible = (entity, radius) => entity.x > bounds.left - radius && entity.x < bounds.right + radius
      && entity.y > bounds.top - radius && entity.y < bounds.bottom + radius;

    context.save();
    context.globalCompositeOperation = "lighter";
    for (const plankton of this.planktons) if (isVisible(plankton, 20)) plankton.draw(context);
    context.restore();

    for (const jellyfish of this.jellyfishes) {
      if (isVisible(jellyfish, jellyfish.bellRadius * 4)) jellyfish.draw(context, this.time);
    }

    // Smaller fish first so big ones visually swim over them.
    const visibleFishes = this.fishes.filter((fish) => isVisible(fish, fish.size));
    visibleFishes.sort((first, second) => first.size - second.size);
    for (const fish of visibleFishes) FishRenderer.drawFish(context, fish, camera.zoom);
    if (this.player && this.state === "playing") FishRenderer.drawFish(context, this.player, camera.zoom);

    context.save();
    context.globalCompositeOperation = "lighter";
    for (const particle of this.particles) if (particle.kind !== "bubble" && isVisible(particle, 40)) particle.draw(context);
    context.restore();
    for (const particle of this.particles) if (particle.kind === "bubble" && isVisible(particle, 20)) particle.draw(context);
    if (scenery) scenery.drawForeground(context, camera.x, camera.y, bounds.left, bounds.right, this.time);
    context.restore();

    if (this.state === "playing") this.drawThreatIndicators(context);
    this.background.drawVignette(context);
  }

  /** Red edge markers point toward off-screen predators that are currently hunting the player. */
  drawThreatIndicators(context) {
    const margin = 28;
    for (const fish of this.fishes) {
      if (!fish.isHunting) continue;
      const screenPoint = this.worldToScreen(fish.x, fish.y);
      const isOnScreen = screenPoint.x > 0 && screenPoint.x < this.viewWidth && screenPoint.y > 0 && screenPoint.y < this.viewHeight;
      if (isOnScreen) continue;
      const angle = Math.atan2(screenPoint.y - this.viewHeight / 2, screenPoint.x - this.viewWidth / 2);
      const markerX = MathUtils.clamp(screenPoint.x, margin, this.viewWidth - margin);
      const markerY = MathUtils.clamp(screenPoint.y, margin, this.viewHeight - margin);
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 8);
      drawSoftGlow(context, markerX, markerY, 26, "#ff3b4a", 0.35 * pulse);
      context.save();
      context.translate(markerX, markerY);
      context.rotate(angle);
      context.fillStyle = `rgba(255,90,100,${(0.85 * pulse).toFixed(3)})`;
      context.beginPath();
      context.moveTo(11, 0);
      context.lineTo(-7, -8);
      context.quadraticCurveTo(-3, 0, -7, 8);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  frame(timestamp) {
    // Clamp the step so a backgrounded tab does not teleport everything on return.
    const deltaSeconds = MathUtils.clamp((timestamp - this.lastFrameTime) / 1000, 0, 1 / 30);
    this.lastFrameTime = timestamp;
    // While paused the scene keeps rendering (frozen) so the pause card has the game behind it.
    if (!this.isPaused) this.update(deltaSeconds);
    this.render();
    requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.deepSeaGame = new Game();
});
