import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import type { AuthSession } from '../../types';

export const DEFAULT_ALLOWED_USERNAMES = [
  'Logan',
  'Sang',
  'Nhi',
  'An',
  'Nguyen',
  'Tai',
  'Hien',
  'Phuong',
  'Ha',
  'Trang',
  'Den',
  'Son',
  'Hau',
  'Bao'
];
export const DEFAULT_SHARED_PASSWORD = 'Waebox2026@';
export const DEFAULT_SESSION_SECRET = 'change-me-before-public-deploy';
export const DEFAULT_COOKIE_NAME = 'media_workflow_session';
export const DEFAULT_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export interface AllowedUser {
  username: string;
  workspaceKey: string;
}

export interface AuthConfig {
  allowedUsernames: string[];
  sharedPassword: string;
  sessionSecret: string;
  cookieName: string;
  sessionMaxAgeMs: number;
  allowlist: Map<string, AllowedUser>;
}

export interface AuthConfigOptions {
  allowedUsernames?: string[] | string;
  sharedPassword?: string;
  sessionSecret?: string;
  cookieName?: string;
  sessionMaxAgeMs?: number | string;
}

export interface AuthManager {
  config: AuthConfig;
  authenticate(username: string, password: string): AllowedUser | null;
  attachSession(request: Request, response: Response, next: NextFunction): void;
  createSession(allowedUser: AllowedUser): AuthSession;
  destroySession(request: Request, response: Response): void;
  getAllowedUser(username: string): AllowedUser | null;
  getSessionFromRequest(request: Request): AuthSession | null;
  requireApiAuth(request: Request, response: Response, next: NextFunction): void;
  requirePageAuth(request: Request, response: Response, next: NextFunction): void;
  setSessionCookie(response: Response, session: AuthSession): void;
}

function normalizeAllowedUsernames(value?: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return DEFAULT_ALLOWED_USERNAMES.slice();
}

export function slugifyUsername(username: string): string {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function createAuthConfig(options: AuthConfigOptions = {}): AuthConfig {
  const allowedUsernames = normalizeAllowedUsernames(
    options.allowedUsernames || process.env.WEB_UI_ALLOWED_USERNAMES
  );
  const sharedPassword = String(
    options.sharedPassword || process.env.WEB_UI_SHARED_PASSWORD || DEFAULT_SHARED_PASSWORD
  );
  const sessionSecret = String(
    options.sessionSecret || process.env.WEB_UI_SESSION_SECRET || DEFAULT_SESSION_SECRET
  );
  const cookieName = String(
    options.cookieName || process.env.WEB_UI_SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME
  );
  const sessionMaxAgeMs = Number(
    options.sessionMaxAgeMs || process.env.WEB_UI_SESSION_MAX_AGE_MS || DEFAULT_SESSION_MAX_AGE_MS
  );

  const allowlist = new Map<string, AllowedUser>();

  for (const username of allowedUsernames) {
    allowlist.set(username.toLowerCase(), {
      username,
      workspaceKey: slugifyUsername(username)
    });
  }

  return {
    allowedUsernames,
    sharedPassword,
    sessionSecret,
    cookieName,
    sessionMaxAgeMs,
    allowlist
  };
}

export function createAuthManager(config: AuthConfig = createAuthConfig()): AuthManager {
  const sessions = new Map<string, AuthSession>();

  function signSessionId(sessionId: string): string {
    return createHmac('sha256', config.sessionSecret).update(sessionId).digest('base64url');
  }

  function serializeCookie(sessionId: string): string {
    return `${sessionId}.${signSessionId(sessionId)}`;
  }

  function parseCookies(cookieHeader?: string): Record<string, string> {
    const cookies: Record<string, string> = {};

    for (const part of String(cookieHeader || '').split(';')) {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex === -1) {
        continue;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();

      if (key) {
        cookies[key] = value;
      }
    }

    return cookies;
  }

  function verifyCookieValue(value?: string): string | null {
    if (!value) {
      return null;
    }

    const separatorIndex = value.lastIndexOf('.');

    if (separatorIndex === -1) {
      return null;
    }

    const sessionId = value.slice(0, separatorIndex);
    const providedSignature = value.slice(separatorIndex + 1);
    const expectedSignature = signSessionId(sessionId);
    const providedBuffer = Buffer.from(providedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return null;
    }

    return sessionId;
  }

  function getAllowedUser(username: string): AllowedUser | null {
    return config.allowlist.get(String(username || '').trim().toLowerCase()) || null;
  }

  function authenticate(username: string, password: string): AllowedUser | null {
    const allowedUser = getAllowedUser(username);

    if (!allowedUser || password !== config.sharedPassword) {
      return null;
    }

    return allowedUser;
  }

  function createSession(allowedUser: AllowedUser): AuthSession {
    const sessionId = randomUUID();
    const session: AuthSession = {
      id: sessionId,
      username: allowedUser.username,
      workspaceKey: allowedUser.workspaceKey,
      createdAt: new Date().toISOString()
    };

    sessions.set(sessionId, session);
    return session;
  }

  function getSessionFromRequest(request: Request): AuthSession | null {
    const cookies = parseCookies(request.headers.cookie);
    const signedValue = cookies[config.cookieName];
    const sessionId = verifyCookieValue(signedValue);

    if (!sessionId) {
      return null;
    }

    return sessions.get(sessionId) || null;
  }

  function attachSession(request: Request, _response: Response, next: NextFunction): void {
    request.auth = getSessionFromRequest(request);
    next();
  }

  function setSessionCookie(response: Response, session: AuthSession): void {
    response.setHeader(
      'Set-Cookie',
      `${config.cookieName}=${serializeCookie(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(
        1,
        Math.floor(config.sessionMaxAgeMs / 1000)
      )}`
    );
  }

  function clearSessionCookie(response: Response): void {
    response.setHeader(
      'Set-Cookie',
      `${config.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
  }

  function destroySession(request: Request, response: Response): void {
    const session = request.auth || getSessionFromRequest(request);

    if (session) {
      sessions.delete(session.id);
    }

    request.auth = null;
    clearSessionCookie(response);
  }

  function requirePageAuth(request: Request, response: Response, next: NextFunction): void {
    if (request.auth) {
      next();
      return;
    }

    response.redirect('/login');
  }

  function requireApiAuth(request: Request, response: Response, next: NextFunction): void {
    if (request.auth) {
      next();
      return;
    }

    response.status(401).json({
      error: 'Authentication required.'
    });
  }

  return {
    config,
    authenticate,
    attachSession,
    createSession,
    destroySession,
    getAllowedUser,
    getSessionFromRequest,
    requireApiAuth,
    requirePageAuth,
    setSessionCookie
  };
}
