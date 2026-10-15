export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env or export it.');
    process.exit(1);
  }
  return url;
}

export function redactUrl(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = '***';
  return u.toString();
}
