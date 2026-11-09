import { authenticate } from './auth.js';
export function route(token: string) { return authenticate(token); }

