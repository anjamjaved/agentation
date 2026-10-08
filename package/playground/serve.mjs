// Dev-only playground: serves pages that mount <Agentation /> straight from src
// with live reload. Not published (package.json "files" only ships dist).
//
//   node package/playground/serve.mjs   →  http://localhost:4300  (PORT=… to change)
import * as esbuild from "esbuild";
import * as sass from "sass";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4300;

// Mirrors the tsup plugin: modules export class names plus the raw css string
// the toolbar injects into its shadow root.
const scssModules = {
  name: "scss-modules",
  setup(build) {
    build.onLoad({ filter: /\.scss$/ }, async (args) => {
      const { css: compiled } = sass.compile(args.path);
      if (!args.path.includes(".module.")) {
        return { contents: `export const css = ${JSON.stringify(compiled)};`, loader: "js" };
      }
      let classNames = {};
      const { css } = await postcss([
        postcssModules({
          getJSON(_, json) {
            classNames = json;
          },
          generateScopedName: "[name]__[local]___[hash:base64:5]",
        }),
      ]).process(compiled, { from: args.path });
      return {
        contents: `export const css = ${JSON.stringify(css)};\nexport default ${JSON.stringify(classNames)};`,
        loader: "js",
      };
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [path.join(here, "main.tsx")],
  outdir: path.join(here, "out"),
  bundle: true,
  format: "esm",
  sourcemap: true,
  jsx: "automatic",
  write: false,
  plugins: [scssModules],
  define: {
    __VERSION__: JSON.stringify("playground"),
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  logLevel: "info",
});

await ctx.watch();
await ctx.serve({ servedir: here, port });
console.log(`\n  Agentation playground → http://localhost:${port}\n`);
