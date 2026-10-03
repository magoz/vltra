'use client'

import { useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent } from 'react'

/** How far (px) a row must travel left to count as a swipe. */
export const swipeDistance = 80

/** Movement (px) before a touch is read as horizontal (swipe) or vertical (scroll). */
const slop = 8

type Gesture = {
  readonly pointerID: number
  readonly x: number
  readonly y: number
  /** Decided after `slop`: horizontal follows the finger, vertical leaves it to scrolling. */
  direction: 'undecided' | 'horizontal' | 'vertical'
}

/**
 * Swipe left with a finger (touch pointers only) to run `onSwipeLeft`. The row follows the
 * finger and snaps back; the click that ends a swipe is swallowed, so the row link does not open.
 * Pair the handlers with `touch-action: pan-y` so vertical scrolling still works.
 */
export function useSwipeLeft(onSwipeLeft: (() => void) | undefined) {
  const [offset, setOffset] = useState(0)
  const gesture = useRef<Gesture | undefined>(undefined)
  const swiped = useRef(false)

  const reset = () => {
    gesture.current = undefined
    setOffset(0)
  }

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (onSwipeLeft === undefined || event.pointerType !== 'touch') return

      swiped.current = false
      gesture.current = {
        pointerID: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        direction: 'undecided'
      }
    },
    onPointerMove: (event: PointerEvent) => {
      const current = gesture.current

      if (current === undefined || current.pointerID !== event.pointerId) return

      const dx = event.clientX - current.x
      const dy = event.clientY - current.y

      if (current.direction === 'undecided') {
        if (Math.abs(dx) < slop && Math.abs(dy) < slop) return

        current.direction = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      }

      if (current.direction === 'vertical') return

      swiped.current = true
      setOffset(Math.min(0, dx))
    },
    onPointerUp: (event: PointerEvent) => {
      const current = gesture.current

      if (current === undefined || current.pointerID !== event.pointerId) return

      const done = current.direction === 'horizontal' && event.clientX - current.x <= -swipeDistance

      reset()

      if (done) onSwipeLeft?.()
    },
    onPointerCancel: reset,
    onClickCapture: (event: MouseEvent) => {
      if (!swiped.current) return

      swiped.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const style: CSSProperties | undefined =
    offset === 0 ? undefined : { transform: `translateX(${offset}px)` }

  return { handlers, style, offset }
}
