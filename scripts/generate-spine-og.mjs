import { readFile } from "node:fs/promises";
import sharp from "sharp";

const width = 1200;
const height = 630;

const background = await sharp("scripts/assets/spine-og-background.png")
  .resize(width, height, { fit: "cover", position: "centre" })
  .png()
  .toBuffer();

const logo = await sharp(await readFile("app/icon.svg"))
  .resize(58, 58, { fit: "contain" })
  .png()
  .toBuffer();

const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="shade"><stop offset="0" stop-color="#050b1c" stop-opacity="0.78"/><stop offset="0.55" stop-color="#050b1c" stop-opacity="0.22"/><stop offset="1" stop-color="#050b1c" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#shade)"/>
  <text x="146" y="112" fill="#ffffff" font-family="Arial, sans-serif" font-size="39" font-weight="700" letter-spacing="-1.4">Spine</text>
  <text x="80" y="270" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="700" letter-spacing="-2.5">The backbone of</text>
  <text x="80" y="348" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="700" letter-spacing="-2.5">your business.</text>
  <rect x="80" y="386" width="75" height="5" rx="2.5" fill="#8365ff"/>
  <text x="80" y="448" fill="#c8d1e7" font-family="Arial, sans-serif" font-size="27" font-weight="400">Sales. Marketing. Profit. One clear view.</text>
  <text x="80" y="566" fill="#9faed0" font-family="Arial, sans-serif" font-size="19" letter-spacing="1.5">SPINE</text>
</svg>`);

await sharp(background)
  .composite([
    { input: overlay, left: 0, top: 0 },
    { input: logo, left: 77, top: 68 },
  ])
  .png({ compressionLevel: 9 })
  .toFile("app/opengraph-image.png");
