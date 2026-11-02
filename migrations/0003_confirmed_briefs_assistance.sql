CREATE TABLE plan_confirmations (
 id TEXT PRIMARY KEY NOT NULL,
 event_id TEXT NOT NULL REFERENCES events(id),
 plan_id TEXT NOT NULL UNIQUE REFERENCES planning_runs(id),
 reviewer TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE assistant_drafts (
 id TEXT PRIMARY KEY NOT NULL,
 event_id TEXT NOT NULL REFERENCES events(id),
 event_revision INTEGER NOT NULL,
 payload TEXT NOT NULL,
 applied_at TEXT,
 created_at TEXT NOT NULL
);
