#!/bin/bash

set -e

sqlx database setup

prepare_query=$(cat <<EOF
INSERT INTO packager VALUES(123456, "John");
INSERT INTO packager VALUES(234567, "Tom");
INSERT INTO packager VALUES(456789, "Foo");
INSERT INTO packager VALUES(567890, "Alice");
INSERT INTO packager VALUES(678901, "Carl");

INSERT INTO pkg(name, assignee) VALUES("adb", 123456);
INSERT INTO pkg(name, assignee) VALUES("broot", 123456);
INSERT INTO pkg(name, assignee) VALUES("cat", 234567);
INSERT INTO pkg(name, assignee) VALUES("diskutils", 456789);
INSERT INTO pkg(name, assignee) VALUES("electron", 456789);
INSERT INTO pkg(name, assignee) VALUES("fdisk", 456789);
INSERT INTO pkg(name, assignee) VALUES("gcc", 567890);
INSERT INTO pkg(name, assignee) VALUES("haskell", 567890);
INSERT INTO pkg(name, assignee) VALUES("iptable", 678901);

INSERT INTO mark VALUES("ready", 123456, "", 1);
INSERT INTO mark VALUES("upstreamed", 234567, "upstream fault...", 2);
INSERT INTO mark VALUES("missing-deps", 234567, "glib-c", 3);
INSERT INTO mark VALUES("stuck", 456789, "", 3);
INSERT INTO mark VALUES("ready", 456789, "", 4);
INSERT INTO mark VALUES("stuck", 456789, "hard to port...", 5);
INSERT INTO mark VALUES("ready", 456789, "", 6);
INSERT INTO mark VALUES("upstreamed", 456789, "", 7);
INSERT INTO mark VALUES("failing", 567890, "", 7);
INSERT INTO mark VALUES("failing", 567890, "", 8);
INSERT INTO mark VALUES("failing", 567890, "", 9);
EOF
)

echo $prepare_query | sqlite3 test.db
