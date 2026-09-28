---
name: Replit-managed Clerk hosting constraint
description: Why the managed Clerk tenant cannot authenticate an app hosted directly on an external platform.
---

Replit-managed Clerk must be served through Replit's production infrastructure. An external production hostname is not registered to the managed tenant, so its `/api/__clerk/v1/environment` request returns `host_invalid` even when the proxy middleware and keys are wired correctly.

**Why:** A DigitalOcean deployment built and served the app and API successfully, but Clerk rejected the DigitalOcean hostname. Replit documentation confirms external hosting is not supported for a Replit-managed Clerk instance.

**How to apply:** For a production app that keeps Replit-managed Clerk, use Replit Publish. If production must run on DigitalOcean or another external host, plan an explicit migration to a user-managed external Clerk tenant rather than changing managed keys or weakening the proxy wiring.