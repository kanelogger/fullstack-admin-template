type TreeShape = {
  children?: TreeShape[];
  uniqueId?: number | string;
  id?: number;
  parentId?: number | string | null;
  pathList?: Array<number | string>;
};

function treeShape<T extends object>(node: T): T & TreeShape {
  return node as T & TreeShape;
}

/** Extract each node's uniqueId in the current tree level. */
export const extractPathList = <T extends object>(tree: T[]): Array<number | string | undefined> => {
  if (!Array.isArray(tree)) {
    console.warn("tree must be an array");
    return [];
  }
  if (tree.length === 0) return [];
  const expandedPaths: Array<number | string | undefined> = [];
  for (const item of tree) {
    const node = treeShape(item);
    if (node.children?.length) extractPathList(node.children);
    expandedPaths.push(node.uniqueId);
  }
  return expandedPaths;
};

/** Remove single-child arrays and populate each node's hierarchy metadata. */
export const deleteChildren = <T extends object>(
  tree: T[],
  pathList: Array<number | string> = []
): T[] => {
  if (!Array.isArray(tree)) {
    console.warn("menuTree must be an array");
    return [];
  }
  for (const [key, item] of tree.entries()) {
    const node = treeShape(item);
    if (node.children?.length === 1) delete node.children;
    node.id = key;
    node.parentId = pathList.length ? pathList[pathList.length - 1] : null;
    node.pathList = [...pathList, node.id];
    node.uniqueId = node.pathList.length > 1 ? node.pathList.join("-") : node.pathList[0];
    if (node.children?.length) deleteChildren(node.children, node.pathList);
  }
  return tree;
};

/** Populate id, parentId and pathList for each node. */
export const buildHierarchyTree = <T extends object>(
  tree: T[],
  pathList: Array<number | string> = []
): T[] => {
  if (!Array.isArray(tree)) {
    console.warn("menuTree must be an array");
    return [];
  }
  for (const [key, item] of tree.entries()) {
    const node = treeShape(item);
    node.id = key;
    node.parentId = pathList.length ? pathList[pathList.length - 1] : null;
    node.pathList = [...pathList, node.id];
    if (node.children?.length) buildHierarchyTree(node.children, node.pathList);
  }
  return tree;
};

/** Find a node by uniqueId using a breadth-first traversal. */
export const getNodeByUniqueId = <T extends object>(
  tree: T[],
  uniqueId: number | string
): T | [] | undefined => {
  if (!Array.isArray(tree)) {
    console.warn("menuTree must be an array");
    return [];
  }
  if (!tree.length) return [];
  const item = tree.find(node => treeShape(node).uniqueId === uniqueId);
  if (item) return item;
  const children = tree.flatMap(node => treeShape(node).children ?? []);
  return getNodeByUniqueId(children as unknown as T[], uniqueId);
};

/** Append fields to the node whose uniqueId matches. */
export const appendFieldByUniqueId = <T extends object>(
  tree: T[],
  uniqueId: number | string,
  fields: Record<string, unknown>
): T[] => {
  if (!Array.isArray(tree)) {
    console.warn("menuTree must be an array");
    return [];
  }
  for (const item of tree) {
    const node = treeShape(item);
    if (
      node.uniqueId === uniqueId &&
      Object.prototype.toString.call(fields) === "[object Object]"
    ) {
      Object.assign(node, fields);
    }
    if (node.children?.length) appendFieldByUniqueId(node.children, uniqueId, fields);
  }
  return tree;
};

/** Build a hierarchy from a flat list using configurable id fields. */
export const handleTree = <T extends object>(
  data: T[],
  id = "id",
  parentId = "parentId",
  children = "children"
): T[] => {
  if (!Array.isArray(data)) {
    console.warn("data must be an array");
    return [];
  }
  const childrenByParent = new Map<string, T[]>();
  const nodesById = new Set<string>();
  const read = (item: T, key: string) => (item as Record<string, unknown>)[key];
  const keyOf = (value: unknown) => String(value);

  for (const item of data) {
    const parentKey = keyOf(read(item, parentId));
    const childrenForParent = childrenByParent.get(parentKey) ?? [];
    childrenForParent.push(item);
    childrenByParent.set(parentKey, childrenForParent);
    nodesById.add(keyOf(read(item, id)));
  }

  const roots = data.filter(item => !nodesById.has(keyOf(read(item, parentId))));
  const attachChildren = (item: T) => {
    const record = item as Record<string, unknown>;
    const childrenForNode = childrenByParent.get(keyOf(record[id]));
    if (childrenForNode) record[children] = childrenForNode;
    const nested = record[children];
    if (Array.isArray(nested)) {
      for (const child of nested) {
        if (typeof child === "object" && child !== null) attachChildren(child as T);
      }
    }
  };
  for (const root of roots) attachChildren(root);
  return roots;
};
