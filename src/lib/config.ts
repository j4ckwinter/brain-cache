import { homedir } from 'node:os';
import { join } from 'node:path';

export const GLOBAL_CONFIG_DIR = join(homedir(), '.brain-cache');
export const PROFILE_PATH = join(GLOBAL_CONFIG_DIR, 'profile.json');
export const CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');
export const PROJECT_DATA_DIR = '.brain-cache';
