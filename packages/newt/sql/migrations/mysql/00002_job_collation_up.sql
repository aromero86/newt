-- utf8mb4_bin pads ('a' = 'a '); utf8mb4_0900_bin compares a trailing space too, as
-- every store does.
ALTER TABLE job_queue MODIFY name VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL;
ALTER TABLE job MODIFY id VARCHAR(64) COLLATE utf8mb4_0900_bin NOT NULL, MODIFY queue VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL;
