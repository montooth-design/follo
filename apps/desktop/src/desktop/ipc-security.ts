export function isTrustedFrame(
  senderId: number,
  expectedId: number,
  frameUrl: string | undefined,
  trustedUrl: string,
  isMainFrame: boolean,
): boolean {
  return senderId === expectedId && isMainFrame && frameUrl === trustedUrl;
}
