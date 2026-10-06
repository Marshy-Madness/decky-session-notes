// Builds the official Scrolls: scrolls/<id>/scroll.json (+ index.tsx for code Scrolls) → workshop/scrolls/<id>.json.
// The Workshop publishes and signs those when it starts. Run: node scrolls/build.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { rollup } from "rollup";

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(join(here, "..")); // the TypeScript plugin matches files relative to the working directory
const root = join(here, "..");
// The rollup plugins come with @decky/rollup (pnpm keeps them out of the top-level node_modules).
const req = createRequire(realpathSync(join(root, "node_modules/@decky/rollup/src/index.js")));
const load = async (name) => (await import(pathToFileURL(req.resolve(name)).href)).default;
const [typescript, commonjs, nodeResolve, replace, externalGlobals] = await Promise.all(
  ["@rollup/plugin-typescript", "@rollup/plugin-commonjs", "@rollup/plugin-node-resolve", "@rollup/plugin-replace", "rollup-plugin-external-globals"].map(load)
);
const { nodeResolve: resolveFn } = await import(pathToFileURL(req.resolve("@rollup/plugin-node-resolve")).href);

const out = join(root, "workshop/scrolls");
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);

for (const id of readdirSync(here)) {
  const manifestPath = join(here, id, "scroll.json");
  if (!existsSync(manifestPath) || (only.length && !only.includes(id))) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const scroll = { format: 1, id, ...manifest };
  const entry = join(here, id, "index.tsx");
  if (existsSync(entry)) {
    const bundle = await rollup({
      input: entry,
      plugins: [
        typescript({ tsconfig: join(here, "tsconfig.json"), include: ["scrolls/**/*.tsx", "src/**/*.ts", "src/**/*.tsx"], noEmitOnError: true }),
        commonjs(),
        (resolveFn ?? nodeResolve)({ browser: true }),
        // Steam's React and Decky's UI, the same globals every Decky plugin uses.
        externalGlobals({ react: "SP_REACT", "react/jsx-runtime": "SP_JSX", "react-dom": "SP_REACTDOM", "@decky/ui": "DFL" }),
        replace({ preventAssignment: true, "process.env.NODE_ENV": JSON.stringify("production") }),
      ],
      external: ["react", "react/jsx-runtime", "react-dom", "@decky/ui"],
      treeshake: { preset: "smallest", pureExternalImports: { pure: ["@decky/ui"] } },
      onwarn: (w, warn) => (w.code === "THIS_IS_UNDEFINED" ? undefined : warn(w)),
    });
    const { output } = await bundle.generate({ format: "iife", name: "__scroll", exports: "default", compact: true });
    await bundle.close();
    scroll.kind = "code";
    scroll.code = output[0].code;
  } else {
    scroll.kind = "data";
  }
  writeFileSync(join(out, `${id}.json`), JSON.stringify(scroll, null, 1) + "\n");
  console.log(`${id} ${scroll.version} (${scroll.kind}${scroll.code ? `, ${Math.round(scroll.code.length / 1024)} KB of code` : ""})`);
}
