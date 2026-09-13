export const DEBUG_USERNAME = 'DimaTest1';

/** Account policy for the signed game-ticket entitlement. */
export function isDebugEntitledUsername(username: string): boolean {
  return username.trim().toLocaleLowerCase('en-US')
    === DEBUG_USERNAME.toLocaleLowerCase('en-US');
}
