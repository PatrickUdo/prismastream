// Text folding for search: case-, diacritic- and punctuation-insensitive comparison.

const SPECIAL_LETTERS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ø: 'o',
	ł: 'l',
	đ: 'd',
	ð: 'd',
	ı: 'i',
	þ: 'th',
	ħ: 'h'
};

/** Lowercase, strip diacritics and punctuation, collapse whitespace. "&" becomes "and". */
export function fold(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[ßæœøłđðıþħ]/g, (c) => SPECIAL_LETTERS[c] ?? c)
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** Folded words of `s`. */
export function tokenize(s: string): string[] {
	const f = fold(s);
	return f ? f.split(' ') : [];
}

/**
 * Words for indexing: the folded words plus joined forms for words glued by hyphens or
 * apostrophes ("Spider-Man" also yields "spiderman", "Ocean's" also "oceans").
 */
export function indexTokens(s: string): string[] {
	const out = tokenize(s);
	if (/[-'’`´ʼ.]/.test(s)) {
		for (const w of tokenize(s.replace(/[-'’`´ʼ.]/g, ''))) if (!out.includes(w)) out.push(w);
	}
	return out;
}
