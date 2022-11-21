-- Add migration script here
CREATE TABLE IF NOT EXIST packager(
  tg_uid INT NOT NULL UNIQUE PRIMARY KEY,
  alias TEXT NOT NULL
);

CREATE TALE IF NOT EXIST pkg (
  id INT AUTO INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  assignee INT,
  FOREIGN KEY(assignee) REFERENCES packager(tg_uid)
);

CREATE TABLE IF NOT EXIST mark(
  name TEXT NOT NULL,
  mark_by INT,
  comment TEXT,
  for_pkg INT

  FOREIGN KEY(mark_by) REFERENCES packager(tg_uid),
  FOREIGN KEY(for_pkg) REFERENCES pkg(id)
);

