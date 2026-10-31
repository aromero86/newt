-- What each deployed commit's message says after its first line.
ALTER TABLE deployment ADD COLUMN description TEXT;
