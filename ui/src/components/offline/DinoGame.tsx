import React, { useEffect, useRef } from "react";

type ObstacleType = "cactus" | "bird";

type Obstacle = {
  x: number;
  y: number;
  width: number;
  height: number;
  type: ObstacleType;
  wingPhase: number;
  pose?: "small" | "tall";
};

type Dino = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  vy: number;
  onGround: boolean;
  isCrouching: boolean;
};

type GameState = {
  width: number;
  height: number;
  groundY: number;
  scale: number;
  speed: number;
  score: number;
  hiScore: number;
  isRunning: boolean;
  isGameOver: boolean;
  lastSpawnMs: number;
  nextSpawnMs: number;
  dino: Dino;
  obstacles: Obstacle[];
};

const BASE_HEIGHT = 280;
const MAX_WIDTH = 1200;
const GRAVITY = 0.7;
const JUMP_VELOCITY = -12.5;
const BASE_DINO_WIDTH = 52;
const BASE_DINO_HEIGHT = 58;

const computeScale = (width: number) => {
  if (width >= 1400) {
    return 1.6;
  }
  if (width >= 1200) {
    return 1.45;
  }
  if (width >= 960) {
    return 1.3;
  }
  if (width <= 420) {
    return 0.75;
  }
  if (width <= 520) {
    return 0.85;
  }
  return 1;
};

const createGameState = (width: number, height: number, scale: number): GameState => {
  const groundY = height - Math.round(26 * scale);
  const dinoHeight = Math.round(BASE_DINO_HEIGHT * scale);
  const dinoWidth = Math.round(BASE_DINO_WIDTH * scale);
  return {
    width,
    height,
    scale,
    groundY,
    speed: 3,
    score: 0,
    hiScore: 0,
    isRunning: false,
    isGameOver: false,
    lastSpawnMs: 0,
    nextSpawnMs: 900,
    dino: {
      x: Math.round(40 * scale),
      y: groundY - dinoHeight,
      width: dinoWidth,
      height: dinoHeight,
      baseWidth: dinoWidth,
      baseHeight: dinoHeight,
      vy: 0,
      onGround: true,
      isCrouching: false,
    },
    obstacles: [],
  };
};

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const applyCrouch = (game: GameState) => {
  const dino = game.dino;
  if (!dino.onGround) {
    return;
  }
  dino.width = dino.baseWidth;
  dino.height = dino.baseHeight;
  dino.y = game.groundY - dino.height;
};

const spawnObstacle = (game: GameState) => {
  const type: ObstacleType = Math.random() < 0.7 ? "cactus" : "bird";
  if (type === "cactus") {
    const isTall = Math.random() < 0.45;
    const height = Math.round((isTall ? randomBetween(92, 112) : randomBetween(40, 48)) * game.scale);
    const width = Math.round(randomBetween(22, 26) * game.scale);
    game.obstacles.push({
      x: game.width + randomBetween(20, 60),
      y: game.groundY - height,
      width,
      height,
      type,
      wingPhase: 0,
      pose: isTall ? "tall" : "small",
    });
  } else {
    const height = Math.round(20 * game.scale);
    const width = Math.round(28 * game.scale);
    const yOffset = Math.round((Math.random() < 0.5 ? 60 : 90) * game.scale);
    game.obstacles.push({
      x: game.width + randomBetween(20, 60),
      y: game.groundY - yOffset,
      width,
      height,
      type,
      wingPhase: Math.random() * Math.PI,
    });
  }
};

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

type SpritePalette = Record<string, string>;

