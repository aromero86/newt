-- The AI assistant a revision was written with, by the name it gives itself
-- (claude-code, codex…); null when it was written by hand.
ALTER TABLE proposal__revision ADD COLUMN assistant TEXT;
