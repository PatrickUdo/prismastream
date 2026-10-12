import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'nl.tuwi.prismastream',
	appName: 'PrismaStream',
	webDir: 'build',
	// Matches --bg so there is no white flash while the WebView boots.
	backgroundColor: '#07070b',
	android: {
		// The WebView runs on https://localhost; many IPTV streams are plain http.
		// Needed for <video src="http://…"> and hls.js requests to http servers.
		allowMixedContent: true
	},
	plugins: {
		// Do NOT patch window.fetch / XMLHttpRequest globally: hls.js segment traffic
		// would then go through the native bridge (base64, slow, heavy for 4K).
		// Provider requests (Xtream API, M3U, XMLTV) call CapacitorHttp.request()
		// explicitly in src/lib/providers/http.ts; the player falls back to native
		// itself only on CORS errors. Cleartext http is allowed via ATS (Info.plist)
		// and android/app/src/main/res/xml/network_security_config.xml.
		CapacitorHttp: {
			enabled: false
		}
	}
};

export default config;
