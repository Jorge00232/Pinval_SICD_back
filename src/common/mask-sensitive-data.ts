export function maskRut(value?: string | null) {
  const rut = value?.trim();

  if (!rut) {
    return null;
  }

  const cleanRut = rut.replace(/\s/g, '');
  const [rawBody, verifier] = cleanRut.split('-');

  if (rawBody && verifier) {
    const body = rawBody.replace(/\./g, '');
    const visibleBody = body.slice(-3);

    return `••.•••.${visibleBody}-${verifier}`;
  }

  if (cleanRut.length <= 4) {
    return '••••';
  }

  return `••••${cleanRut.slice(-4)}`;
}

export function restrictedValue() {
  return 'Restringido';
}

export function canSeeSensitiveData(role?: string | null) {
  return role === 'ADMIN' || role === 'STOCK';
}
