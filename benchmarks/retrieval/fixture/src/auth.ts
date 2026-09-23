import { findUser } from './users.js';
export function authenticate(token: string) { return token.length > 0 ? findUser(token) : null; }

