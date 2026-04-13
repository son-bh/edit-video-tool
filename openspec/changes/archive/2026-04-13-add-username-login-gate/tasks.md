## 1. Authentication flow

- [x] 1.1 Add auth configuration for the allowed username list, shared password, and session secret handling.
- [x] 1.2 Implement login, logout, and session middleware in the Express web app.
- [x] 1.3 Add route guards so the main page redirects unauthenticated users and protected API routes return authentication errors.

## 2. Username-scoped media workspaces

- [x] 2.1 Update workspace and job helpers to resolve per-user roots and keep job access within the authenticated user's scope.
- [x] 2.2 Update subtitle, video, status, and download routes to use the authenticated username when creating or loading jobs.
- [x] 2.3 Preserve current media workflow behavior after auth by wiring username-scoped paths through the existing worker and archive flows.

## 3. UI, docs, and verification

- [x] 3.1 Add a login template and update the main UI to expose logout and any user-context display needed for clarity.
- [x] 3.2 Update documentation for login behavior, configuration, and username-scoped workspace layout.
- [x] 3.3 Add or update automated tests for valid login, invalid login, logout, protected routes, and per-user job isolation.
