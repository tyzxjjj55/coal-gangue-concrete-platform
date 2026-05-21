# xx520 Admin

Lightweight Node.js admin service for `xx520 小站` and the coal-gangue experiment workspace.

## Structure

- `server.js` - main HTTP server, public-site rendering, private admin, work dashboard, uploads, Excel export, and reminders.
- `package.json` / `package-lock.json` - production dependencies.
- `data/content.json` - current site and experiment workspace data.
- `data/reminder-state.json` - daily reminder send state.

## Runtime

The service runs on the server as `xx520-admin.service` and listens on `127.0.0.1:5710`.

Sensitive runtime settings are not stored in this repository. They are loaded from:

```text
/etc/xx520-admin.env
```

That environment file should contain login passwords, SMTP credentials, and other deployment-only secrets.

## Notes

- Generated public static files under `/var/www/xx520-site` are not the source of truth for this repository.
- Upload directories, thumbnails, backups, `node_modules`, and session secrets are intentionally ignored.
- Before large refactors, commit the current state so `server.js` and `data/content.json` can be rolled back together.

