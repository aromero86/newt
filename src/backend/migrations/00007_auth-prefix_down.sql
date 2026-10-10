DROP INDEX idx_auth_password_reset_user;
DROP INDEX uq_auth_password_reset_token;
ALTER TABLE auth_password_reset RENAME TO password_reset;
CREATE UNIQUE INDEX uq_password_reset_token ON password_reset(token_hash);
CREATE INDEX idx_password_reset_user ON password_reset(user_id);

DROP INDEX idx_auth_session_user;
DROP INDEX uq_auth_session_token;
ALTER TABLE auth_session RENAME TO session;
CREATE UNIQUE INDEX uq_session_token ON session(token_hash);
CREATE INDEX idx_session_user ON session(user_id);

DROP INDEX uq_auth_credential_user;
ALTER TABLE auth_credential RENAME TO credential;
CREATE UNIQUE INDEX uq_credential_user ON credential(user_id);
