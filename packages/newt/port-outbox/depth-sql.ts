/**
 * How full each queue is, in SQL every dialect reads alike: ready (pending, never
 * tried), retrying (pending, tried before), running, dead, and the oldest `run_after`
 * due as of the parameter. Done jobs are left out; no payload is read.
 */
export const DEPTH_SQL = (now: string) => `
  SELECT queue,
         SUM(CASE WHEN status = 'pending' AND attempts = 0 THEN 1 ELSE 0 END) AS ready,
         SUM(CASE WHEN status = 'pending' AND attempts > 0 THEN 1 ELSE 0 END) AS retrying,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead,
         MIN(CASE WHEN status = 'pending' AND run_after <= ${now} THEN run_after END) AS "oldestDueAt"
  FROM job WHERE status IN ('pending', 'running', 'dead')
  GROUP BY queue ORDER BY queue`
