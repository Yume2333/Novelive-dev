#!/bin/bash
set -e
cd "$(dirname "$0")/.."
source "${NL_IMG_ENV:?set NL_IMG_ENV to your .env with NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY}"
# wait-style chained: this script is invoked AFTER each earlier batch finishes
