#!/bin/bash

set -e

DATABASE_FILE="test.db"
NO_CLEAN_UP=${NO_CLEAN_UP:-0}
export HTTP_API_TOKEN=$(LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom | head -c 16)

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
  # save it before we echo message
  exit_code=$?

  (( NO_CLEAN_UP )) && exit 0

  msg "Clean up"

  msg2 "Remove database"; rm ${DATABASE_FILE}*
  [[ -n "$(jobs)" ]] && msg2 "Kill background process" && kill %1

  exit $exit_code
}

# execute when the script exit or aborted
trap clean EXIT SIGABRT
# END OF CLEAN UP


# ====================== SET UP DB ====================
# run migration and insert necessary data into $db
prepare() {
  export DATABASE_URL="sqlite:$DATABASE_FILE"
  sqlx database setup

  prepare_query=$(cat <<EOF
  PRAGMA foreign_keys = ON;
  INSERT INTO packager VALUES(123456, "John");
  INSERT INTO packager VALUES(678901, "Carl");

  INSERT INTO pkg(name) VALUES("adb");
  INSERT INTO pkg(name) VALUES("electron8");

  INSERT INTO mark VALUES("upstreamed", 123456, 1669088178, 18, "upstream fault...", 1);
  INSERT INTO mark VALUES("stuck",      678901, 1669088178, 89, "hard to port...", 2);

  INSERT INTO assignment(pkg, assignee, assigned_at) VALUES(1, 123456, 1669088180);
  INSERT INTO assignment(pkg, assignee, assigned_at) VALUES(2, 678901, 1669088190);
EOF
)

  echo $prepare_query | sqlite3 $DATABASE_FILE
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
msg2 "Wait for server started"
sleep 2s

# TEST CASE1
msg "Test Start"
pkg_response=$(curl -s "localhost:11451/pkg" 2>&1)
if [[ "$(echo $pkg_response | jq '.msg' | xargs)" != "null" ]]; then
  error "Fail to fetch /pkg"
  error "MSG: $(echo $pkg_response | jq '.msg')"
  error "DETAIL: $(echo $pkg_response | jq '.detail')"
  exit 1
fi

route_pkg_test() {
  local selection=$1; shift
  local expect=$1; shift
  local get=$(echo "$pkg_response" | jq "$selection" | xargs)
  if [[ "$get" != "$expect" ]]; then
    error "Get $get is not expected. Require ${expect}."
    msg2 "Display Full Response for debug"
    echo "$pkg_response"
    exit 1
  fi
}

msg2 "TEST 1"; sleep 1s
route_pkg_test '.workList[0].alias' 'John'

msg2 "TEST 2"; sleep 1s
route_pkg_test '.workList[1].packages[0]' 'electron8'

msg2 "TEST 3"; sleep 1s
route_pkg_test '.markList[0].marks[0].name' 'upstreamed'

msg2 "TEST 4"; sleep 1s
route_pkg_test '.markList[1].marks[0].comment' 'hard to port...'

msg "All test passed, exit"
exit 0