const drawSprite = (
  ctx: CanvasRenderingContext2D,
  sprite: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  palette: SpritePalette
) => {
  const spriteHeight = sprite.length;
  const spriteWidth = sprite[0]?.length ?? 0;
  if (!spriteWidth || !spriteHeight) {
    return;
  }
  const unit = Math.min(width / spriteWidth, height / spriteHeight);
  const renderWidth = spriteWidth * unit;
  const renderHeight = spriteHeight * unit;
  const offsetX = x + (width - renderWidth) / 2;
  const offsetY = y + (height - renderHeight);

  for (let row = 0; row < spriteHeight; row += 1) {
    const line = sprite[row];
    for (let col = 0; col < spriteWidth; col += 1) {
      const cell = line[col];
      if (!cell || cell === ".") {
        continue;
      }
      const x1 = Math.round(offsetX + col * unit);
      const y1 = Math.round(offsetY + row * unit);
      const x2 = Math.round(offsetX + (col + 1) * unit);
      const y2 = Math.round(offsetY + (row + 1) * unit);
      const w = Math.max(1, x2 - x1);
      const h = Math.max(1, y2 - y1);
      if (cell === "E") {
        ctx.fillStyle = "#f9fafb";
        ctx.fillRect(x1, y1, w, h);
        const eyeX = Math.round(x1 + w * 0.35);
        const eyeY = Math.round(y1 + h * 0.35);
        const eyeSize = Math.max(1, Math.round(Math.min(w, h) * 0.35));
        ctx.fillStyle = "#111827";
        ctx.fillRect(eyeX, eyeY, eyeSize, eyeSize);
        continue;
      }
      const color = palette[cell];
      if (!color) {
        continue;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x1, y1, w, h);
    }
  }
};

const drawSilhouette = (
  ctx: CanvasRenderingContext2D,
  sprite: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
) => {
  const spriteHeight = sprite.length;
  const spriteWidth = sprite[0]?.length ?? 0;
  if (!spriteWidth || !spriteHeight) {
    return;
  }
  const unit = Math.min(width / spriteWidth, height / spriteHeight);
  const renderWidth = spriteWidth * unit;
  const renderHeight = spriteHeight * unit;
  const offsetX = x + (width - renderWidth) / 2;
  const offsetY = y + (height - renderHeight);

  ctx.fillStyle = color;
  for (let row = 0; row < spriteHeight; row += 1) {
    const line = sprite[row];
    for (let col = 0; col < spriteWidth; col += 1) {
      const cell = line[col];
      if (!cell || cell === ".") {
        continue;
      }
      const x1 = Math.round(offsetX + col * unit);
      const y1 = Math.round(offsetY + row * unit);
      const x2 = Math.round(offsetX + (col + 1) * unit);
      const y2 = Math.round(offsetY + (row + 1) * unit);
      ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
    }
  }
};

const MAN_SPRITE = [
  ".......HHHH.......",
  "......HHHHHH......",
  "........SS........",
  ".......SSSE.......",
  ".......####.......",
  "......######......",
  ".....########.....",
  ".....########.....",
  ".....########SBB..",
  ".....#######SBB...",
  ".....#######SFB...",
  ".....######SBB....",
  ".....###.####.....",
  "....####.####.....",
  "....###...###.....",
  "....###...###.....",
  "....##.....##.....",
];

const MAN_CROUCH_SPRITE = [
  "..................",
  "..................",
  "..................",
  "..................",
  "..................",
  ".......HHHH.......",
  "......HHHHHH......",
  "........SS........",
  ".......SSSE.......",
  ".......SSSS..B....",
  ".....########BB...",
  "....#########B....",
  "...##########.....",
  "..###########.....",
  ".###########......",
  ".###########......",
  "..########........",
  "..#######.........",
];

const MAN_PALETTE: SpritePalette = {
  "#": "#1f2937",
  "S": "#f2c9a0",
  "B": "#f59e0b",
  "F": "#fde68a",
  "H": "#1f2937",
};


const BOTTLE_SPRITE = [
  ".....###.....",
  ".....###.....",
  ".....###.....",
  ".....###.....",
  ".....###.....",
  "....#####....",
  "...#######...",
  "..#########..",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
  ".###########.",
];

const reduceBottleSprite = (rows: string[], removeCount: number) => {
  let remaining = removeCount;
  const reduced: string[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (remaining > 0 && row === ".###########.") {
      remaining -= 1;
      continue;
    }
    reduced.push(row);
  }
  return reduced.reverse();
};

const BOTTLE_SMALL_SPRITE = reduceBottleSprite(BOTTLE_SPRITE, 5);

const BOTTLE_PALETTE: SpritePalette = {
  "#": "#111827",
};

