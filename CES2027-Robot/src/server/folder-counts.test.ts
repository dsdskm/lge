import assert from "node:assert/strict";
import { test } from "node:test";

import { countFilesInSubtree } from "./folder-counts";

test("counts direct files and files in every descendant folder", () => {
    const folders = [
        { id: "grandchild", parentId: "child" },
        { id: "other", parentId: null },
        { id: "root", parentId: null },
        { id: "child", parentId: "root" },
    ];
    const files = [
        { folderId: "root" },
        { folderId: "child" },
        { folderId: "grandchild" },
        { folderId: "grandchild" },
        { folderId: "other" },
    ];
    assert.deepEqual(countFilesInSubtree(folders, files), new Map([
        ["grandchild", 2], ["other", 1], ["root", 4], ["child", 3],
    ]));
});