import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "pages-dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "data"), { recursive: true });
await cp(path.join(root, "site", "index.html"), path.join(outputDir, "index.html"));
await cp(path.join(root, "site", "app.js"), path.join(outputDir, "app.js"));
await cp(path.join(root, "site", "styles.css"), path.join(outputDir, "styles.css"));
await cp(path.join(root, "public", "favicon.svg"), path.join(outputDir, "favicon.svg"));
await cp(path.join(root, "public", "data", "offers.json"), path.join(outputDir, "data", "offers.json"));

console.log(`GitHub Pages build klar: ${outputDir}`);