const drawRunner = (ctx: CanvasRenderingContext2D, dino: Dino) => {
  const shadowOffset = Math.max(1, Math.round(dino.width * 0.04));
  const sprite = dino.isCrouching && dino.onGround ? MAN_CROUCH_SPRITE : MAN_SPRITE;
  drawSilhouette(ctx, sprite, dino.x + shadowOffset, dino.y + shadowOffset, dino.width, dino.height, "rgba(17, 24, 39, 0.35)");
  drawSprite(ctx, sprite, dino.x, dino.y, dino.width, dino.height, MAN_PALETTE);
};

const drawBottle = (ctx: CanvasRenderingContext2D, obstacle: Obstacle) => {
  const sprite = obstacle.pose === "small" ? BOTTLE_SMALL_SPRITE : BOTTLE_SPRITE;
  drawSprite(ctx, sprite, obstacle.x, obstacle.y, obstacle.width, obstacle.height, BOTTLE_PALETTE);
};

const drawCactus = (ctx: CanvasRenderingContext2D, obstacle: Obstacle) => {
  drawBottle(ctx, obstacle);
};

const drawBird = (ctx: CanvasRenderingContext2D, obstacle: Obstacle) => {
  const wingLift = Math.sin(obstacle.wingPhase) * 5;
  const centerX = obstacle.x + obstacle.width / 2;
  const bodyY = obstacle.y + obstacle.height / 2 + 4;

  ctx.fillStyle = "#374151";
  ctx.beginPath();
  ctx.ellipse(centerX, bodyY, obstacle.width / 2.4, obstacle.height / 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX - obstacle.width / 2, obstacle.y + 10);
  ctx.lineTo(centerX, obstacle.y + wingLift);
  ctx.lineTo(centerX + obstacle.width / 2, obstacle.y + 10);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX + obstacle.width / 2 - 2, bodyY - 1);
  ctx.lineTo(centerX + obstacle.width / 2 + 4, bodyY + 1);
  ctx.lineTo(centerX + obstacle.width / 2 - 2, bodyY + 3);
  ctx.closePath();
  ctx.fill();
};

