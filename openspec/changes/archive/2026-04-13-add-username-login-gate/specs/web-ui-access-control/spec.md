## ADDED Requirements

### Requirement: User must authenticate before using the web UI
The system SHALL present a login page before the media workflow UI and SHALL require the user to select an allowed username and submit the configured shared password before access is granted.

#### Scenario: Valid login grants access
- **WHEN** the user selects a username from the configured allowlist and submits the correct password
- **THEN** the system creates authenticated session state for that username
- **THEN** the system redirects the user to the main workflow page

#### Scenario: Invalid username is rejected
- **WHEN** the user submits a username that is not in the configured allowlist
- **THEN** the system does not create a session
- **THEN** the system keeps the user on the login page with a clear authentication error

#### Scenario: Wrong password is rejected
- **WHEN** the user submits an allowed username with a password that does not exactly match the configured shared password
- **THEN** the system does not create a session
- **THEN** the system keeps the user on the login page with a clear authentication error

### Requirement: Protected routes require an authenticated session
The system SHALL block unauthenticated access to the main web UI and protected processing routes until a valid authenticated session exists.

#### Scenario: Main page redirects to login without session
- **WHEN** an unauthenticated user requests the main workflow page
- **THEN** the system redirects the request to the login page

#### Scenario: Protected API rejects unauthenticated access
- **WHEN** an unauthenticated user calls a protected processing, status, or download API route
- **THEN** the system rejects the request with a clear authentication error response

### Requirement: User can log out of the web UI
The system SHALL provide a logout action that clears the authenticated session and returns the browser to the login page.

#### Scenario: Logout clears session
- **WHEN** an authenticated user triggers logout
- **THEN** the system invalidates the session
- **THEN** the user is redirected to the login page
- **THEN** subsequent access to protected routes requires login again
