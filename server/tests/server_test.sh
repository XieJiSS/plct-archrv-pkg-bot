#!/bin/bash

set -e

# ============= SETUP LOGGING ====================
# prefer terminal safe colored and bold text when tput is supported
if tput setaf 0 &>/dev/null; then
  ALL_OFF="$(tput sgr0)"
  BOLD="$(tput bold)"
  BLUE="${BOLD}$(tput setaf 4)"
  GREEN="${BOLD}$(tput setaf 2)"
  RED="${BOLD}$(tput setaf 1)"
  YELLOW="${BOLD}$(tput setaf 3)"
else
  ALL_OFF="\e[0m"
  BOLD="\e[1m"
  BLUE="${BOLD}\e[34m"
  GREEN="${BOLD}\e[32m"
  RED="${BOLD}\e[31m"
  YELLOW="${BOLD}\e[33m"
fi
readonly ALL_OFF BOLD BLUE GREEN RED YELLOW

msg() {
  local mesg=$1; shift
  printf "${GREEN}==>${ALL_OFF}${BOLD} ${mesg}${ALL_OFF}\n" "$@"
}

msg2() {
  local mesg=$1; shift
  printf "${BLUE}  ->${ALL_OFF}${BOLD} ${mesg}${ALL_OFF}\n" "$@"
}

error() {
  local mesg=$1; shift
  printf "${RED}==> $(gettext "ERROR:")${ALL_OFF}${BOLD} ${mesg}${ALL_OFF}\n" "$@" >&2
}
# END OF SETUP LOGGING


# ================= SETUP CLEAN UP =====================
# delete the test database and kill the backgroun server
clean() {
  echo "Clean up"
  rm test.db*
  kill -INT %1
  exit 0
}

# execute when the script exit or aborted
trap clean EXIT SIGABRT
# END OF CLEAN UP


# ====================== SET UP DB ====================
# run migration and insert necessary data into $db
prepare() {
  db="test.db"
  export DATABASE_URL="sqlite:$db"
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

  INSERT INTO mark VALUES("ready",        123456, 1669088178, "", 1);
  INSERT INTO mark VALUES("upstreamed",   234567, 1669088178, "upstream fault...", 2);
  INSERT INTO mark VALUES("missing-deps", 234567, 1669088178, "glib-c", 3);
  INSERT INTO mark VALUES("stuck",        456789, 1669088178, "", 3);
  INSERT INTO mark VALUES("ready",        456789, 1669088178, "", 4);
  INSERT INTO mark VALUES("stuck",        456789, 1669088178, "hard to port...", 5);
  INSERT INTO mark VALUES("ready",        456789, 1669088178, "", 6);
  INSERT INTO mark VALUES("upstreamed",   456789, 1669088178, "", 7);
  INSERT INTO mark VALUES("failing",      567890, 1669088178, "", 7);
  INSERT INTO mark VALUES("failing",      567890, 1669088178, "", 8);
  INSERT INTO mark VALUES("failing",      567890, 1669088178, "", 9);
EOF
)

  echo $prepare_query | sqlite3 $db
}
# END OF DB SETUP


# MAIN

msg "Setup DB"
prepare
msg "Compile Server"
cargo build

# run server in background
msg "Start the server"
cargo run &
# necessary to avoid curl execute before server is ready
msg2 "Wait for server"
sleep 2s

# TEST CASE1
msg "Test Start"
msg2 "TEST 1"; sleep 1s
get=$(curl -sf "localhost:11451/pkg" | jq '.[0].alias' | xargs)
if [[ "$get" != "John" ]]; then
  error "Get $get is not expected"
  exit 1
fi

exit 0