const drawKrakowLandmarks = (ctx: CanvasRenderingContext2D, game: GameState) => {
  const horizonY = game.groundY - Math.round(20 * game.scale);
  ctx.fillStyle = "#8b5e3c";
  ctx.fillRect(0, horizonY, game.width, Math.round(8 * game.scale));

  // Main Market Hall (left)
  const hallX = Math.round(game.width * 0.05);
  const hallW = Math.round(game.width * 0.28);
  const hallH = Math.round(game.height * 0.18);
  const hallY = horizonY - hallH;
  ctx.fillStyle = "#7a4b2e";
  ctx.fillRect(hallX, hallY, hallW, hallH);
  ctx.fillStyle = "#5b3824";
  ctx.fillRect(hallX, hallY - Math.round(12 * game.scale), hallW, Math.round(12 * game.scale));
  ctx.fillStyle = "#d9c5a2";
  const archCount = 6;
  const archW = Math.round(hallW / (archCount + 1));
  const archH = Math.round(hallH * 0.65);
  for (let i = 0; i < archCount; i += 1) {
    const ax = hallX + Math.round(archW * (i + 0.5));
    const aw = Math.round(archW * 0.6);
    const ay = hallY + hallH - archH;
    ctx.beginPath();
    ctx.moveTo(ax, ay + archH);
    ctx.lineTo(ax, ay + Math.round(archH * 0.4));
    ctx.quadraticCurveTo(ax + aw / 2, ay - Math.round(archH * 0.2), ax + aw, ay + Math.round(archH * 0.4));
    ctx.lineTo(ax + aw, ay + archH);
    ctx.closePath();
    ctx.fill();
  }

  // Market Hall central tower
  const hallTowerW = Math.round(hallW * 0.12);
  const hallTowerH = Math.round(hallH * 0.55);
  const hallTowerX = hallX + Math.round(hallW * 0.5) - Math.round(hallTowerW / 2);
  const hallTowerY = hallY - hallTowerH;
  ctx.fillStyle = "#6b4027";
  ctx.fillRect(hallTowerX, hallTowerY, hallTowerW, hallTowerH);
  ctx.fillStyle = "#4c2a1d";
  ctx.beginPath();
  ctx.moveTo(hallTowerX, hallTowerY);
  ctx.lineTo(hallTowerX + hallTowerW / 2, hallTowerY - Math.round(14 * game.scale));
  ctx.lineTo(hallTowerX + hallTowerW, hallTowerY);
  ctx.closePath();
  ctx.fill();

  // Adam Mickiewicz Monument (center)
  const statueX = Math.round(game.width * 0.52);
  const pedestalW = Math.round(game.width * 0.08);
  const pedestalH = Math.round(game.height * 0.12);
  ctx.fillStyle = "#8f6445";
  ctx.fillRect(statueX, horizonY - pedestalH, pedestalW, pedestalH);

  // Base tiers
  ctx.fillStyle = "#6b4a32";
  const baseTierH = Math.round(pedestalH * 0.22);
  ctx.fillRect(statueX - Math.round(pedestalW * 0.08), horizonY - pedestalH - baseTierH, Math.round(pedestalW * 1.16), baseTierH);
  const upperTierH = Math.round(pedestalH * 0.18);
  ctx.fillRect(statueX + Math.round(pedestalW * 0.1), horizonY - pedestalH - baseTierH - upperTierH, Math.round(pedestalW * 0.8), upperTierH);

  // Column
  const columnW = Math.round(pedestalW * 0.45);
  const columnH = Math.round(pedestalH * 0.85);
  const columnX = statueX + Math.round(pedestalW * 0.27);
  const columnY = horizonY - pedestalH - baseTierH - upperTierH - columnH;
  ctx.fillRect(columnX, columnY, columnW, columnH);

  // Adam statue silhouette (head, neck, shoulders, torso, legs, cloak, arm)
  ctx.fillStyle = "#935e52ff";
  const headR = Math.round(pedestalW * 0.10);
  const neckW = Math.round(pedestalW * 0.10);
  const torsoW = Math.round(pedestalW * 0.30);
  const torsoH = Math.round(pedestalH * 0.70);
  const torsoX = statueX + Math.round(pedestalW * 0.34);
  const torsoY = columnY - torsoH  - 8;
  const headCx = statueX + Math.round(pedestalW * 0.5);
  const headCy = torsoY - headR;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(headCx - Math.round(neckW / 2), headCy + headR, neckW, Math.round(headR * 0.9));
  ctx.fillRect(torsoX, torsoY, torsoW, torsoH);

  // Shoulders
  ctx.beginPath();
  ctx.moveTo(torsoX - Math.round(torsoW * 0.2), torsoY + Math.round(torsoH * 0.1));
  ctx.lineTo(torsoX + Math.round(torsoW * 1.2), torsoY + Math.round(torsoH * 0.1));
  ctx.lineTo(torsoX + Math.round(torsoW * 1.05), torsoY + Math.round(torsoH * 0.3));
  ctx.lineTo(torsoX - Math.round(torsoW * 0.05), torsoY + Math.round(torsoH * 0.3));
  ctx.closePath();
  ctx.fill();

  // Cloak drape
  ctx.beginPath();
  ctx.moveTo(torsoX + torsoW, torsoY);
  ctx.lineTo(torsoX + Math.round(torsoW * 1.55), torsoY + Math.round(torsoH * 0.3));
  ctx.lineTo(torsoX + Math.round(torsoW * 1.1), torsoY + Math.round(torsoH * 0.85));
  ctx.lineTo(torsoX + Math.round(torsoW * 0.6), torsoY + torsoH);
  ctx.closePath();
  ctx.fill();

  // Arm
  ctx.fillRect(torsoX - Math.round(torsoW * 0.22), torsoY + Math.round(torsoH * 0.25), Math.round(torsoW * 0.18), Math.round(torsoH * 0.5));

  // Legs
  const legW = Math.round(torsoW * 0.28);
  const legH = Math.round(torsoH * 0.45);
  const legY = torsoY + torsoH;
  ctx.fillRect(torsoX + Math.round(torsoW * 0.08), legY - Math.round(legH * 0.2), legW, legH);
  ctx.fillRect(torsoX + Math.round(torsoW * 0.6), legY - Math.round(legH * 0.15), legW, legH);

  // Corner figures
  ctx.fillStyle = "#5b3c2a";
  const figureW = Math.round(pedestalW * 0.2);
  const figureH = Math.round(pedestalH * 0.28);
  ctx.fillRect(statueX - Math.round(pedestalW * 0.06), horizonY - Math.round(pedestalH * 0.52), figureW, figureH);
  ctx.fillRect(statueX + Math.round(pedestalW * 0.86), horizonY - Math.round(pedestalH * 0.52), figureW, figureH);


  // St. Mary's Basilica (right)
  const churchW = Math.round(game.width * 0.13);
  const churchX = Math.round(game.width * 0.80);
  const naveH = Math.round(game.height * 0.26);
  const naveY = horizonY - naveH;
  const towerW = Math.round(churchW * 0.35);
  const leftTowerH = Math.round(game.height * 0.48);
  const rightTowerH = Math.round(game.height * 0.36);

  // Nave body
  ctx.fillStyle = "#b55a2a";
  ctx.fillRect(churchX, naveY, churchW, naveH);
  ctx.fillStyle = "#8f4a26";
  ctx.fillRect(churchX, naveY - Math.round(10 * game.scale), churchW, Math.round(10 * game.scale));

  // Central gable roof
  ctx.fillStyle = "#3b4755";
  ctx.beginPath();
  ctx.moveTo(churchX + Math.round(churchW * 0.28), naveY);
  ctx.lineTo(churchX + Math.round(churchW * 0.5), naveY - Math.round(26 * game.scale));
  ctx.lineTo(churchX + Math.round(churchW * 0.72), naveY);
  ctx.closePath();
  ctx.fill();

  // Towers
  const leftTowerX = churchX + Math.round(churchW * 0.00);
  const rightTowerX = churchX + churchW - towerW - Math.round(churchW * 0.00);
  const leftTowerY = horizonY - leftTowerH;
  const rightTowerY = horizonY - rightTowerH;
  ctx.fillStyle = "#c1622c";
  ctx.fillRect(leftTowerX, leftTowerY, towerW, leftTowerH);
  ctx.fillRect(rightTowerX, rightTowerY, towerW, rightTowerH);

  // Tower roofs
  ctx.fillStyle = "#2f3a46";
  ctx.beginPath();
  ctx.moveTo(leftTowerX, leftTowerY);
  ctx.lineTo(leftTowerX + towerW / 2, leftTowerY - Math.round(34 * game.scale));
  ctx.lineTo(leftTowerX + towerW, leftTowerY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(rightTowerX, rightTowerY);
  ctx.lineTo(rightTowerX + towerW / 2, rightTowerY - Math.round(18 * game.scale));
  ctx.lineTo(rightTowerX + towerW, rightTowerY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightTowerX + towerW / 2, rightTowerY - Math.round(20 * game.scale), Math.round(6 * game.scale), 0, Math.PI * 2);
  ctx.fill();

  // Central cross
  const crossX = churchX + Math.round(churchW * 0.5);
  const crossY = naveY - Math.round(39 * game.scale);
  ctx.fillStyle = "#2f3a46";
  ctx.fillRect(crossX - Math.round(2 * game.scale), crossY, Math.round(4 * game.scale), Math.round(16 * game.scale));
  ctx.fillRect(crossX - Math.round(7 * game.scale), crossY + Math.round(6 * game.scale), Math.round(14 * game.scale), Math.round(3 * game.scale));

  // Facade details
  ctx.fillStyle = "#f0e6d2";
  ctx.beginPath();
  ctx.arc(churchX + Math.round(churchW * 0.5), naveY + Math.round(naveH * 0.45), Math.round(churchW * 0.085), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(churchX + Math.round(churchW * 0.47), naveY + Math.round(naveH * 0.6), Math.round(churchW * 0.06), Math.round(naveH * 0.3));

  // Tower windows (simple verticals)
  ctx.fillStyle = "#f2f1ea";
  const windowW = Math.max(2, Math.round(towerW * 0.18));
  const windowH = Math.max(6, Math.round(leftTowerH * 0.12));
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(leftTowerX + Math.round(towerW * 0.4), leftTowerY + Math.round(leftTowerH * (0.18 + i * 0.22)), windowW, windowH);
  }
  const rightWindowH = Math.max(6, Math.round(rightTowerH * 0.14));
  for (let i = 0; i < 2; i += 1) {
    ctx.fillRect(rightTowerX + Math.round(towerW * 0.4), rightTowerY + Math.round(rightTowerH * (0.22 + i * 0.28)), windowW, rightWindowH);
  }
};

const drawBackground = (ctx: CanvasRenderingContext2D, game: GameState) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, game.height);
  gradient.addColorStop(0, "#c8d8f0");
  gradient.addColorStop(0.45, "#e0c2a6");
  gradient.addColorStop(1, "#e4b487");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, game.width, game.height);

  // City skyline backdrop
  const skylineBaseY = game.groundY - Math.round(20 * game.scale);
  ctx.fillStyle = "rgba(92, 74, 64, 0.35)";
  const blockCount = 12;
  for (let i = 0; i < blockCount; i += 1) {
    const blockW = Math.round(game.width / blockCount);
    const blockH = Math.round((42 + (i % 3) * 16) * game.scale);
    const x = Math.round(blockW * i);
    const y = skylineBaseY - blockH;
    ctx.fillRect(x, y, blockW, blockH);
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.moveTo(x + Math.round(blockW * 0.2), y);
      ctx.lineTo(x + Math.round(blockW * 0.5), y - Math.round(14 * game.scale));
      ctx.lineTo(x + Math.round(blockW * 0.8), y);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawKrakowLandmarks(ctx, game);
};

