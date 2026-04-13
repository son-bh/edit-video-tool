## Context

The current web UI serves the main workflow page directly and stores uploaded and generated artifacts under a shared workspace root. That is acceptable for a single local operator, but it is too loose for a shared server because any user who can reach the app can start jobs and all outputs land in one namespace. The change needs to add controlled browser access without turning the project into a full authentication system.

The existing code already centralizes the web flow under `src/web/app.js`, uses server-rendered templates, and resolves job workspaces through helper modules. That makes this a cross-cutting but contained change: login affects page routing, API protection, and workspace path construction.

## Goals / Non-Goals

**Goals:**
- Require users to authenticate before reaching the main workflow page or media APIs.
- Let users authenticate by choosing a configured username and entering the shared password.
- Keep job inputs and outputs isolated under username-scoped workspace paths.
- Preserve the current media workflow behavior after authentication succeeds.
- Keep deployment simple for the current single-server model.

**Non-Goals:**
- Per-user passwords, password reset, registration, or external identity providers.
- Fine-grained permissions between different workflow actions.
- Multi-node session coordination or durable background job recovery across process restarts.
- Encrypting existing local job artifacts at rest.

## Decisions

### Use server-side session middleware for authentication state

The application will add a lightweight session layer so authentication is enforced on the server, not just in the browser. A signed cookie plus server-side session state is the smallest maintainable option in the current Express app and avoids pushing credential checks into every form submission.

Alternatives considered:
- Client-only localStorage flag: rejected because protected routes and downloads would still be callable directly.
- Custom cookie signing without middleware: rejected because it adds low-value security and lifecycle code that standard session middleware already handles.

### Store allowed usernames and shared password in a dedicated config module

The fixed username list and shared password should be resolved from one configuration path instead of being scattered through templates and route handlers. A small config module can expose defaults, while still allowing `.env` overrides later if needed.

Alternatives considered:
- Hard-code values directly in route handlers: rejected because it couples auth checks to UI rendering and makes tests harder to maintain.
- Put the username list only in `.env`: rejected because the initial requirement already provides a stable list and the code should remain readable if `.env` is absent.

### Protect both page routes and processing APIs with shared middleware

The main page, job creation routes, progress routes, and download routes will all pass through one authentication guard. The guard will redirect browser page requests to the login page and reject unauthenticated API requests with a clear error status.

Alternatives considered:
- Protect only the main page: rejected because upload and download endpoints would still be callable directly.
- Duplicate auth checks inline per route: rejected because the behavior would drift and tests would become repetitive.

### Scope workspaces by username at the root path

The authenticated username should be a first-class input to workspace creation and job lookup. The workspace root will become `<workspace-root>/<username>/...` so each user gets an isolated job tree while preserving the existing per-job folder structure under that subtree.

Alternatives considered:
- Prefix job IDs with username only: rejected because the filesystem still remains effectively shared and cleanup becomes less clear.
- Separate storage only at download time: rejected because uploads and intermediate outputs would still mix.

### Keep job ownership checks aligned with workspace scope

Once jobs are stored beneath a username-specific root, job access should only resolve within the authenticated user’s namespace. That prevents a user from guessing another job ID and reading its status or downloads.

Alternatives considered:
- Global job registry with username checks layered on top: rejected because the current local-disk model is simpler if ownership is implied by directory structure.

## Risks / Trade-offs

- [Shared password is weak access control] -> Accept for current controlled environment and document that it is not intended as internet-grade authentication.
- [Session storage defaults may be memory-backed] -> Accept for the current single-node deployment and keep the design compatible with upgrading the session store later.
- [Username becomes part of on-disk paths] -> Sanitize usernames through a fixed allowlist and never trust arbitrary user input as a directory name.
- [Existing jobs in the old shared workspace will not automatically move] -> Treat existing shared jobs as legacy data and store all new jobs under username roots.

## Migration Plan

1. Add auth configuration, login/logout routes, and session middleware.
2. Add authentication guards to the main page and API/download routes.
3. Update workspace helpers and job lookups to require the authenticated username.
4. Update templates to render the login page and logout action.
5. Update tests for authentication, route protection, and username-scoped storage.
6. Document the new login flow and any required session secret configuration.

Rollback is straightforward: remove the auth middleware and revert workspace scoping to the shared root. Existing username-scoped job folders can remain on disk without affecting rollback safety.

## Open Questions

- Whether the shared password should remain code-configured or be required from `.env` before deployment.
- Whether the login page should remember the last selected username in the browser for convenience.
- Whether legacy shared-workspace jobs need a visible migration path in the UI, or whether new jobs only are sufficient.
