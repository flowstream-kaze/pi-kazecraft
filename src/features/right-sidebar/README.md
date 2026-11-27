# Right sidebar

The right sidebar keeps workspace tools close without mixing their behavior. `RightSidebar.tsx` composes the rail, active panel, and accessible resizing; `App.tsx` owns the active widget and width because they affect the whole layout.

## Adding a widget

Follow the [step-by-step guide](/docs/HOW-TO-WIDGET.md). Return here for the sidebar-specific contracts below.

Each widget automatically receives an **Open…** palette command and an assignable shortcut via `rightWidgetDefinitions`. Rendering remains explicit: do not introduce a component registry.

Width and active widget are stored in `pi-kazecraft.right-sidebar-width` and `pi-kazecraft.right-sidebar-widget`. Legacy Git sidebar keys are read only as migration fallbacks. Width stays between 240 and 720 px.

The rail's first button collapses the whole sidebar, rail included. It is as tall as the session top bar so the two line up, and it uses the shared `PanelIcon` (`src/components/PanelIcon.tsx`) facing right, the mirror of the session sidebar's toggle; `pi-kazecraft.right-sidebar-hidden` remembers it. While hidden, a **Show tools sidebar** button sits at the right end of the [session top bar](/src/features/top-bar/README.md), or in the top-right corner when no conversation is open, and opening a widget from the palette or a shortcut brings the sidebar back.

While a conversation is shown, the button below it (`ViewModeRailButton.tsx`) chooses the conversation view — simplified, semi-detailed, or detailed — from a menu that opens beside the rail. The view definitions live in `src/features/conversation/conversation-view.ts`; the choice is stored in `pi-kazecraft.conversation-view`.

Panel contracts: [Git](/src/features/git/README.md), [todo](/src/features/todo/README.md), and [session analysis](/src/features/session-analysis/README.md). The only rail action without a panel opens the workspace folder; [Terminal](/src/features/terminal/README.md) is reached from the command palette and its shortcut. Registry and width behavior are covered by `test/shortcuts.test.ts` and `test/git-sidebar.test.ts`.
