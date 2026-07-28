import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'facebook-banner.html');
const outPath = path.join(process.env.HOME, 'Downloads', 'taylor-marriott-facebook-banner.jpg');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1640, height: 624 },
  deviceScaleFactor: 3,
});

await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

await page.screenshot({
  path: outPath,
  type: 'jpeg',
  quality: 98,
  fullPage: false,
});

await browser.close();

const stats = fs.statSync(outPath);
console.log(`Saved: ${outPath}`);
console.log(`Dimensions: 1640×624 @3x (${Math.round(stats.size / 1024)} KB)`);
