-- Add migration script here
CREATE TABLE IF NOT EXISTS packager(
  tg_uid INT NOT NULL UNIQUE PRIMARY KEY,
  alias TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pkg (
  id INT AUTO INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  assignee INT,
  last_assigned_at INT,
  FOREIGN KEY(assignee) REFERENCES packager(tg_uid)
);

CREATE TABLE IF NOT EXISTS mark(
  name TEXT NOT NULL,
  mark_by INT,
  marked_at INT NOT NULL,
  comment TEXT,
  for_pkg INT,

  FOREIGN KEY(mark_by) REFERENCES packager(tg_uid),
  FOREIGN KEY(for_pkg) REFERENCES pkg(id)
);

