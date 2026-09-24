import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const jobs = [
  { src: "icon-source.svg", out: "icon-192.png", size: 192 },
  { src: "icon-source.svg", out: "icon-512.png", size: 512 },
  { src: "icon-source.svg", out: "apple-touch-icon.png", size: 180, flatten: true },
  { src: "icon-source-maskable.svg", out: "maskable-512.png", size: 512 },
];

for (const job of jobs) {
  const input = path.join(dir, job.src);
  const output = path.join(outDir, job.out);
  let img = sharp(input, { density: 384 }).resize(job.size, job.size);
  if (job.flatten) img = img.flatten({ background: "#0f1a13" });
  await img.png().toFile(output);
  console.log("wrote", output);
}
