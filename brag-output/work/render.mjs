// node render.mjs stills 1.0 3.2 ...   -> stills/t-<time>.jpg
// node render.mjs frames               -> frames/00000.jpg … (30 fps)
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);
const FPS = 30;
const dir = new URL('./', import.meta.url).pathname;

const browser = await puppeteer.launch({
	executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true,
	args: ['--allow-file-access-from-files', '--hide-scrollbars', '--force-color-profile=srgb']
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto('file://' + dir + 'comp.html', { waitUntil: 'load' });
await page.evaluate(() => window.ready);

async function frameAt(t, path) {
	await page.evaluate((t) => window.render(t), t);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
	await page.screenshot({ path, type: 'jpeg', quality: 93 });
}

if (mode === 'stills') {
	mkdirSync(dir + 'stills', { recursive: true });
	for (const s of rest) await frameAt(+s, `${dir}stills/t-${(+s).toFixed(2)}.jpg`);
} else {
	rmSync(dir + 'frames', { recursive: true, force: true });
	mkdirSync(dir + 'frames', { recursive: true });
	const duration = await page.evaluate(() => window.DURATION);
	const n = Math.round(duration * FPS);
	for (let i = 0; i < n; i++) {
		await frameAt(i / FPS, `${dir}frames/${String(i).padStart(5, '0')}.jpg`);
		if (i % 60 === 0) console.log(`frame ${i}/${n}`);
	}
}
await browser.close();
console.log('done');
