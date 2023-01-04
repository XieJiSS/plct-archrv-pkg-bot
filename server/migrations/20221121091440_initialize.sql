-- Add migration script here
CREATE TABLE IF NOT EXISTS packager(
  tg_uid INT NOT NULL UNIQUE PRIMARY KEY,
  alias  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pkg (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment (
  id          INTEGER PRIMARY KEY,
  pkg         INTEGER NOT NULL,
  assignee    INT NOT NULL,
  assigned_at INT NOT NULL,
  FOREIGN KEY(pkg) REFERENCES pkg(id),
  FOREIGN KEY(assignee) REFERENCES packager(tg_uid)
);

CREATE TABLE IF NOT EXISTS mark(
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  comment    TEXT,
  msg_id     INT NOT NULL,

  marked_by  INT,
  marked_at  INT NOT NULL,
  marked_for INTEGER,

  FOREIGN KEY(marked_by) REFERENCES packager(tg_uid),
  FOREIGN KEY(marked_for) REFERENCES pkg(id)
);

CREATE TABLE IF NOT EXISTS outdated_deps(
  source      INT NOT NULL,
  target      INT NOT NULL,
  mark_id     INT NOT NULL,

  FOREIGN KEY(source) REFERENCES pkg(id),
  FOREIGN KEY(target) REFERENCES pkg(id),
  FOREIGN KEY(mark_id) REFERENCES mark(id)
);

CREATE TABLE IF NOT EXISTS missing_deps(
  source      INT NOT NULL,
  target      INT NOT NULL,
  mark_id     INT NOT NULL,

  FOREIGN KEY(source) REFERENCES pkg(id),
  FOREIGN KEY(target) REFERENCES pkg(id),
  FOREIGN KEY(mark_id) REFERENCES mark(id)
);
