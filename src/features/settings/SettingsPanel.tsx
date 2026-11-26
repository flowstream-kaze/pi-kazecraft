import { type ReactNode, useEffect, useRef, useState } from 'react'
import * as Select from '@radix-ui/react-select'
import {
  NOTIFICATION_SOUND_KINDS,
  NOTIFICATION_SOUND_LABELS,
  type NotificationSoundPreferences,
} from '../notifications/notification-sounds.ts'
import { playChime } from '../notifications/sound-player.ts'
import { BANNER_ACCEPT, prepareBannerImage, prepareImage } from '../workspace/sidebar-banner.ts'
import { WelcomeBanner } from '../../components/WelcomeBanner.tsx'
import {
  setWelcomeBanner,
  useWelcomeBanner,
  WELCOME_BANNER_BOX,
} from '../../components/welcome-banner-store.ts'
import { SidebarBanner } from '../workspace/SidebarBanner.tsx'
import type { CommandDefinition, CommandId } from '../commands/command-registry.ts'
import { shortcutFromEvent, shortcutConflicts } from '../commands/command-registry.ts'
import {
  DEFAULT_FONT_SIZES,
  FONT_SIZE_KEYS,
  FONT_SIZE_LABELS,
  type FontSizeKey,
  type FontSizes,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from './font-sizes.ts'
import {
  applyThemePalette,
  contrastColor,
  shadowForMode,
  THEME_VARIABLES,
  type Theme,
  type ThemeVariable,
} from './themes.ts'

const themeVariableLabels: Record<ThemeVariable, string> = {
  canvas: 'Background',
  surface: 'Surface',
  ink: 'Text',
  accent: 'Primary accent',
  'sidebar-accent': 'Sidebar accent',
  secondary: 'Secondary accent',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
}

// ── Tab registry ───────────────────────────────────────────────────

/** Identifies a settings tab. Extend this union when adding a new tab. */
export type SettingsTabId =
  | 'themes'
  | 'text'
  | 'sidebar'
  | 'notifications'
  | 'terminal'
  | 'shortcuts'

/** Describes one section in the settings modal's side list. */
export interface SettingsTabDefinition {
  id: SettingsTabId
  label: string
  /** Extra words the search box matches, such as the settings inside the section. */
  keywords: string
  icon: ReactNode
}

/** Ordered list of sections rendered in the settings modal. */
const settingsTabs: SettingsTabDefinition[] = [
  {
    id: 'themes',
    label: 'Color themes',
    keywords: 'appearance colour dark light accent palette',
    icon: (
      <NavIcon d='M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.7 1.6-1.5 0-.9-.6-1.3-.6-2.1 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3ZM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01' />
    ),
  },
  {
    id: 'text',
    label: 'Text size',
    keywords: 'font messages thinking code input zoom',
    icon: <NavIcon d='M4 7V5h10v2M9 5v14M7 19h4M14 13v-1h6v1M17 12v7M16 19h2' />,
  },
  {
    id: 'sidebar',
    label: 'Banners',
    keywords: 'sidebar welcome banner image logo picture',
    icon: <NavIcon d='M4 5h16v14H4zM9.5 5v14' />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    keywords: 'sound chime alert finished question approval volume',
    icon: <NavIcon d='M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0' />,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    keywords: 'command console shell',
    icon: <NavIcon d='M4 5h16v14H4zM7.5 9.5 10 12l-2.5 2.5M12.5 15h4' />,
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    keywords: 'keyboard hotkeys keys',
    icon: <NavIcon d='M3 7h18v10H3zM7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M7.5 14h9' />,
  },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='17'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='17'
    >
      <path d={d} />
    </svg>
  )
}

/** An on/off switch: a button with the switch role, as in system settings. */
function Toggle(
  { checked, label, onChange }: {
    checked: boolean
    label: string
    onChange: (on: boolean) => void
  },
) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className='settings-toggle'
      onClick={() => onChange(!checked)}
      role='switch'
      type='button'
    >
      <span aria-hidden='true' />
    </button>
  )
}

// ── Shared props ───────────────────────────────────────────────────

