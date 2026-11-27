# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Group sessions into collapsible sections named after their workspace folder, replacing the single main workspace.
- Create a session in any folder from one `New workspace` dialog that opens the host's native folder dialog, with recent workspaces and typed paths as fallbacks.
- Add a session to an existing workspace from the `＋` button on its section.

### Changed

- The active workspace now follows the selected session instead of being chosen separately; Git, todos, quotas, terminal, prompt templates, and the right sidebar follow it.
- Startup no longer selects a session automatically: the previous selection is restored when its Pi process is still alive.

### Removed

- Session pinning, the `Other workspaces` section, the `Open directory picker` command and its `alt+d` shortcut. Stored pinned-session choices are not migrated; sessions still in Pi history appear under their workspace as ordinary rows.



### Added

- Copy assistant code blocks to the clipboard with a single click.
- Launch Pi Kazecraft from any directory with the global `pi-kazecraft` command.
- Fork conversations from user messages and edit the returned prompt before continuing.
- Show partially generated tool calls with inferred built-in names such as `ask_user_question`, streamed scalar arguments and file paths, and a lowercase fallback label.
- Display semantic file-type icons in the Git widget and after tool-call paths.

### Changed

- Highlight tool call names with the app accent color for better readability.
- Display tool call durations in conversation cards.
- Give Git commit file lists the available width while keeping their actions accessible.
- Highlight read ranges with the app accent color.

### Fixed

- Assemble live assistant RPC deltas so streaming replies display as complete, coherent text.
- Show assistant output before blocking questions, instead of hiding it behind the prompt.
- Preserve queued steering when switching sessions.
- Avoid conflicts with Pi's existing `ask_user_question` tool.
- Display Pi error notifications as errors instead of notices.
- Automatically dismiss error notifications after five seconds.
- Open files outside the current working directory from conversation actions.

## [1.1.0] - 2026-08-05

### Added

- Run Pi Kazecraft natively on Windows, including process launching, home-path resolution, terminal and directory completion.
- Manage sessions directly from the sidebar: rename them or close running Pi sessions without losing persisted history; the next nearby active session is selected automatically.
- Reclaim sidebar space by collapsing the sessions panel.
- Keep changes safer with CI checks (typecheck, lint, tests) against the latest Pi version.
- See GitHub project interest at a glance with a stars badge in the README.

### Changed

- Display Bash executable names like other tools, without repeating the `bash` prefix.
- Open long conversations much faster: Pi processes are reused instead of restarted; the first three sessions in each workspace keep their own process, and only a process idle for more than three minutes is reassigned afterward. Bursts can temporarily create additional processes.
- Browse conversations faster with cached Markdown rendering and lighter previews.
- Find recent work faster: sessions are sorted by latest activity, with active and ended states clearly distinguished in the sidebar.
- Understand session state at a glance: the sidebar now marks idle sessions that still have an attached Pi process; spacing, alignment and ended-session styling are also clearer.

### Fixed

- Avoid startup race failures: requests now wait briefly for the manager to connect.
- Open long conversations reliably: session histories up to 64 MiB no longer hit the default JSONL record limit.

## [1.0.0] - 2026-08-01

### Added

- Initial release.
