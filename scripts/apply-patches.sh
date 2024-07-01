#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PATCHES_DIR=$(dirname "$SCRIPT_DIR")/patches

main() {
    for f in $(ls "$PATCHES_DIR"/*.patch); do
        apply_patch "$f"
    done
}

apply_patch() {
    local file="$1"

    patch -p1 < "$file"
}

main "$@"
