import { mat4, vec3, vec4 } from 'gl-matrix';

const UP = vec3.fromValues(0, 1, 0);

export class StrategyCamera {
  readonly view = mat4.create();
  readonly projection = mat4.create();
  readonly viewProjection = mat4.create();
  readonly inverseViewProjection = mat4.create();
  readonly position = vec3.create();
  readonly target = vec3.create();

  distance = 8_900;
  yaw = 0;
  pitch = 0.78;
  minDistance = 180;
  maxDistance = 10_800;
  minimumAltitude = 300;
  worldWidth = 13_562;
  worldHeight = 7_000;
  viewportWidth = 1;
  viewportHeight = 1;

  private keys = new Set<string>();
  private dragMode: 'pan' | 'orbit' | null = null;
  private lastPointer = [0, 0];
  private canvas?: HTMLCanvasElement;

  constructor() {
    vec3.set(this.target, this.worldWidth * 0.5, 0, this.worldHeight * 0.5);
  }

  configureWorld(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
    vec3.set(this.target, width * 0.5, 0, height * 0.5);
    this.maxDistance = Math.max(width, height) * 0.8;
    this.distance = Math.max(width, height) * 0.66;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas = undefined;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  update(deltaSeconds: number): void {
    const move = vec3.create();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move[2] -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move[2] += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move[0] -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move[0] += 1;
    if (vec3.squaredLength(move) > 0) {
      vec3.normalize(move, move);
      const speed = clamp(this.distance * 0.48, 140, 2_900) * deltaSeconds;
      this.pan(move[0] * speed, move[2] * speed);
    }
    this.normalizeTarget();
    this.recalculateMatrices();
  }

  screenRay(clientX: number, clientY: number): { origin: vec3; direction: vec3 } {
    const rect = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: this.viewportWidth, height: this.viewportHeight };
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((clientY - rect.top) / rect.height) * 2;
    const near = vec4.fromValues(x, y, 0, 1);
    const far = vec4.fromValues(x, y, 1, 1);
    vec4.transformMat4(near, near, this.inverseViewProjection);
    vec4.transformMat4(far, far, this.inverseViewProjection);
    vec4.scale(near, near, 1 / near[3]);
    vec4.scale(far, far, 1 / far[3]);
    const origin = vec3.fromValues(near[0], near[1], near[2]);
    const direction = vec3.fromValues(far[0] - near[0], far[1] - near[1], far[2] - near[2]);
    vec3.normalize(direction, direction);
    return { origin, direction };
  }

  private recalculateMatrices(): void {
    this.distance = Math.max(this.distance, this.minimumAltitude / Math.max(0.12, Math.sin(this.pitch)));
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.position[0] = this.target[0] + Math.sin(this.yaw) * horizontal;
    this.position[1] = Math.sin(this.pitch) * this.distance;
    this.position[2] = this.target[2] + Math.cos(this.yaw) * horizontal;
    mat4.perspectiveZO(this.projection, Math.PI / 4.1, this.viewportWidth / this.viewportHeight, 2, 40_000);
    mat4.lookAt(this.view, this.position, this.target, UP);
    mat4.multiply(this.viewProjection, this.projection, this.view);
    mat4.invert(this.inverseViewProjection, this.viewProjection);
  }

  private pan(rightAmount: number, forwardAmount: number): void {
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    this.target[0] += rightX * rightAmount + forwardX * forwardAmount;
    this.target[2] += rightZ * rightAmount + forwardZ * forwardAmount;
  }

  private normalizeTarget(): void {
    this.target[0] = ((this.target[0] % this.worldWidth) + this.worldWidth) % this.worldWidth;
    this.target[2] = clamp(this.target[2], -160, this.worldHeight + 160);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.dragMode = event.button === 2 ? 'orbit' : 'pan';
    this.lastPointer = [event.clientX, event.clientY];
    this.canvas?.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragMode) return;
    const dx = event.clientX - this.lastPointer[0];
    const dy = event.clientY - this.lastPointer[1];
    this.lastPointer = [event.clientX, event.clientY];
    if (this.dragMode === 'orbit') {
      this.yaw -= dx * 0.0045;
      this.pitch = clamp(this.pitch + dy * 0.0035, 0.43, 1.23);
    } else {
      const scale = this.distance * 0.00145;
      this.pan(-dx * scale, -dy * scale);
    }
  };

  private onPointerUp = (): void => {
    this.dragMode = null;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const before = this.groundPoint(event.clientX, event.clientY);
    const factor = Math.exp(event.deltaY * 0.00115);
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
    this.recalculateMatrices();
    const after = this.groundPoint(event.clientX, event.clientY);
    if (before && after) {
      this.target[0] += before[0] - after[0];
      this.target[2] += before[2] - after[2];
      this.normalizeTarget();
      this.recalculateMatrices();
    }
  };

  private groundPoint(clientX: number, clientY: number): vec3 | null {
    const ray = this.screenRay(clientX, clientY);
    if (Math.abs(ray.direction[1]) < 0.0001) return null;
    const distance = -ray.origin[1] / ray.direction[1];
    if (distance < 0) return null;
    const point = vec3.create();
    vec3.scaleAndAdd(point, ray.origin, ray.direction, distance);
    return point;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
