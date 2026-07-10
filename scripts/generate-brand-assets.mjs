import { readFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile("public/brand/creatorx-icon.svg");

for (const size of [32, 180, 192, 512, 1024]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(`public/brand/creatorx-icon-${size}.png`);
}
