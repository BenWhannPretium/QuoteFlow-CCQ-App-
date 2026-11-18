/**
 * The caller's address without a port.
 *
 * In production `req.ip` is the last `X-Forwarded-For` entry, the one the Azure App Service front end
 * appends (`trustProxy` in app.ts). That entry can carry the caller's source port (`203.0.113.9:51234`,
 * `[2001:db8::1]:51234`), which changes with every connection: used as it is, each connection got its
 * own rate-limit budget (so the per-address limits on public routes and rejected sign-ins limited
 * nothing) and audit rows stored `address:port`. A bare IPv6 address has colons of its own and is left
 * alone.
 */
export function withoutPort(address: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed?.[1]) return bracketed[1];
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(address);
  return v4?.[1] ?? address;
}

export const clientIp = (req: { ip: string }): string => withoutPort(req.ip);
