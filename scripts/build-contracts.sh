#!/bin/sh
# Builds both contracts to wasm inside the pinned Rust image, so the output
# (and its hash) does not depend on the host. Prints each file's sha256.
set -eu
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD:/work" -w /work rust:1.99.1 sh -c '
  RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s" cargo build --release --locked \
    --target wasm32-unknown-unknown --target-dir /tmp/build \
    -p setoff-clearing-house -p setoff-test-token
  mkdir -p target/wasm32-unknown-unknown/release
  cp /tmp/build/wasm32-unknown-unknown/release/setoff_clearing_house.wasm \
     /tmp/build/wasm32-unknown-unknown/release/setoff_test_token.wasm \
     target/wasm32-unknown-unknown/release/
  sha256sum target/wasm32-unknown-unknown/release/*.wasm
'
