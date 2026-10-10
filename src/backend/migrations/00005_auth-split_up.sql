-- `auth` is two modules now, each owning its table: `credential` and `session`.
-- Credentials are replaced, never deleted; sessions are not history and are
-- removed when they end. Neither carries deleted_at.
ALTER TABLE auth__credential RENAME TO credential;
DROP INDEX uq_auth__credential_user;
CREATE UNIQUE INDEX uq_credential_user ON credential(user_id);

ALTER TABLE auth__session RENAME TO session;
DROP INDEX uq_auth__session_token;
DROP INDEX idx_auth__session_user;
CREATE UNIQUE INDEX uq_session_token ON session(token_hash);
CREATE INDEX idx_session_user ON session(user_id);
