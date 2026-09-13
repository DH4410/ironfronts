export const CLOUDFLARE_SAFE_FILE_BYTES: number;
export function splitCloudflareWorld(worldDirectory: string, chunkSize?: number): Promise<Record<string, { size: number; files: string[] }>>;