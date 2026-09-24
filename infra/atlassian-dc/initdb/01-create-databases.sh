#!/bin/bash
# Runs once, on first start of an empty postgres volume.
# Jira and Confluence both want UTF8 with C collation, created from template0.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres <<-SQL
  CREATE ROLE jira       LOGIN PASSWORD '${ATL_DB_PASSWORD}';
  CREATE ROLE confluence LOGIN PASSWORD '${ATL_DB_PASSWORD}';
  CREATE DATABASE jira       OWNER jira       ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
  CREATE DATABASE confluence OWNER confluence ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
SQL