const drawGround = (ctx: CanvasRenderingContext2D, game: GameState) => {
  ctx.strokeStyle = "#7c3f1c";
  ctx.lineWidth = Math.max(1, Math.round(2 * game.scale));
  ctx.beginPath();
  ctx.moveTo(0, game.groundY + 1);
  ctx.lineTo(game.width, game.groundY + 1);
  ctx.stroke();
  ctx.fillStyle = "#b7791f";
  const dashSpacing = Math.round(28 * game.scale);
  const dashWidth = Math.round(6 * game.scale);
  const dashHeight = Math.max(1, Math.round(2 * game.scale));
  const dashOffset = game.score % dashSpacing;
  for (let i = 0; i < game.width; i += dashSpacing) {
    ctx.fillRect(i + dashOffset, game.groundY + Math.round(6 * game.scale), dashWidth, dashHeight);
  }
};

const drawScore = (ctx: CanvasRenderingContext2D, game: GameState) => {
  ctx.fillStyle = "#111827";
  const fontSize = Math.round(12 * Math.max(0.9, game.scale));
  ctx.font = `${fontSize}px Open Sans, sans-serif`;
  const score = Math.floor(game.score).toString().padStart(5, "0");
  const hiScore = Math.floor(game.hiScore).toString().padStart(5, "0");
  ctx.fillText(`HI ${hiScore}`, game.width - 140, 22);
  ctx.fillText(score, game.width - 60, 22);
};

