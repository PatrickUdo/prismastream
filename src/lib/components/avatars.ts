// Avatar presets for profiles (Profile.avatar). Rendered by Avatar.svelte.
import { t } from '#lib/i18n/index.svelte.ts';

export const AVATAR_PRESETS = [
	'aurora',
	'ember',
	'tide',
	'moss',
	'nova',
	'dusk',
	'koi',
	'pixel'
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export const DEFAULT_AVATAR: AvatarPreset = 'aurora';

export function isAvatarPreset(id: string): id is AvatarPreset {
	return (AVATAR_PRESETS as readonly string[]).includes(id);
}

/** Localised display name of a preset ("Aurora", "Gloed", ...). */
export function avatarLabel(id: string): string {
	return isAvatarPreset(id) ? t(`ui.avatar.${id}`) : id;
}
