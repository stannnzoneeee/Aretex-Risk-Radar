const DEFAULT_PYTHON_API_URL = "http://localhost:8000";

export function getPythonApiUrl(): string {
  const rawUrl = (process.env.NEXT_PUBLIC_PYTHON_API_URL || DEFAULT_PYTHON_API_URL).trim();

  if (!rawUrl) {
    return DEFAULT_PYTHON_API_URL;
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  if (rawUrl.startsWith("localhost") || rawUrl.startsWith("127.0.0.1")) {
    return `http://${rawUrl}`;
  }

  return `https://${rawUrl}`;
}

export function buildPythonApiUrl(endpointPath: string): string | null {
  try {
    const normalizedPath = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
    return new URL(normalizedPath, getPythonApiUrl()).toString();
  } catch (error) {
    console.error("Invalid Python API URL configuration:", error);
    return null;
  }
}
