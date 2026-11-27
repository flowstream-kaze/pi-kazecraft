# Folder picker backend capability

`folder-picker.ts` opens the host's native directory dialog so the browser can let the user pick a workspace folder. The dialog always opens on the machine running the backend, never on a remote client.

Each platform contributes its own candidates, tried in order until one starts:

- Linux uses `zenity --file-selection --directory`, then `kdialog --getexistingdirectory`, then `yad`. WSL first tries the Windows-native PowerShell dialog and converts its chosen path with `wslpath`; if Windows interop is unavailable, it tries those Linux dialogs.
- Native Windows runs a constant PowerShell script that shows `System.Windows.Forms.FolderBrowserDialog`; the starting directory reaches it through `PI_KAZECRAFT_PICK_INITIAL`, never through the script text.
- macOS runs `osascript` with `choose folder` and passes the starting directory as a separate argument, outside the script source. macOS is handled here instead of extending `getDesktopPlatform`, because `openPath` does not support it yet.

Return contract: exit code 0 with output resolves the selected path. Exit code 1 with no stderr, empty successful output, and osascript's cancellation error `-128` resolve as `null`; other failures throw with the dialog's stderr. A missing executable (`ENOENT`) moves to the next candidate; when none starts, `FolderPickerUnavailableError` lets the backend answer `{ path: null, unavailable: true }` so the interface falls back to typed input.

HTTP routing, the single-dialog guard, working-directory resolution, and canonicalization of the selected path remain in `server/backend.ts`. Main coverage: `test/folder-picker.test.ts`.
