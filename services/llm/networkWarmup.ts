const warmedOrigins = new Set<string>();

export function warmModelConnection(baseUrl: string) {
  if (typeof document === 'undefined') return;
  try {
    const origin = new URL(baseUrl.trim()).origin;
    if (warmedOrigins.has(origin)) return;
    warmedOrigins.add(origin);
    const dnsPrefetch = document.createElement('link');
    dnsPrefetch.rel = 'dns-prefetch';
    dnsPrefetch.href = origin;
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = origin;
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(dnsPrefetch);
    document.head.appendChild(preconnect);
  } catch {
    // Invalid URLs are reported by the normal model request and settings validation.
  }
}
