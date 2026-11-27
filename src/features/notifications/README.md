# Notifications

`ToastStack` renders transient application notices and errors. `App.tsx` owns notification state
because backend connectivity, sessions, commands, and multiple features all publish messages.
Features report failures through callbacks such as `onError`; they do not create a parallel global
notification store.

Each toast has a stable id, a `notice` or `error` kind, a message, and an optional session identity.
`App.tsx` filters visibility for the selected session and coordinates dismissal timing.
`ToastStack` owns only accessible rendering: notices use status semantics, errors use alert
semantics, and every item remains explicitly dismissible.

Keep notification state and cross-feature policy in `App.tsx`. Keep presentation and colocated
styles in this directory.

## Notification sounds

`sound-player.ts` plays short chimes synthesized with the Web Audio API (no audio files): a rising
two-note chime when Pi finishes responding in the open session (`finished`), three quick notes when
Pi stops for a question or an approval (`input`, any blocking `extension_ui_request` other than
kazecraft's own agent picker), and one low note when a session you are not looking at finishes, or
the open one finishes while the tab is hidden or unfocused (`background`). `finishedSoundKind`
decides between the last two. Each can be turned off, with a shared volume, in Settings →
Notifications, stored in `pi-kazecraft.notification-sounds` (`notification-sounds.ts` parses it and
is covered by `test/notification-sounds.test.ts`).

`App.tsx` plays a chime only from the live event stream (`subscribeManagerEvents`); replayed events
(reopening a session, catching up after a reconnect) never sound. The same chime is not repeated
within 1.5 s. Browsers keep audio suspended until the page has had a click or key press, so
`unlockNotificationSounds` resumes it on the first one; a chime before that is skipped, not queued.
kazecraft has no scheduled tasks, so there is no sound for them.

## Tab attention

`tab-attention.ts` owns the browser-tab completion badge: a red dot composited onto the current
favicon, the way Discord marks unread tabs. `App.tsx` keeps the badge up while an unseen completion
exists (`unseenCompletion`), from two sources: an unopened completion tracked by
`completedSessionIds` (the same set behind the sidebar markers, so the badge survives until that
session is opened and even a page refresh), and `hiddenSessionCompleted`, which covers the session
already on screen settling while nobody watched the tab and clears on the next `visibilitychange` or
window `focus`.

Surrounding the badge on a canvas instead of shipping a second icon file keeps one source of truth
for the favicon: the module rasterises whatever `link[rel~="icon"]` currently points at, draws the
badge in its bottom-right corner, and hands the result back as a `data:` URL. Original hrefs are
captured before the swap so clearing restores them exactly; compositions are cached per source href.
`public/favicon.svg` therefore declares `width`/`height` so browsers rasterise it at its intrinsic
size in the canvas.

The marker is deliberately non-intrusive: it never requests the browser notification permission and
never shows a system notification. The document title stays untouched, so the tab keeps its plain
name; only the favicon changes.

Focused tests: none; the module only touches icon links and visibility APIs.
