import type { ReactNode } from 'react'

/** One question; the answer opens on click. */
function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className='faq-item'>
      <summary>{title}</summary>
      <div className='faq-answer'>{children}</div>
    </details>
  )
}

/**
 * Settings → Help & FAQ: how the local AI stack fits together, how to change kazecraft by asking in
 * chat, and where things are kept. Plain words first; paths and numbers for when they are needed.
 */
export function FaqSettings() {
  return (
    <section className='faq-settings'>
      <p>
        Everything here runs on this PC. Click a question to open it.
      </p>

      <h3>How it works</h3>
      <Question title='What starts when I open Local AI?'>
        <p>
          The <strong>Local AI</strong>{' '}
          shortcut on the desktop opens one window that starts four things:
        </p>
        <ul>
          <li>
            <strong>llama-swap</strong>, at{' '}
            <code>http://127.0.0.1:8080</code>. It is the one address for every model, and it loads
            whichever model a chat asks for.
          </li>
          <li>
            <strong>The model servers</strong>, started by llama-swap when needed: PolyStrata for
            Gemma, and llama.cpp for Bonsai.
          </li>
          <li>
            <strong>Pi</strong>, the AI agent that reads files, runs commands and edits projects. It
            calls itself Firefly.
          </li>
          <li>
            <strong>kazecraft</strong>, this page, at <code>http://127.0.0.1:5173</code>.
          </li>
        </ul>
        <p>
          Closing that window stops all of them. The window also shows what the models are doing:
          loading, reading a prompt, and the speed of every reply.
        </p>
      </Question>
      <Question title='Why does switching models take a few seconds?'>
        <p>
          The graphics card (10 GB) holds one model at a time. Switching unloads one and loads the
          other: about 10 seconds for Bonsai and 15 to 25 for Gemma. A notice above the message box
          shows the progress. Choosing a model in the picker starts loading it straight away, so it
          is often ready by the time you finish typing.
        </p>
        <p>
          Settings → Models can also load a model ahead of time with <strong>Load now</strong>.
        </p>
      </Question>
      <Question title='Which model should I use?'>
        <p>
          <strong>[Chat] Gemma</strong> for conversation, writing, explaining and pictures.
          <strong>[Coding] Bonsai</strong>{' '}
          for code and for agent work: reading, changing and running things in a project. Settings →
          Models describes both. You can switch in the middle of a chat.
        </p>
      </Question>
      <Question title='What are context and compaction?'>
        <p>
          The <strong>context</strong>{' '}
          is how much of the conversation a model can see at once: 76,800 tokens for both models (a
          token is about three quarters of a word). When a chat grows past about 60,000 tokens, Pi
          {' '}
          <strong>compacts</strong>{' '}
          it: older messages are replaced by a summary the model writes, and the newest part is kept
          word for word. The summary appears as a collapsed block in the chat.
        </p>
        <p>
          Both models have the same context on purpose, so switching never meets a smaller limit. If
          a reply ever fails, a notice above the message box says why.
        </p>
      </Question>
      <Question title='What do thinking levels do?'>
        <p>
          Both models can think before they answer. The thinking picker in the message box sets how
          much: Off is fastest, higher levels take longer but help with harder problems. The
          thinking shows as a collapsible block above the answer.
        </p>
        <p>
          Now and then a model gets stuck repeating itself while it thinks. Press{' '}
          <strong>Stop</strong>{' '}
          and send the message again, perhaps with a lower thinking level. Gemma's thinking is
          capped at 8,192 tokens, after which it has to answer, so a loop ends on its own within a
          few minutes.
        </p>
      </Question>
      <Question title='How does Read aloud work?'>
        <p>
          The speaker button under a reply reads it with Kokoro-82M, a speech model that runs on the
          processor, not the graphics card, so it never competes with the chat model. Kate is the
          default voice; the voice picker in the message box has the others. It makes speech about
          3.5 times faster than it plays, so after the first sentence it keeps ahead.
        </p>
      </Question>

      <Question title='Does Pi remember things between chats?'>
        <p>
          Yes. Pi has a long-term memory that every chat reads with every message, in every project,
          old chats included. Say “Remember that…” in any chat and it is saved; say “Forget that…”
          or correct it to change it. Settings → Memory shows the memory and lets you edit it.
        </p>
        <p>
          Pi can also learn{' '}
          <strong>skills</strong>: step-by-step procedures it can follow again. After a task, say
          “Save how we did this as a skill.” Skills are listed in Settings → Memory, and a chat can
          run one directly with <code>/skill:name</code>.
        </p>
      </Question>

      <h3>Changing kazecraft by asking in chat</h3>
      <Question title='Can Pi change kazecraft itself?'>
        <p>
          Yes. kazecraft's code is in{' '}
          <code>D:\AI\pi-kazecraft</code>, and Pi can edit it like any other project:
        </p>
        <ol>
          <li>
            Start a chat in the <strong>pi-kazecraft</strong>{' '}
            project (its ＋ in the sidebar). If it is not there, right-click the sidebar, choose New
            section, and add that folder.
          </li>
          <li>
            Pick <strong>[Coding] Bonsai</strong>, which is the better model for code.
          </li>
          <li>
            Describe the change in plain words, for example: “Add a button to the message footer
            that copies the reply as Markdown.”
          </li>
          <li>
            Pi edits the files. Changes to the page appear by themselves within a second or two, and
            changes to the server part restart it automatically. A change to Pi's own tools reaches
            a chat after Reload; a change to the manager shows a “Manager needs update” button.
          </li>
        </ol>
      </Question>
      <Question title='How do I keep or undo a change Pi made?'>
        <p>
          The Git panel in the right sidebar lists every changed file with its differences. From
          there you can <strong>Commit</strong> to keep a change, <strong>Push</strong>{' '}
          it to GitHub, or discard it to undo. Pi checks its own work before it says it is done: it
          runs the type check, lint and tests (an instruction in{' '}
          <code>~\.pi\agent\APPEND_SYSTEM.md</code>), and its <code>change-kazecraft</code>{' '}
          skill lists where things live and how changes go live.
        </p>
      </Question>
      <Question title='Tips for asking for changes'>
        <ul>
          <li>Ask for one change at a time, and say where it should appear on screen.</li>
          <li>Mention what should stay the same, such as “keep the current colors”.</li>
          <li>
            If something looks wrong, say what you see; a screenshot attached with ＋ helps.
          </li>
          <li>
            Larger changes, such as a new Settings tab, work best as a short plan first: ask Pi to
            describe what it will change before it starts.
          </li>
          <li>
            After a change to the manager (the part that runs Pi), close and reopen Local AI.
          </li>
        </ul>
      </Question>
      <Question title='Can Pi change the models or the launcher too?'>
        <p>
          Yes, in a chat on the folder concerned: <code>D:\AI\ai-launcher</code>{' '}
          for the launcher and llama-swap, <code>D:\AI\PolyStrata</code>{' '}
          for Gemma's settings. A context size is set in three places that must match;{' '}
          <code>D:\AI\ai-launcher\README.md</code>{' '}
          lists them, and Pi can read it. Restart Local AI afterwards.
        </p>
      </Question>

      <h3>Files and privacy</h3>
      <Question title='Does anything leave this PC?'>
        <p>
          No. The models, the speech and all chats run and stay here. Pi only goes online when you
          ask it to, for example to look something up or to install a package.
        </p>
      </Question>
      <Question title='Where are my chats and files kept?'>
        <ul>
          <li>
            Chats: <code>~\.pi\agent\sessions</code>, one file per chat.
          </li>
          <li>
            New projects:{' '}
            <code>Documents\AI Projects</code>. Files Pi writes for a project go in its folder.
          </li>
          <li>
            Your kazecraft settings (theme, text size, banners, sounds, voice): this browser.
          </li>
          <li>
            Pi's models and default: <code>~\.pi\agent\models.json</code> and{' '}
            <code>settings.json</code>.
          </li>
          <li>
            The launcher's log: <code>D:\AI\ai-launcher\logs\llama-swap.log</code>.
          </li>
        </ul>
      </Question>
      <Question title='How do I open a file Pi made?'>
        <p>
          When a reply names a file that exists, the name is a link with a small file icon. Click it
          (or right-click) for <strong>Open</strong>, which uses the file's usual app, or{' '}
          <strong>Show in folder</strong>, which opens File Explorer with the file selected. A file
          type with no app set brings up Windows' “How do you want to open this?” window. Programs
          and scripts never run from a link: Open shows the “Open with” window for them instead.
        </p>
      </Question>
      <Question title='How do I remove a project?'>
        <p>
          Right-click its name in the sidebar and choose Delete project. Its chats are deleted; the
          folder is kept, unless it is in <code>Documents\AI Projects</code>{' '}
          and you tick the option to move it to the Recycle Bin.
        </p>
      </Question>

      <h3>When something goes wrong</h3>
      <Question title='A reply never comes, or the page says Pi is off the radar'>
        <ul>
          <li>Look at the Local AI window: errors appear there in red.</li>
          <li>
            Use <strong>Reload</strong>{' '}
            (next to Settings in the sidebar) to restart Pi for the open chat.
          </li>
          <li>
            Open{' '}
            <code>http://127.0.0.1:8080</code>, llama-swap's own page, to see which model is loaded
            and its log.
          </li>
          <li>If nothing helps, close the Local AI window and open it again.</li>
        </ul>
      </Question>
      <Question title='Replies became slow'>
        <p>
          Usually another program is using the graphics card's memory, so part of the model spills
          into slower memory. Close games or video programs and reload the model (switch away and
          back, or restart Local AI). Long chats are also somewhat slower than short ones.
        </p>
      </Question>
    </section>
  )
}
