import { useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import { readPlanTiming, writePlanTiming } from './plan-clock-store.ts'
import {
  formatPlanDuration,
  planIdentity,
  planRunBase,
  planTiming,
  type PlanState,
  type PlanTiming,
} from './plan-state.ts'
import type { PlanStep, PlanStepStatus } from '../../../shared/plan.ts'

const collapsedPlanKey = 'pi-kazecraft.plan-collapsed'

const markers: Record<PlanStepStatus, string> = {
  pending: '○',
  in_progress: '●',
  completed: '✓',
  skipped: '–',
}

const statusLabels: Record<PlanStepStatus, string> = {
  pending: 'pending',
  in_progress: 'in progress',
  completed: 'completed',
  skipped: 'skipped',
}

/**
 * Shows the plan Pi committed for the current task. The panel stays collapsed for the plan the
 * user folded away and reopens when Pi replaces the plan with different steps.
 */
export function PlanPanel(
  { plan, running, sessionId }: { plan: PlanState; running: boolean; sessionId: string },
) {
  const identity = useMemo(() => planIdentity(plan), [plan])
  const [collapsed, setCollapsed] = useState(() => readCollapsedPlan() === identity)
  const [now, setNow] = useState(() => Date.now())
  // A reload reopens the panel with the time it had folded, plus the instant that time is from.
  const [restored] = useState(() => readPlanTiming(sessionId))
  const [timing, setTiming] = useState<PlanTiming>(() => planTiming(plan, restored?.timing))
  const [activeSince, setActiveSince] = useState<number | undefined>()
  const persistRef = useRef<() => void>(() => {})

  useEffect(() => setCollapsed(readCollapsedPlan() === identity), [identity])

  // Merge instead of replace: a snapshot refresh can resend a payload older than folded time.
  useEffect(() => {
    setTiming((current) => planTiming(plan, current))
    setNow(Date.now())
  }, [plan])

  // Run the clock only while Pi works. The live window covers exactly what no payload reports:
  // from the payload's recorded instant while running, and only the settle folds the tail —
  // so a snapshot refresh never re-counts folded time and an idle wait is never billed.
  const mountedRef = useRef(false)
  const wasRunningRef = useRef(false)
  const liveBaseRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const first = !mountedRef.current
    const wasRunning = wasRunningRef.current
    mountedRef.current = true
    wasRunningRef.current = running
    if (!running) {
      // Pi settled: fold the uncovered tail once, then stop the clock for good.
      const base = liveBaseRef.current
      liveBaseRef.current = undefined
      setActiveSince(undefined)
      if (base === undefined || plan.complete) return
      const elapsed = Date.now() - base
      if (elapsed <= 0) return
      const step = plan.plan.steps.find(({ status }) => status === 'in_progress')?.text
      setTiming((current) => {
        const steps = new Map(current.steps)
        if (step !== undefined) steps.set(step, (steps.get(step) ?? 0) + elapsed)
        return {
          texts: current.texts,
          steps,
          totalMs: current.totalMs + elapsed,
          complete: current.complete,
        }
      })
      return
    }
    const now = Date.now()
    const startedAt = planRunBase(
      first,
      wasRunning,
      plan.plan.recordedAt,
      restored?.savedAt,
      liveBaseRef.current,
      now,
    )
    liveBaseRef.current = startedAt
    setActiveSince(startedAt)
    setNow(now)
  }, [plan, restored, running])

  // The total keeps running while agents work on an unfinished plan, even between two steps.
  const ticking = running && !plan.complete
  useEffect(() => {
    if (!ticking) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [ticking])

  const live = activeSince === undefined ? 0 : Math.max(0, now - activeSince)
  const durationOf = (step: PlanStep): number =>
    (timing.steps.get(step.text) ?? 0) + (step.status === 'in_progress' ? live : 0)
  const total = timing.totalMs + (running && !plan.complete ? live : 0)

  // Leaving the page is the only moment folded time cannot be derived again.
  useEffect(() => {
    persistRef.current = () => {
      const elapsed = activeSince === undefined ? 0 : Math.max(0, Date.now() - activeSince)
      const step = plan.plan.steps.find(({ status }) => status === 'in_progress')?.text
      const steps = new Map(timing.steps)
      if (step !== undefined && elapsed > 0 && !plan.complete)
        steps.set(step, (steps.get(step) ?? 0) + elapsed)
      writePlanTiming(
        sessionId,
        {
          texts: timing.texts,
          steps,
          totalMs: plan.complete ? timing.totalMs : timing.totalMs + elapsed,
          complete: timing.complete,
        },
        Date.now(),
      )
    }
  })
  useEffect(() => {
    const persist = (): void => persistRef.current()
    window.addEventListener('pagehide', persist)
    return () => window.removeEventListener('pagehide', persist)
  }, [])

  const toggle = (): void => {
    const next = !collapsed
    writeCollapsedPlan(next ? identity : undefined)
    setCollapsed(next)
  }

  const pending = plan.plan.steps.find(({ status }) => status === 'pending')?.text
  const headline = plan.complete ? 'All steps done' : plan.current ?? pending ?? 'Working'
  const paused = !running && !plan.complete
  const announcement = [
    `Plan: ${plan.done} of ${plan.total} steps done.`,
    plan.current ? `In progress: ${plan.current}.` : '',
    plan.complete ? 'All steps done.' : '',
    paused ? 'Pi is not working on this plan right now.' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      aria-label='Task plan'
      className={`plan-panel${collapsed ? ' is-collapsed' : ''}${
        plan.complete ? ' is-complete' : ''
      }`}
    >
      <Tooltip
        label={`Plan: ${plan.done}/${plan.total} steps done${
          plan.complete ? '' : `\nIn progress: ${plan.current ?? 'waiting for the next step'}`
        }`}
      >
        <button aria-expanded={!collapsed} className='plan-heading' onClick={toggle} type='button'>
          <span aria-hidden='true' className='plan-caret'>▾</span>
          <span className='plan-title'>Plan</span>
          <span aria-hidden='true' className='plan-separator' />
          <span className='plan-current'>{headline}</span>
          <span className='plan-progress'>{plan.done}/{plan.total}</span>
          {paused && <span className='plan-note'>paused</span>}
          <span aria-label={`${formatPlanDuration(total)} of active time`} className='plan-total'>
            {formatPlanDuration(total)}
          </span>
        </button>
      </Tooltip>
      {!collapsed && (
        <ol className='plan-steps'>
          {plan.plan.steps.map((step, index) => {
            const duration = durationOf(step)
            return (
              <li
                className='plan-step'
                data-status={step.status}
                key={`${index}:${step.text}`}
              >
                <span aria-hidden='true' className='plan-step-marker'>{markers[step.status]}</span>
                <span className='plan-step-text'>{step.text}</span>
                {(step.status !== 'pending' || duration > 0) && (
                  <span className='plan-step-duration'>{formatPlanDuration(duration)}</span>
                )}
                <span className='plan-step-status'>{statusLabels[step.status]}</span>
              </li>
            )
          })}
        </ol>
      )}
      <p aria-live='polite' className='plan-announcement'>{announcement}</p>
    </section>
  )
}

function readCollapsedPlan(): string | undefined {
  return window.localStorage.getItem(collapsedPlanKey) ?? undefined
}

function writeCollapsedPlan(identity: string | undefined): void {
  if (identity === undefined) window.localStorage.removeItem(collapsedPlanKey)
  else window.localStorage.setItem(collapsedPlanKey, identity)
}
