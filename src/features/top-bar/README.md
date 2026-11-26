# Session top bar

`SessionTopBar.tsx` heads the open conversation. On the left, `SessionInfo.tsx` shows the session name and a dot while Pi works; during compaction a "Compacting…" status replaces them. Context usage lives in the composer's [Context chip](/src/features/composer/ContextChip.tsx).

`App.tsx` renders the bar whenever a conversation is shown and gives the main area the `has-top-bar` class, which adds the bar's grid row and keeps the floating manager notice below it. The `actions` slot holds controls placed at the right edge; today that is the **Show tools sidebar** button while the [right sidebar](/src/features/right-sidebar/README.md) is hidden.

The bar reads only the session summary and Pi's session stats from the current snapshot; it sends no commands.