const drawMessage = (ctx: CanvasRenderingContext2D, game: GameState, text: string, subtext?: string, y?: number) => {
  ctx.fillStyle = "#111827";
  ctx.font = `${Math.round(18 * Math.max(0.9, game.scale))}px Roboto Slab, serif`;
  const textWidth = ctx.measureText(text).width;
  const baseY = y ?? game.height / 2 - 8;
  ctx.fillText(text, (game.width - textWidth) / 2, baseY);
  if (subtext) {
    ctx.font = `${Math.round(13 * Math.max(0.9, game.scale))}px Open Sans, sans-serif`;
    const subWidth = ctx.measureText(subtext).width;
    ctx.fillText(subtext, (game.width - subWidth) / 2, baseY + 26);
  }
};

const updateGame = (game: GameState, delta: number) => {
  if (!game.isRunning || game.isGameOver) {
    return;
  }

  game.score += delta;
  game.speed = 2.2 + Math.min(game.score / 320, 4.5);

  game.lastSpawnMs += delta * 16.67;
  if (game.lastSpawnMs >= game.nextSpawnMs) {
    spawnObstacle(game);
    game.lastSpawnMs = 0;
    game.nextSpawnMs = randomBetween(900, 1500) - Math.min(game.score * 1.4, 350);
  }

  const dino = game.dino;
  dino.vy += GRAVITY * delta * game.scale;
  dino.y += dino.vy * delta;
  if (dino.y >= game.groundY - dino.height) {
    dino.y = game.groundY - dino.height;
    dino.vy = 0;
    dino.onGround = true;
  }
  applyCrouch(game);

  game.obstacles.forEach((obstacle) => {
    obstacle.x -= game.speed * delta;
    if (obstacle.type === "bird") {
      obstacle.wingPhase += 0.25 * delta;
    }
  });

  game.obstacles = game.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -10);

  const isAirborne = !dino.onGround;
  const isCrouching = dino.isCrouching && dino.onGround;
  const hitBox = {
    x: dino.x + Math.round(dino.width * 0.32),
    y: dino.y + Math.round(dino.height * (isAirborne ? 0.3 : isCrouching ? 0.45 : 0.18)),
    width: Math.max(6, Math.round(dino.width * 0.36)),
    height: Math.max(10, Math.round(dino.height * (isAirborne ? 0.45 : isCrouching ? 0.35 : 0.62))),
  };
  for (const obstacle of game.obstacles) {
    const isBottle = obstacle.type === "cactus";
    const bottleTopInset = obstacle.pose === "tall" ? 0.34 : 0.28;
    const bottleBottomInset = isBottle ? 0.06 : 0.18;
    const insetX = isBottle ? obstacle.width * 0.36 : obstacle.width * 0.18;
    const insetTop = isBottle ? obstacle.height * bottleTopInset : obstacle.height * 0.18;
    const insetBottom = obstacle.height * bottleBottomInset;
    const obstacleBox = {
      x: obstacle.x + Math.round(insetX),
      y: obstacle.y + Math.round(insetTop),
      width: Math.max(6, Math.round(obstacle.width - insetX * 2)),
      height: Math.max(6, Math.round(obstacle.height - insetTop - insetBottom)),
    };
    if (intersects(hitBox, obstacleBox)) {
      game.isGameOver = true;
      game.isRunning = false;
      game.hiScore = Math.max(game.hiScore, game.score);
      break;
    }
  }
};

