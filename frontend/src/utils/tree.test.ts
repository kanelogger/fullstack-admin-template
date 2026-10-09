import { describe, expect, it } from "vitest";
import {
  appendFieldByUniqueId,
  buildHierarchyTree,
  deleteChildren,
  extractPathList,
  getNodeByUniqueId,
  handleTree
} from "./tree";

describe("tree utilities", () => {
  it("populates hierarchy metadata and preserves the tree nodes", () => {
    const tree = [{ name: "root", children: [{ name: "child" }] }, { name: "other" }];

    expect(buildHierarchyTree(tree)).toBe(tree);
    expect(tree).toMatchObject([
      {
        id: 0,
        parentId: null,
        pathList: [0],
        children: [{ id: 0, parentId: 0, pathList: [0, 0] }]
      },
      { id: 1, parentId: null, pathList: [1] }
    ]);
  });

  it("removes single-child arrays and derives stable unique IDs", () => {
    const tree = [{ name: "root", children: [{ name: "only-child" }] }];
    deleteChildren(tree);
    expect(tree[0]).toMatchObject({ id: 0, parentId: null, pathList: [0], uniqueId: 0 });
    expect(tree[0]).not.toHaveProperty("children");
  });

  it("finds and updates a nested node by uniqueId", () => {
    const tree = [{ uniqueId: "root", children: [{ uniqueId: "root-child", name: "before" }] }];
    const found = getNodeByUniqueId(tree, "root-child");
    expect(found).toMatchObject({ name: "before" });
    appendFieldByUniqueId(tree, "root-child", { name: "after", active: true });
    expect(getNodeByUniqueId(tree, "root-child")).toMatchObject({ name: "after", active: true });
    expect(getNodeByUniqueId(tree, "missing")).toEqual([]);
  });

  it("builds a flat-list hierarchy while treating numeric and string IDs consistently", () => {
    type FlatNode = {
      id: number;
      parentId: number | string | null;
      name: string;
      children?: FlatNode[];
    };
    const rows: FlatNode[] = [
      { id: 1, parentId: null, name: "root" },
      { id: 2, parentId: "1", name: "child" }
    ];
    const result = handleTree(rows);
    expect(result).toHaveLength(1);
    expect(result[0]?.children).toEqual([rows[1]]);
  });

  it("extracts unique IDs from the current tree level", () => {
    expect(
      extractPathList([{ uniqueId: 1, children: [{ uniqueId: 2 }] }, { uniqueId: "three" }])
    ).toEqual([1, "three"]);
  });
});
