#!/bin/sh
set -eu

npm --prefix selene-plugins/app-mockup-kit run render -- \
  --input "$1" \
  --output "${2:-./out/mockup.svg}" \
  --preset "${3:-browser-chrome}"
