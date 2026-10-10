-- The three access modules share the `auth-` prefix, and their tables follow.
ALTER TABLE credential RENAME TO auth_credential;
DROP INDEX uq_credential_user;
CREATE UNIQUE INDEX uq_auth_credential_user ON auth_credential(user_id);

ALTER TABLE session RENAME TO auth_session;
DROP INDEX uq_session_token;
DROP INDEX idx_session_user;
CREATE UNIQUE INDEX uq_auth_session_token ON auth_session(token_hash);
CREATE INDEX idx_auth_session_user ON auth_session(user_id);

ALTER TABLE password_reset RENAME TO auth_password_reset;
DROP INDEX uq_password_reset_token;
DROP INDEX idx_password_reset_user;
CREATE UNIQUE INDEX uq_auth_password_reset_token ON auth_password_reset(token_hash);
CREATE INDEX idx_auth_password_reset_user ON auth_password_reset(user_id);
