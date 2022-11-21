#!/bin/bash

set -e

clean() {
  echo "Clean up"
  rm test.db*
  kill -INT %1
  exit 0
}

echo "Setup test"
./tests/prepare_test.sh
cargo build

echo "Start the server"
cargo run &

echo "Wait for server"
sleep 2s

get=$(curl -sf "localhost:11451/pkg" | jq '.[0].alias' | xargs)
if [[ "$get" != "John" ]]; then
  echo "Get $get is not expected"
  clean
  exit 1
fi

clean
