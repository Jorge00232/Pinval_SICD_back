export function toDisplayProductName(rawName?: string | null) {
  if (!rawName) {
    return '';
  }

  const cleaned = rawName
    .replace(/_/g, ' ')
    .replace(/\*/g, ' x')
    .replace(/\//g, ' / ')
    .replace(/\./g, ' ')
    .replace(/\b(\d+)\s*CC\b/gi, '$1 cc')
    .replace(/\b(\d+)\s*ML\b/gi, '$1 ml')
    .replace(/\b(\d+)\s*LT\b/gi, '$1 L')
    .replace(/\b(\d+)\s*LTS\b/gi, '$1 L')
    .replace(/\b(\d+)\s*L\b/gi, '$1 L')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bCc\b/g, 'cc')
    .replace(/\bMl\b/g, 'ml')
    .replace(/\bL\b/g, 'L')
    .replace(/\bX\s*(\d+)/g, 'x$1')
    .replace(/\s+\/\s+/g, ' / ');
}

export function toSearchProductName(rawName?: string | null) {
  return toDisplayProductName(rawName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}