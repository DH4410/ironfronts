import type { SimContext } from '../sim-context';

/** Province spatially containing a graph node. */
export function provinceAtNode(session: SimContext, nodeId: number): number | null {
  if (nodeId < 0 || nodeId >= session.graph.nodeCount) return null;
  const x = session.graph.nodeX[nodeId];
  const z = session.graph.nodeZ[nodeId];
  const provinceId = session.world.provinceAt(x, z);
  return provinceId >= 0 ? provinceId : null;
}
