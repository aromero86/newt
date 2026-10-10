DROP INDEX idx_session_user;
DROP INDEX uq_session_token;
ALTER TABLE session RENAME TO auth__session;
CREATE UNIQUE INDEX uq_auth__session_token ON auth__session(token_hash);
CREATE INDEX idx_auth__session_user ON auth__session(user_id);

DROP INDEX uq_credential_user;
ALTER TABLE credential RENAME TO auth__credential;
CREATE UNIQUE INDEX uq_auth__credential_user ON auth__credential(user_id);
