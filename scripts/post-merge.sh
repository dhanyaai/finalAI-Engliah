#!/bin/bash
set -e

# Post-merge setup: install dependencies after any task merge.
npm install --no-audit --prefer-offline
