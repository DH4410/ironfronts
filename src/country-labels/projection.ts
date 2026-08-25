export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface ProjectedWorldPoint extends ProjectedPoint {
  worldX: number;
  worldY: number;
}

export function projectPoint(
  x: number,
  y: number,
  z: number,
  matrix: ArrayLike<number>,
  width: number,
  height: number,
): ProjectedPoint | null {
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (clipW <= 0.001) return null;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  if (ndcX < -1.35 || ndcX > 1.35 || ndcY < -1.35 || ndcY > 1.35) return null;
  return { x: (ndcX * 0.5 + 0.5) * width, y: (0.5 - ndcY * 0.5) * height };
}

export function projectBestWorldCopy(
  x: number,
  y: number,
  z: number,
  worldWidth: number,
  matrix: ArrayLike<number>,
  width: number,
  height: number,
): ProjectedWorldPoint | null {
  let best: (ProjectedWorldPoint & { score: number }) | null = null;
  for (const offset of [-worldWidth, 0, worldWidth]) {
    const worldX = x + offset;
    const projected = projectPoint(worldX, y, z, matrix, width, height);
    if (!projected) continue;
    const outsideX = Math.max(0, -projected.x, projected.x - width);
    const outsideY = Math.max(0, -projected.y, projected.y - height);
    const score = outsideX * outsideX + outsideY * outsideY
      + Math.hypot(projected.x - width * 0.5, projected.y - height * 0.5) * 0.001;
    if (!best || score < best.score) best = { ...projected, worldX, worldY: y, score };
  }
  return best;
}
