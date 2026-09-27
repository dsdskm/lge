import assert from "node:assert/strict";
import { test } from "node:test";

import { orderFolderTree } from "./folder-order";

test("sorts roots and each parent's children without flattening the tree", () => {
    const folders = [
        { id: "child-b", parentId: "root-b", name: "Zebra", count: 0 },
        { id: "root-b", name: "scenario", count: 0 },
        { id: "grandchild", parentId: "child-a", name: "inside", count: 0 },
        { id: "root-a", name: "media", count: 0 },
        { id: "child-a", parentId: "root-b", name: "Alpha", count: 0 },
        { id: "child-m", parentId: "root-a", name: "Videos", count: 0 },
    ];
    assert.deepEqual(orderFolderTree(folders).map(({ folder, depth }) => [folder.id, depth]), [
        ["root-a", 0], ["child-m", 1], ["root-b", 0], ["child-a", 1], ["grandchild", 2], ["child-b", 1],
    ]);
});