interface SettingsPanelProps {
  /** The tab shown when the panel opens; `/hotkeys` opens on the shortcuts. */
  initialTab?: SettingsTabId
  definitions: CommandDefinition[]
  shortcuts: Partial<Record<CommandId, string>>
  terminalCommand: string
  fontSizes: FontSizes
  /** The sidebar banner image (a data URL), or null for the built-in banner. */
  bannerImage: string | null
  themes: Theme[]
  activeThemeId: string
  onChange: (id: CommandId, shortcut: string) => void
  onFontSizesChange: (sizes: FontSizes) => void
  /** Stores a banner image, or restores the built-in banner for null; throws when it cannot save. */
  onBannerChange: (image: string | null) => void
  notificationSounds: NotificationSoundPreferences
  onNotificationSoundsChange: (preferences: NotificationSoundPreferences) => void
  onTerminalCommandChange: (value: string) => void
  onSelectTheme: (id: string) => void
  onDuplicateTheme: () => void
  onRenameTheme: (id: string, name: string) => void
  onUpdateThemeColor: (id: string, variable: ThemeVariable, color: string) => void
  onDeleteTheme: (id: string) => void
  onResetTheme: (id: string) => void
  onReset: () => void
  onClose: () => void
}

// ── Section components ─────────────────────────────────────────────

interface TabSectionProps {
  children: ReactNode
  id: string
  labelledBy: string
}

/** Wraps a tab panel with the correct ARIA attributes. */
function TabPanel({ children, id, labelledBy }: TabSectionProps) {
  return (
    <div aria-labelledby={labelledBy} className='settings-tab-panel' id={id} role='tabpanel'>
      {children}
    </div>
  )
}

interface ThemeSettingsProps {
  activeTheme: Theme | undefined
  editableTheme: boolean
  themeName: string
  themes: Theme[]
  onSelectTheme: (id: string) => void
  onDuplicateTheme: () => void
  onUpdateThemeColor: (id: string, variable: ThemeVariable, color: string) => void
  onDeleteTheme: (id: string) => void
  onResetTheme: (id: string) => void
  onThemeNameChange: (name: string) => void
  onCommitThemeName: () => void
}

