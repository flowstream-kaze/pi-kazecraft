# Backend capabilities

This directory contains local product capabilities used by `server/backend.ts`. The backend remains the sole HTTP routing and validation boundary; feature modules implement behavior and persistence without defining routes.

- [`folder-picker/`](/server/features/folder-picker/README.md) opens the host's native directory dialog for choosing a workspace folder.
- [`git/`](/server/features/git/README.md) reads and mutates the selected repository.
- [`terminal/`](/server/features/terminal/README.md) launches an external terminal application in the workspace directory.
- [`todos/`](/server/features/todos/README.md) persists workspace task lists.

These modules do not own Pi processes. All Pi commands continue through `server/manager-client.ts` to `server/manager.ts`.

## Add a backend capability

Place behavior and persistence in the narrowest `server/features/<feature>/` module. Keep HTTP paths, working-directory resolution, request parsing, and trust-boundary validation in `server/backend.ts`; capability modules do not define routes. If the browser consumes the capability, add its request wrapper to `src/api.ts` and put shared response shapes in `shared/` only when they cross layers.

Reuse `ManagerClient` when the capability needs Pi. Do not start or own a Pi process from a feature module. Add a focused test beside the existing backend tests for parsing, persistence, or external-command behavior, then link the capability README from this index.
