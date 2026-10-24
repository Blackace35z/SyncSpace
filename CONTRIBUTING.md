# Contributing to SyncSpace

SyncSpace is currently in development. Before investing in a larger change, open an issue or discussion to confirm the scope and avoid duplicating ongoing work.

## Development setup

Follow the Windows setup in the [README](./README.md). Keep local `.env` files, credentials, databases, and database backups out of commits.

## Before opening a pull request

Run the relevant checks from the repository root:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Set-Location ..\frontend
npm ci
npm run lint
npm run build
```

For changes affecting authorization, workspace boundaries, sessions, or persisted user data, include tests that cover both authorized access and isolation from other users or workspaces.

Keep changes focused, preserve existing migration data, update user-facing documentation when behavior changes, and do not include generated files or personal data.
