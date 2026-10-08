import type { GraphSnapshot } from '@follo/shared';

/** Rank the acyclic condensation graph so dependencies flow from left to right. */
export function mapLayout(snapshot: GraphSnapshot, ids: Set<string>) {
  const groups = new Map<string, string>();
  for (const cycle of snapshot.cycles) for (const id of cycle.fileIds) groups.set(id, cycle.id);
  for (const id of ids) if (!groups.has(id)) groups.set(id, id);
  const members = new Map<string, string[]>();

  for (const node of snapshot.nodes
    .filter((node) => ids.has(node.id))
    .sort((a, b) => a.path.localeCompare(b.path))) {
    const group = groups.get(node.id)!;
    const list = members.get(group) ?? [];
    list.push(node.id);
    members.set(group, list);
  }

  const outgoing = new Map([...members.keys()].map((group) => [group, new Set<string>()]));
  const incoming = new Map([...members.keys()].map((group) => [group, 0]));

  for (const edge of snapshot.edges) {
    if (!ids.has(edge.sourceFileId) || !ids.has(edge.targetFileId)) continue;
    const source = groups.get(edge.sourceFileId)!;
    const target = groups.get(edge.targetFileId)!;

    if (source !== target && !outgoing.get(source)!.has(target)) {
      outgoing.get(source)!.add(target);
      incoming.set(target, incoming.get(target)! + 1);
    }
  }

  const ranks = new Map([...members.keys()].map((group) => [group, 0]));
  const queue = [...members.keys()].filter((group) => incoming.get(group) === 0);

  for (let index = 0; index < queue.length; index++)
    for (const target of outgoing.get(queue[index])!) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(queue[index])! + 1));
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }

  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();

  for (const [group, nodes] of members) {
    const rank = ranks.get(group)!;

    for (const id of nodes) {
      const row = rows.get(rank) ?? 0;
      positions.set(id, { x: rank * 360, y: row * 100 });
      rows.set(rank, row + 1);
    }
  }

  return positions;
}
