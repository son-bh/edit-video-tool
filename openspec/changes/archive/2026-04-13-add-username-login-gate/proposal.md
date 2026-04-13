## Why

The web UI is currently open to anyone who can reach the server, and all uploaded or generated files share the same workspace. A lightweight login gate is needed now so each user must identify themselves before using the UI and so job data can be separated by username.

## What Changes

- Add a login page in front of the media workflow UI with a fixed username list and shared password validation.
- Add server-side session handling, logout support, and route protection for the main page and processing APIs.
- Scope uploaded files, generated outputs, and job workspaces under the authenticated username instead of a single shared workspace.
- Show clear authentication errors for invalid username or password attempts.
- Update the existing web UI flow and tests to account for authenticated access and username-isolated storage.

## Capabilities

### New Capabilities
- `web-ui-access-control`: Lightweight session-based login, logout, username selection, and access protection for the browser UI and related APIs.

### Modified Capabilities
- `media-workflow-web-ui`: Require authenticated access to the existing media workflow routes and store per-user job data in username-scoped workspace paths.

## Impact

- Affected code: `src/web/` routes, middleware, workspace/job management, and templates.
- Affected behavior: browser access, upload/download flows, and job storage layout.
- Dependencies: likely one session middleware package if the current stack does not already provide one.
- Tests and docs: web UI tests, route validation coverage, and setup/usage documentation.
