function asReadableCert(cert: string): string {
  const startCert = cert.indexOf('-----BEGIN CERTIFICATE-----') + 27;
  const endCert = cert.indexOf('-----END CERTIFICATE-----');
  const contextLength = 30;
  const excerpt = `${cert.substring(startCert, startCert + contextLength)}...${cert.substring(endCert - contextLength, endCert - 1)}`;
  return normalizeNewlines(excerpt);
}

function normalizeNewlines(excerpt: string): string {
  return excerpt.replace(/\s/g, '');
}

export { asReadableCert, normalizeNewlines };
