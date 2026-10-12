import puppeteer from 'puppeteer-core';
const CODE = process.env.INVITE;
const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `probe-${Date.now()}@example.invalid`;
const pw = 'Probe-' + Math.random().toString(36).slice(2) + '-Xy9!';
const log = [];
async function session(label, fn) {
	const browser = await puppeteer.launch({ executablePath: exe, headless: true });
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 900 });
	page.on('console', (m) => log.push(`[${label}] console.${m.type()}: ${m.text().slice(0, 300)}`));
	page.on('pageerror', (e) => log.push(`[${label}] pageerror: ${e.message}`));
	page.on('requestfailed', (r) => log.push(`[${label}] FAILED ${r.method()} ${r.url().replace(/\?.*/, '')} ${r.failure()?.errorText}`));
	page.on('response', (r) => { if (r.url().includes('backend.') && !/\/v1\/(docs|events)/.test(r.url())) log.push(`[${label}] ${r.status()} ${r.request().method()} ${r.url().replace('https://backend.prismastream.patrickudo.nl', '').replace(/\?.*/, '')}`); });
	await fn(page);
	await browser.close();
}
const fill = async (page, tab, code) => {
	await page.goto('https://prismastream.patrickudo.nl/settings/sync', { waitUntil: 'networkidle2' });
	await wait(1500);
	await page.evaluate((re) => [...document.querySelectorAll('[role=tab]')].find((b) => new RegExp(re, 'i').test(b.textContent))?.click(), tab);
	await wait(400);
	await page.type('#acc-email', email);
	await page.type('#acc-pass', pw);
	if (code) { await page.type('#acc-pass2', pw); await page.type('#acc-code', code); }
	await page.evaluate(() => document.querySelector('form.form button[type=submit]')?.click());
	await wait(10000);
};
await session('A-register', async (page) => { await fill(page, 'aanmaken', CODE); log.push('[A] url ' + page.url()); });
await session('B-login', async (page) => {
	await fill(page, '^\\s*inloggen\\s*$');
	log.push('[B] na login: ' + (await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 160).replace(/\s+/g, ' '))));
	await page.goto('https://prismastream.patrickudo.nl/settings/sources', { waitUntil: 'networkidle2' });
	await wait(5000);
	log.push('[B] bronnen: ' + (await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 400).replace(/\s+/g, ' '))));
	log.push('[B] onLine=' + (await page.evaluate(() => navigator.onLine)));
});
console.log(log.filter((l) => !/console\.(log|debug|info)/.test(l)).join('\n'));
console.log('EMAIL=' + email);