function ThemeSettings(
  {
    activeTheme,
    editableTheme,
    themeName,
    themes,
    onSelectTheme,
    onDuplicateTheme,
    onUpdateThemeColor,
    onDeleteTheme,
    onResetTheme,
    onThemeNameChange,
    onCommitThemeName,
  }: ThemeSettingsProps,
) {
  // Theme hovered in the dropdown, applied live to the app until the pointer leaves.
  const [previewTheme, setPreviewTheme] = useState<Theme | undefined>(undefined)

  useEffect(() => {
    const theme = previewTheme ?? activeTheme
    if (!theme) return
    const root = document.documentElement
    root.dataset.theme = theme.mode
    applyThemePalette(root, theme.palette)
    const shadows = shadowForMode(theme.mode)
    root.style.setProperty('--shadow', shadows.shadow)
    root.style.setProperty('--shadow-soft', shadows['shadow-soft'])
  }, [activeTheme, previewTheme])

  return (
    <section className='theme-settings'>
      <p>
        Choose a theme and edit its 8 source colors directly. Built-in changes are saved locally and
        can be restored anytime. Surfaces, text shades, borders, hover states, and contrast colours
        are generated automatically.
      </p>
      <div className='theme-toolbar'>
        <Select.Root
          onOpenChange={(open) => {
            if (!open) setPreviewTheme(undefined)
          }}
          onValueChange={onSelectTheme}
          value={activeTheme?.id ?? ''}
        >
          <Select.Trigger aria-label='Active color theme' className='theme-select-trigger'>
            <Select.Value placeholder='Choose a theme' />
            <Select.Icon className='theme-select-chevron' />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className='theme-select-content' position='popper' sideOffset={4}>
              <Select.Viewport onPointerLeave={() => setPreviewTheme(undefined)}>
                {themes.map((theme) => (
                  <Select.Item
                    className='theme-select-item'
                    key={theme.id}
                    onPointerEnter={() => setPreviewTheme(theme)}
                    value={theme.id}
                    style={{
                      '--item-accent': theme.palette.accent,
                      '--item-surface': theme.palette.surface,
                      '--item-ink': theme.palette.ink,
                      '--item-on-accent': contrastColor(theme.palette.accent),
                    } as React.CSSProperties}
                  >
                    <Select.ItemText>
                      {theme.name}
                      {theme.builtIn
                        ? ' · Built-in'
                        : ''}
                    </Select.ItemText>
                    <Select.ItemIndicator aria-hidden='true'>✓</Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <button onClick={onDuplicateTheme} type='button'>New custom theme</button>
      </div>
      {activeTheme && (
        <>
          <div className='theme-name'>
            <label>
              Name<input
                disabled={!editableTheme}
                onBlur={onCommitThemeName}
                onChange={(event) => onThemeNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onCommitThemeName()
                  }
                }}
                value={themeName}
              />
            </label>
            {activeTheme.builtIn
              ? (
                <button onClick={() => onResetTheme(activeTheme.id)} type='button'>
                  Restore default
                </button>
              )
              : (
                <button
                  disabled={!editableTheme}
                  onClick={() => onDeleteTheme(activeTheme.id)}
                  type='button'
                >
                  Delete
                </button>
              )}
          </div>
          <div className='theme-colors'>
            {THEME_VARIABLES.map((variable) => (
              <label className='theme-color' key={variable}>
                <span>{themeVariableLabels[variable]}</span>
                <input
                  aria-label={themeVariableLabels[variable]}
                  disabled={!editableTheme}
                  onChange={(event) =>
                    onUpdateThemeColor(
                      activeTheme.id,
                      variable,
                      event.target.value,
                    )}
                  type='color'
                  value={activeTheme.palette[variable]}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

interface TerminalSettingsProps {
  terminalCommand: string
  onTerminalCommandChange: (value: string) => void
}

function TerminalSettings({ terminalCommand, onTerminalCommandChange }: TerminalSettingsProps) {
  return (
    <section>
      <label className='terminal-command-row'>
        <span>External terminal command</span>
        <input
          aria-label='Terminal command template'
          onChange={(event) => onTerminalCommandChange(event.target.value)}
          placeholder='Platform default'
          spellCheck={false}
          value={terminalCommand}
        />
        {terminalCommand && !terminalCommand.includes('{cwd}') && (
          <small className='terminal-command-error'>
            The template must contain {'{cwd}'} where the workspace folder should be inserted.
          </small>
        )}
        <small>
          Leave empty for the platform default, or use {'{cwd}'} for the workspace folder.
        </small>
      </label>
    </section>
  )
}

interface TextSizeSettingsProps {
  fontSizes: FontSizes
  onFontSizesChange: (sizes: FontSizes) => void
}

interface NotificationSettingsProps {
  preferences: NotificationSoundPreferences
  onChange: (preferences: NotificationSoundPreferences) => void
}

function NotificationSettings({ preferences, onChange }: NotificationSettingsProps) {
  const allOff = NOTIFICATION_SOUND_KINDS.every((kind) => !preferences.enabled[kind])
  return (
    <section className='notification-settings'>
      <h3>Notification sounds</h3>
      <div className='settings-rows'>
        {NOTIFICATION_SOUND_KINDS.map((kind) => (
          <div className='settings-row' key={kind}>
            <div className='settings-row-text'>
              <strong>{NOTIFICATION_SOUND_LABELS[kind].title}</strong>
              <span>{NOTIFICATION_SOUND_LABELS[kind].description}</span>
            </div>
            <button
              aria-label={`Play the ${NOTIFICATION_SOUND_LABELS[kind].title} sound`}
              className='settings-row-preview'
              onClick={() => playChime(kind, preferences.volume || 60, true)}
              type='button'
            >
              <NavIcon d='M8 6v12l10-6L8 6Z' />
            </button>
            <Toggle
              checked={preferences.enabled[kind]}
              label={NOTIFICATION_SOUND_LABELS[kind].title}
              onChange={(on) =>
                onChange({ ...preferences, enabled: { ...preferences.enabled, [kind]: on } })}
            />
          </div>
        ))}
        <div className='settings-row'>
          <div className='settings-row-text'>
            <strong>Volume</strong>
            <span>{allOff ? 'All sounds are off.' : `${preferences.volume}%`}</span>
          </div>
          <input
            aria-label='Notification volume'
            className='settings-row-slider'
            disabled={allOff}
            max={100}
            min={0}
            onChange={(event) => onChange({ ...preferences, volume: Number(event.target.value) })}
            onPointerUp={() => playChime('finished', preferences.volume, true)}
            step={5}
            type='range'
            value={preferences.volume}
          />
        </div>
      </div>
      <p className='settings-note'>
        Sounds play only while kazecraft is open in a browser tab, and the browser allows them only
        after you have clicked in the page once. Scheduled tasks have no sound because kazecraft
        does not run scheduled tasks.
      </p>
    </section>
  )
}

interface SidebarSettingsProps {
  bannerImage: string | null
  onBannerChange: (image: string | null) => void
}

function SidebarSettings({ bannerImage, onBannerChange }: SidebarSettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function applyFile(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      onBannerChange(await prepareBannerImage(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This image could not be used.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <WelcomeBannerSettings />
      <section className='sidebar-settings'>
        <h3>Sidebar banner</h3>
        <p>
          The image at the top of the session sidebar. Wide images work best; it is shown about 44
          pixels tall and scaled to fit. The image is saved in this browser.
        </p>
        <div className='sidebar-settings-preview'>
          <SidebarBanner image={bannerImage} />
        </div>
        <div className='sidebar-settings-actions'>
          <input
            accept={BANNER_ACCEPT}
            aria-label='Banner image file'
            hidden
            onChange={(event) => void applyFile(event.target.files?.[0])}
            ref={fileRef}
            type='file'
          />
          <button disabled={busy} onClick={() => fileRef.current?.click()} type='button'>
            {busy ? 'Preparing…' : 'Choose image…'}
          </button>
          <button
            disabled={busy || bannerImage === null}
            onClick={() => {
              setError('')
              onBannerChange(null)
            }}
            type='button'
          >
            Restore default banner
          </button>
        </div>
        {error && <p className='sidebar-settings-error' role='alert'>{error}</p>}
      </section>
    </>
  )
}

/**
 * The banner on the welcome, loading and empty-session screens. A chosen image is stored at up to
 * 920 x 400 and shown within 460 x 200 with its proportions, so any shape displays properly.
 */
function WelcomeBannerSettings() {
  const fileRef = useRef<HTMLInputElement>(null)
  const custom = useWelcomeBanner()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function applyFile(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setWelcomeBanner(await prepareImage(file, WELCOME_BANNER_BOX))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This image could not be used.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className='sidebar-settings welcome-banner-settings'>
      <h3>Welcome banner</h3>
      <p>
        Shown on the welcome screen, while a session loads, and in an empty session. Any image
        works: it keeps its shape and is shown up to 460 pixels wide and 200 tall (wide images look
        best, like the default 3:1). Images are scaled down to load quickly and saved in this
        browser.
      </p>
      <div className='welcome-banner-preview'>
        <WelcomeBanner />
      </div>
      <div className='sidebar-settings-actions'>
        <input
          accept={BANNER_ACCEPT}
          aria-label='Welcome banner image file'
          hidden
          onChange={(event) => void applyFile(event.target.files?.[0])}
          ref={fileRef}
          type='file'
        />
        <button disabled={busy} onClick={() => fileRef.current?.click()} type='button'>
          {busy ? 'Preparing…' : 'Choose image…'}
        </button>
        <button
          disabled={busy || custom === null}
          onClick={() => {
            setError('')
            setWelcomeBanner(null)
          }}
          type='button'
        >
          Restore default banner
        </button>
      </div>
      {error && <p className='sidebar-settings-error' role='alert'>{error}</p>}
    </section>
  )
}

function TextSizeSettings({ fontSizes, onFontSizesChange }: TextSizeSettingsProps) {
  const setSize = (key: FontSizeKey, size: number) =>
    onFontSizesChange({ ...fontSizes, [key]: size })
  const isDefault = FONT_SIZE_KEYS.every((key) => fontSizes[key] === DEFAULT_FONT_SIZES[key])
  return (
    <section className='text-size-settings'>
      <p>Changes apply right away and are saved in this browser.</p>
      {FONT_SIZE_KEYS.map((key) => (
        <label className='text-size-row' key={key}>
          <span>{FONT_SIZE_LABELS[key]}</span>
          <input
            aria-label={`${FONT_SIZE_LABELS[key]} text size`}
            max={MAX_FONT_SIZE}
            min={MIN_FONT_SIZE}
            onChange={(event) => setSize(key, Number(event.target.value))}
            step={1}
            type='range'
            value={fontSizes[key]}
          />
          <output>{fontSizes[key]}px</output>
        </label>
      ))}
      <button
        disabled={isDefault}
        onClick={() => onFontSizesChange({ ...DEFAULT_FONT_SIZES })}
        type='button'
      >
        Restore default sizes
      </button>
    </section>
  )
}

interface ShortcutsSettingsProps {
  definitions: CommandDefinition[]
  shortcuts: Partial<Record<CommandId, string>>
  conflicts: Set<CommandId>
  capturing: CommandId | null
  onCaptureStart: (id: CommandId) => void
  onCaptureEnd: () => void
  onChange: (id: CommandId, shortcut: string) => void
}

function ShortcutsSettings(
  { definitions, shortcuts, conflicts, capturing, onCaptureStart, onCaptureEnd, onChange }:
    ShortcutsSettingsProps,
) {
  return (
    <section>
      <p>Focus a field, then press the exact key or key combination you want.</p>
      {definitions
        .filter(({ id }) => id !== 'send')
        .map((definition) => (
          <div
            className={conflicts.has(definition.id)
              ? 'shortcut-row conflict'
              : 'shortcut-row'}
            key={definition.id}
          >
            <span>{definition.label}{conflicts.has(definition.id) && <small>Conflict</small>}</span>
            <span className='shortcut-control'>
              <input
                aria-label={`Shortcut: ${definition.label}`}
                onBlur={onCaptureEnd}
                onKeyDown={(event) => {
                  event.preventDefault()
                  const value = shortcutFromEvent(event)
                  if (value) {
                    onChange(definition.id, value)
                    onCaptureEnd()
                  }
                }}
                onFocus={() => onCaptureStart(definition.id)}
                placeholder='Unassigned'
                readOnly
                value={capturing === definition.id ? 'Press keys…' : shortcuts[definition.id] ?? ''}
              />
              <button
                aria-label={`Clear shortcut: ${definition.label}`}
                disabled={!shortcuts[definition.id]}
                onClick={() => onChange(definition.id, '')}
                type='button'
              >
                Clear
              </button>
            </span>
          </div>
        ))}
    </section>
  )
}

// ── Main panel ─────────────────────────────────────────────────────

/** Configures local shortcuts, terminal behavior, and editable color themes. */
export function SettingsPanel({
  initialTab = 'themes',
  definitions,
  shortcuts,
  terminalCommand,
  fontSizes,
  notificationSounds,
  onNotificationSoundsChange,
  bannerImage,
  themes,
  activeThemeId,
  onChange,
  onFontSizesChange,
  onBannerChange,
  onTerminalCommandChange,
  onSelectTheme,
  onDuplicateTheme,
  onRenameTheme,
  onUpdateThemeColor,
  onDeleteTheme,
  onResetTheme,
  onReset,
  onClose,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab)
  const [search, setSearch] = useState('')
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const query = search.trim().toLowerCase()
  const visibleTabs = query
    ? settingsTabs.filter((tab) => `${tab.label} ${tab.keywords}`.toLowerCase().includes(query))
    : settingsTabs
  const activeLabel = settingsTabs.find((tab) => tab.id === activeTab)?.label ?? ''
  const [themeName, setThemeName] = useState('')
  const conflicts = shortcutConflicts(shortcuts)
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) ?? themes[0]
  const editableTheme = Boolean(activeTheme)

  useEffect(() => {
    setThemeName(activeTheme?.name ?? '')
  }, [activeTheme?.id, activeTheme?.name])

  const commitThemeName = () => {
    if (activeTheme && themeName.trim() !== activeTheme.name)
      onRenameTheme(activeTheme.id, themeName)
  }

  return (
    <div
      className='settings-backdrop'
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section aria-label='Settings' className='settings-panel' role='dialog'>
        <header>
          <h2>Settings</h2>
          <button aria-label='Close settings' onClick={onClose} type='button'>×</button>
        </header>
        <div className='settings-body'>
          <nav className='settings-nav'>
            <label className='settings-search'>
              <NavIcon d='M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4' />
              <input
                aria-label='Search settings'
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  // Enter opens the first match, so typing a word and Enter jumps to it.
                  if (event.key === 'Enter' && visibleTabs[0]) setActiveTab(visibleTabs[0].id)
                }}
                placeholder='Search'
                type='search'
                value={search}
              />
            </label>
            <div aria-orientation='vertical' className='settings-tab-bar' role='tablist'>
              {visibleTabs.map((tab) => (
                <button
                  aria-controls={`settings-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  id={`settings-tab-btn-${tab.id}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role='tab'
                  type='button'
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
              {visibleTabs.length === 0 && (
                <p className='settings-nav-empty'>No matching settings</p>
              )}
            </div>
          </nav>
          <section className='settings-content'>
            <h2 className='settings-section-title'>{activeLabel}</h2>
            {activeTab === 'notifications' && (
              <TabPanel
                key='notifications'
                id='settings-tab-notifications'
                labelledBy='settings-tab-btn-notifications'
              >
                <NotificationSettings
                  onChange={onNotificationSoundsChange}
                  preferences={notificationSounds}
                />
              </TabPanel>
            )}
            {activeTab === 'themes' && (
              <TabPanel key='themes' id='settings-tab-themes' labelledBy='settings-tab-btn-themes'>
                <ThemeSettings
                  activeTheme={activeTheme}
                  editableTheme={editableTheme}
                  onCommitThemeName={commitThemeName}
                  onDeleteTheme={onDeleteTheme}
                  onDuplicateTheme={onDuplicateTheme}
                  onSelectTheme={onSelectTheme}
                  onThemeNameChange={setThemeName}
                  onResetTheme={onResetTheme}
                  onUpdateThemeColor={onUpdateThemeColor}
                  themeName={themeName}
                  themes={themes}
                />
              </TabPanel>
            )}
            {activeTab === 'text' && (
              <TabPanel key='text' id='settings-tab-text' labelledBy='settings-tab-btn-text'>
                <TextSizeSettings fontSizes={fontSizes} onFontSizesChange={onFontSizesChange} />
              </TabPanel>
            )}
            {activeTab === 'sidebar' && (
              <TabPanel
                key='sidebar'
                id='settings-tab-sidebar'
                labelledBy='settings-tab-btn-sidebar'
              >
                <SidebarSettings bannerImage={bannerImage} onBannerChange={onBannerChange} />
              </TabPanel>
            )}
            {activeTab === 'terminal' && (
              <TabPanel
                key='terminal'
                id='settings-tab-terminal'
                labelledBy='settings-tab-btn-terminal'
              >
                <TerminalSettings
                  onTerminalCommandChange={onTerminalCommandChange}
                  terminalCommand={terminalCommand}
                />
              </TabPanel>
            )}
            {activeTab === 'shortcuts' && (
              <TabPanel
                key='shortcuts'
                id='settings-tab-shortcuts'
                labelledBy='settings-tab-btn-shortcuts'
              >
                <ShortcutsSettings
                  capturing={capturing}
                  conflicts={conflicts}
                  definitions={definitions}
                  onChange={onChange}
                  onCaptureEnd={() => setCapturing(null)}
                  onCaptureStart={setCapturing}
                  shortcuts={shortcuts}
                />
              </TabPanel>
            )}
          </section>
        </div>
        <footer>
          <button onClick={onReset} type='button'>Reset shortcuts</button>
          <button className='primary' onClick={onClose} type='button'>Done</button>
        </footer>
      </section>
    </div>
  )
}