const drawGame = (ctx: CanvasRenderingContext2D, game: GameState) => {
  ctx.clearRect(0, 0, game.width, game.height);
  drawBackground(ctx, game);
  drawGround(ctx, game);
  drawRunner(ctx, game.dino);
  game.obstacles.forEach((obstacle) => {
    if (obstacle.type === "cactus") {
      drawCactus(ctx, obstacle);
    } else {
      drawBird(ctx, obstacle);
    }
  });
  drawScore(ctx, game);

  if (!game.isRunning && game.score === 0 && !game.isGameOver) {
    const topY = Math.max(28, Math.round(36 * game.scale));
    drawMessage(ctx, game, "Press Space or Tap to Start", "Jump over cactus and birds.", topY);
  }

  if (game.isGameOver) {
    const topY = Math.max(28, Math.round(36 * game.scale));
    drawMessage(ctx, game, "Game Over", "Press Space or Tap to Restart", topY);
  }
};

const DinoGame = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const lastTimeRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastGameOverRef = useRef(false);
  const crouchTimerRef = useRef<number | null>(null);
  const touchCrouchActiveRef = useRef(false);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctxRef.current = ctx;

    const resize = () => {
      const parent = canvas.parentElement;
      const width = window.innerWidth || parent?.clientWidth || MAX_WIDTH;
      const scale = computeScale(width);
      const height = Math.round(BASE_HEIGHT * (width <= 520 ? 0.85 : 1));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (!gameRef.current) {
        gameRef.current = createGameState(width, height, scale);
      } else {
        const game = gameRef.current;
        const previousGround = game.groundY;
        const previousScale = game.scale;
        const scaleRatio = previousScale ? scale / previousScale : 1;
        game.width = width;
        game.height = height;
        game.scale = scale;
        game.groundY = height - Math.round(26 * scale);
        game.dino.x = Math.round(40 * scale);
      game.dino.baseWidth = Math.round(BASE_DINO_WIDTH * scale);
      game.dino.baseHeight = Math.round(BASE_DINO_HEIGHT * scale);
      if (game.dino.onGround) {
        applyCrouch(game);
      }
        game.obstacles.forEach((obstacle) => {
          obstacle.width = Math.max(4, Math.round(obstacle.width * scaleRatio));
          obstacle.height = Math.max(4, Math.round(obstacle.height * scaleRatio));
          if (obstacle.type === "cactus") {
            obstacle.y = game.groundY - obstacle.height;
          } else {
            obstacle.y += game.groundY - previousGround;
          }
        });
      }
    };

    const setCrouch = (shouldCrouch: boolean) => {
      const game = gameRef.current;
      if (!game) {
        return;
      }
      game.dino.isCrouching = shouldCrouch;
      applyCrouch(game);
    };

    const playTrumpetMelody = () => {
      if (typeof window === "undefined") {
        return;
      }
      if (!audioRef.current) {
        const audio = new Audio("/audio/hejnal-mariacki.ogg");
        audio.preload = "auto";
        audio.volume = 0.5;
        audioRef.current = audio;
      }
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      if (!audio.paused && !audio.ended) {
        return;
      }
      audio.currentTime = 0;
      audio.play().catch(() => undefined);
    };

    const jump = () => {
      const game = gameRef.current;
      if (!game) {
        return;
      }
      if (game.isGameOver) {
        const previousHiScore = game.hiScore;
        gameRef.current = createGameState(game.width, game.height, game.scale);
        if (gameRef.current) {
          gameRef.current.hiScore = previousHiScore;
          lastGameOverRef.current = false;
        }
      }
      const current = gameRef.current;
      if (!current) {
        return;
      }
      if (!current.isRunning) {
        current.isRunning = true;
      }
      if (current.dino.onGround) {
        current.dino.isCrouching = false;
        applyCrouch(current);
        current.dino.vy = JUMP_VELOCITY * current.scale;
        current.dino.onGround = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
        event.preventDefault();
        jump();
        return;
      }
      if (event.code === "ArrowDown" || event.code === "KeyS") {
        event.preventDefault();
        setCrouch(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ArrowDown" || event.code === "KeyS") {
        event.preventDefault();
        setCrouch(false);
      }
    };

    const clearCrouchTimer = () => {
      if (crouchTimerRef.current) {
        window.clearTimeout(crouchTimerRef.current);
        crouchTimerRef.current = null;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      pointerDownRef.current = true;
      clearCrouchTimer();
      crouchTimerRef.current = window.setTimeout(() => {
        if (pointerDownRef.current) {
          touchCrouchActiveRef.current = true;
          setCrouch(true);
        }
      }, 160);
    };

    const handlePointerUp = (event: PointerEvent) => {
      event.preventDefault();
      pointerDownRef.current = false;
      clearCrouchTimer();
      if (!touchCrouchActiveRef.current) {
        jump();
      }
      if (touchCrouchActiveRef.current) {
        touchCrouchActiveRef.current = false;
        setCrouch(false);
      }
    };

    const handlePointerLeave = () => {
      pointerDownRef.current = false;
      clearCrouchTimer();
      if (touchCrouchActiveRef.current) {
        touchCrouchActiveRef.current = false;
        setCrouch(false);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("pointerleave", handlePointerLeave);

    const loop = (time: number) => {
      const game = gameRef.current;
      const ctx = ctxRef.current;
      if (!game || !ctx) {
        return;
      }
      const lastTime = lastTimeRef.current || time;
      const delta = Math.min((time - lastTime) / 16.67, 2);
      lastTimeRef.current = time;
      updateGame(game, delta);
      if (game.isGameOver && !lastGameOverRef.current) {
        playTrumpetMelody();
      }
      lastGameOverRef.current = game.isGameOver;
      drawGame(ctx, game);
      frameRef.current = window.requestAnimationFrame(loop);
    };

    frameRef.current = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />;
};

export default DinoGame;
