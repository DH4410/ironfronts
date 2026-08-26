import { describe, expect, it } from 'vitest';
import { parseObj } from '../src/external-models';

describe('external OBJ model parsing', () => {
  it('triangulates, normalizes and preserves render vertex stride', () => {
    const mesh = parseObj(`
      v 10 2 -4
      v 14 2 -4
      v 14 6 2
      v 10 6 2
      vn 0 1 0
      f 1//1 2//1 3//1 4//1
    `);

    expect(mesh.indices).toEqual(new Uint16Array([0, 1, 2, 0, 2, 3]));
    expect(mesh.vertices.length).toBe(4 * 7);

    const positions: number[][] = [];
    for (let offset = 0; offset < mesh.vertices.length; offset += 7) {
      positions.push([
        mesh.vertices[offset],
        mesh.vertices[offset + 1],
        mesh.vertices[offset + 2],
      ]);
      expect(mesh.vertices[offset + 6]).toBe(1);
    }
    expect(Math.min(...positions.map((position) => position[0]))).toBeCloseTo(-0.5);
    expect(Math.max(...positions.map((position) => position[0]))).toBeCloseTo(0.5);
    expect(Math.min(...positions.map((position) => position[1]))).toBeCloseTo(0);
    expect(Math.max(...positions.map((position) => position[1]))).toBeCloseTo(1);
    expect(Math.min(...positions.map((position) => position[2]))).toBeCloseTo(-0.5);
    expect(Math.max(...positions.map((position) => position[2]))).toBeCloseTo(0.5);
  });

  it('supports negative OBJ indices', () => {
    const mesh = parseObj(`
      v 0 0 0
      v 1 0 0
      v 0 1 0
      vn 0 0 1
      f -3//-1 -2//-1 -1//-1
    `);
    expect(mesh.indices.length).toBe(3);
    expect(mesh.vertices.length).toBe(21);
  });
});
