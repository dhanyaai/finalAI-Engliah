---
name: External database hosting
description: Database reachability when deploying a Replit-developed app outside Replit
---

Replit's development PostgreSQL endpoint is not reachable from external hosts. A copied development connection string can be present in an external platform's environment while the app still fails DNS lookup. Replit's separate production database offers connection details for external PostgreSQL clients; alternatively, provision an externally reachable database.

**Why:** An externally hosted release passed its container build but failed database initialization with ENOTFOUND despite having a DATABASE_URL configured. Presence of a variable did not establish network reachability.

**How to apply:** Before deploying a database-backed app outside Replit, confirm that the target connection uses a public endpoint suitable for the external host. Avoid exposing connection strings in logs or chat, and do not claim existing development data has moved to another database.