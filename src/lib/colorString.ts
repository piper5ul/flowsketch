const CSS_NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?%?';
const CSS_NUMBER_RE = new RegExp(`^${CSS_NUMBER}$`);

/** A CSS colour from the narrow set diagram data is allowed to carry. */
export function sanitizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
  if (value.toLowerCase() === 'transparent') return value;

  const match = /^(rgb|rgba)\((.*)\)$/i.exec(value);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  const body = match[2];
  const slashParts = body.split('/');
  if (slashParts.length > 2) return undefined;

  if (slashParts.length === 1 && body.includes(',')) {
    const commaParts = body.split(',').map((part) => part.trim());
    const arity = name === 'rgba' ? 4 : 3;
    return commaParts.length === arity && commaParts.every((part) => CSS_NUMBER_RE.test(part))
      ? value
      : undefined;
  }

  const channelText = slashParts[0].trim();
  const channels = channelText.includes(',')
    ? channelText.split(',').map((part) => part.trim())
    : channelText.split(/\s+/);
  const alpha = slashParts[1]?.trim();
  if (channels.length !== 3 || channels.some((part) => !CSS_NUMBER_RE.test(part))) return undefined;
  if (alpha !== undefined && !CSS_NUMBER_RE.test(alpha)) return undefined;
  if (slashParts.length === 2) return value;
  return name === 'rgb' ? value : undefined;
}
