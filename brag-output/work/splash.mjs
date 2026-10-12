import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 2732, height: 2732, deviceScaleFactor: 1 });
await p.setContent(`<html><body style="margin:0;background:#07070b;display:grid;place-items:center;height:2732px">
<svg viewBox="0 0 40 40" width="360" height="360"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b8b"/><stop offset=".25" stop-color="#ffd36b"/><stop offset=".5" stop-color="#6dffb8"/><stop offset=".75" stop-color="#5cc8ff"/><stop offset="1" stop-color="#a77bff"/></linearGradient><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient></defs>
<path d="M2 21.5 15 19.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/><path d="M25 18.5 39 11v18z" fill="url(#s)" opacity=".9"/><path d="M20 6 30.5 27H9.5z" fill="none" stroke="url(#g)" stroke-width="2.2" stroke-linejoin="round"/></svg></body></html>`);
await p.screenshot({ path: out });
await b.close();
