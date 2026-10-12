// Captures real PrismaStream UI states from the running dev server (http://localhost:5180).
// Writes PNGs to ./shots and click-target coordinates to ./shots/coords.json.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5180';
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const coords = {};

const browser = await puppeteer.launch({
	executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true,
	args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars']
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function go(path, ms = 2500) {
	await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 60000 });
	await page.evaluate(() => document.fonts.ready);
	await wait(ms);
}
const shot = (name) => page.screenshot({ path: OUT + name + '.png' });
/** Viewport rect of the first element matching sel whose text includes text. */
function rectOf(sel, text) {
	return page.evaluate(
		(sel, text) => {
			const n = [...document.querySelectorAll(sel)].find(
				(e) => !text || e.textContent?.replace(/\s+/g, ' ').trim().includes(text)
			);
			if (!n) return null;
			const r = n.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		},
		sel,
		text
	);
}
async function clickAt(r) {
	await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

// 1. Home hero (no interaction; first hero slide).
await go('/', 3000);
await page.mouse.move(1900, 1070);
await shot('home-hero');

// 2. Poster card via search, typed one character at a time (real UI typing).
const QUERY = 'Das Letzte Licht';
await go('/search', 1500);
await page.mouse.move(1900, 1070);
await shot('search-00');
const input = await page.waitForSelector('input');
for (let i = 1; i <= QUERY.length; i++) {
	await input.type(QUERY[i - 1]);
	await wait(i === QUERY.length ? 1400 : 260);
	await shot('search-' + String(i).padStart(2, '0'));
}
const card = await page.waitForSelector('a[href="/title/tmdb-m-910001"]');
await card.screenshot({ path: OUT + 'card.png' });

// 3. Detail page, versions panel in view; then pick another audio language.
await go('/title/tmdb-m-910001', 2500);
await page.mouse.move(1900, 1070);
await shot('detail-top');
await page.evaluate(() => {
	const s = document.querySelector('section.versions');
	const y = s.getBoundingClientRect().top + window.scrollY - 140;
	window.scrollTo(0, y);
});
await wait(1000);
await shot('detail-versions-a');
coords.versionsPanel = await rectOf('section.versions');
coords.chipTarget = await rectOf('section.versions [role="radio"]', 'Turks');
if (coords.chipTarget) {
	await clickAt(coords.chipTarget);
	await page.mouse.move(1900, 1070);
	await wait(900);
}
await shot('detail-versions-b');

// 4. Player: open "Taal en bron", click the English 4K version, keep playing.
await go('/watch/tmdb-m-910001', 6500);
await page.mouse.move(960, 600);
await wait(300);
await shot('player-plain');
coords.langButton = await rectOf('.player button', 'Taal en bron');
await clickAt(coords.langButton);
await wait(900);
coords.menuTarget = await page.evaluate(() => {
	// First option under the "Duits" group heading (same BBB test stream as the NL version).
	const panel = document.querySelector('.player [role="dialog"]');
	const nodes = [...panel.querySelectorAll('*')];
	const head = nodes.find((n) => n.children.length === 0 && n.textContent.trim().toLowerCase() === 'duits');
	if (!head) return null;
	const btn = nodes.slice(nodes.indexOf(head)).find((n) => n.tagName === 'BUTTON');
	btn.scrollIntoView({ block: 'center' });
	return true;
});
await wait(700);
coords.menuTarget = await page.evaluate(() => {
	const panel = document.querySelector('.player [role="dialog"]');
	const nodes = [...panel.querySelectorAll('*')];
	const head = nodes.find((n) => n.children.length === 0 && n.textContent.trim().toLowerCase() === 'duits');
	const btn = nodes.slice(nodes.indexOf(head)).find((n) => n.tagName === 'BUTTON');
	const r = btn.getBoundingClientRect();
	return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(1900, 1070);
await shot('player-menu');
if (coords.menuTarget) await clickAt(coords.menuTarget);
await wait(4500);
await page.mouse.move(980, 620);
await wait(300);
await shot('player-switched');
// Reopen the menu to show the new selection.
await clickAt(coords.langButton);
await wait(900);
await page.mouse.move(1900, 1070);
await shot('player-menu-after');

// 5. Live TV guide.
await go('/live', 3500);
await page.mouse.move(1900, 1070);
await shot('live');

writeFileSync(OUT + 'coords.json', JSON.stringify(coords, null, 1));
await browser.close();
console.log(JSON.stringify(coords));
