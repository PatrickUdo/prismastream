// Pure keyboard / remote-control mapping.

export type PlayerAction =
	| 'toggle'
	| 'play'
	| 'pause'
	| 'back10'
	| 'fwd10'
	| 'volumeUp'
	| 'volumeDown'
	| 'channelUp'
	| 'channelDown'
	| 'fullscreen'
	| 'mute'
	| 'subtitles'
	| 'back';

/**
 * Map a KeyboardEvent.key to a player action. Arrow up/down mean volume for VOD and
 * zapping for live TV. Returns null for keys the player does not handle.
 */
export function keyAction(key: string, live: boolean): PlayerAction | null {
	switch (key) {
		case ' ':
		case 'Enter':
		case 'MediaPlayPause':
			return 'toggle';
		case 'MediaPlay':
			return 'play';
		case 'MediaPause':
		case 'MediaStop':
			return 'pause';
		case 'ArrowLeft':
		case 'MediaRewind':
			return 'back10';
		case 'ArrowRight':
		case 'MediaFastForward':
			return 'fwd10';
		case 'MediaTrackNext':
			return live ? 'channelUp' : null;
		case 'MediaTrackPrevious':
			return live ? 'channelDown' : null;
		case 'ArrowUp':
			return live ? 'channelUp' : 'volumeUp';
		case 'ArrowDown':
			return live ? 'channelDown' : 'volumeDown';
		case 'PageUp':
		case 'ChannelUp':
			return 'channelUp';
		case 'PageDown':
		case 'ChannelDown':
			return 'channelDown';
		case 'AudioVolumeUp':
			return 'volumeUp';
		case 'AudioVolumeDown':
			return 'volumeDown';
		case 'f':
		case 'F':
			return 'fullscreen';
		case 'm':
		case 'M':
		case 'AudioVolumeMute':
			return 'mute';
		case 'c':
		case 'C':
		case 'Subtitle':
			return 'subtitles';
		case 'Escape':
		case 'Backspace':
		case 'GoBack':
		case 'BrowserBack':
			return 'back';
		default:
			return null;
	}
}
