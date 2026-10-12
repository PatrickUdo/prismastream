import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = [];
for (const [w, h] of [[1440, 900], [390, 844]]) {
	const p = await b.newPage();
	await p.setViewport({ width: w, height: h });
	const errs = [];
	p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
	p.on('pageerror', (e) => errs.push(e.message));
	for (const path of ['/', '/title/tmdb-m-1', '/live', '/settings/sources']) {
		await p.goto('https://prismastream.patrickudo.nl' + path, { waitUntil: 'networkidle2' });
		await new Promise((r) => setTimeout(r, 1200));
		const r = await p.evaluate(() => ({ url: location.pathname + location.search, sw: document.documentElement.scrollWidth, iw: innerWidth, text: document.body.innerText.slice(0, 90).replace(/\s+/g, ' ') }));
		out.push(`${w}px ${path} -> ${r.url} ${r.sw === r.iw ? 'breedte-ok' : 'OVERFLOW ' + r.sw}`);
	}
	await p.screenshot({ path: `welcome-${w}.png` });
	out.push(`${w}px console-errors: ${errs.length}${errs.length ? ' ' + errs.join(' | ') : ''}`);
}
console.log(out.join('\n'));
await b.close();
