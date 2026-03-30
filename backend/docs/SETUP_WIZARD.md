# Setup Wizard Guide

The multi-step setup wizard simplifies the first-time configuration of NebulaProxy with auto-detection and optional Docker provisioning.

## Features
- Docker detection and optional auto-provision
- Database configuration and validation
- LDAP and auth setup
- Secret generation
- Import configuration to skip the wizard

## Import mode
You can bypass the wizard by importing a full configuration file:
- Drag and drop a `.env` or `.json` file anywhere on the wizard page
- The wizard will validate and apply it directly

## Wizard steps (summary)
1) Environment and Docker detection
2) Database connection
3) Security secrets
4) LDAP / auth options
5) Final validation and save

## Docker auto-setup
When automatic mode is selected, the wizard can create:
- PostgreSQL container
- Redis container
- Initial configuration

## Migration from old setup
- Start the new wizard
- Import your existing `.env` or fill the forms
- Save and finalize

## Minimal required variables
See `backend/.env.example` and `docs/CONFIGURATION.md`.

## Troubleshooting
- Check browser console logs (F12)
- Verify Redis availability
- Verify DB connection parameters

Main documentation: `docs/README.md`

