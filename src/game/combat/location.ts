import type { SimContext } from '../sim-context';

/** Province whose authored center coincides with a graph node. */
export function provinceAtNode(session: SimContext, nodeId: number): number | null {
  const x = session.graph.nodeX[nodeId];
  const z = session.graph.nodeZ[nodeId];
  const province = session.world.provinces.find(
    (candidate) => Math.round(candidate.center[0]) === Math.round(x)
      && Math.round(candidate.center[1]) === Math.round(z),
  );
  return province?.id ?? null;
}
