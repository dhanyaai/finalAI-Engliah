#!/bin/bash
set -e

# Post-merge setup: install dependencies after any task merge.
npm install --no-audit --prefer-offline

# Apply the committed schema to the development database. Replit Publish diffs
# this development schema into production before the new release serves traffic.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
