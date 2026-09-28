export interface TreeNode {
  id: number;
  parentId: number | null;
  children?: TreeNode[];
}

export function buildTree<T extends TreeNode>(nodes: T[]): T[] {
  const nodeMap = new Map<number, T>();
  const roots: T[] = [];

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }

    const parent = nodeMap.get(node.parentId);
    if (!parent) {
      roots.push(node);
      continue;
    }

    if (!parent.children) {
      parent.children = [];
    }
    parent.children.push(node);
  }

  return roots;
}
