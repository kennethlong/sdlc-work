#!/bin/bash
# Creates the app roles and databases (UTF8, C collation, from template0). Idempotent: runs automatically on the
# first start of an empty postgres volume, and dc.ps1 re-runs it on every `up` so apps added later (Bitbucket) get
# their database on an existing volume too.
set -euo pipefail

for app in jira confluence bitbucket; do
  psql -v ON_ERROR_STOP=1 --username postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$app'" | grep -q 1 ||
    psql -v ON_ERROR_STOP=1 --username postgres -c "CREATE ROLE $app LOGIN PASSWORD '${ATL_DB_PASSWORD}'"
  psql -v ON_ERROR_STOP=1 --username postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$app'" | grep -q 1 ||
    psql -v ON_ERROR_STOP=1 --username postgres -c "CREATE DATABASE $app OWNER $app ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
done
