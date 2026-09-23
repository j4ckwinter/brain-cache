import { cacheConfig } from './config.js';
export function writeCache(key: string, value: string) { return { key, value, ttl: cacheConfig.ttl }; }

