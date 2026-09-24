/**
 * @type {import('tsup').Options}
 */
module.exports = {
  dts: true,
  minify: false,
  bundle: false,
  sourcemap: true,
  treeshake: true,
  splitting: true,
  clean: true,
  outDir: "dist",
  format: ["cjs", "esm"],
  entry: { "server/index": "src/server/index.ts" },
  tsconfig: "tsconfig.node.json",
};
