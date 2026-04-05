import { useEffect, useRef, useState, type ReactNode } from 'react'

interface ChartSize {
  width: number
  height: number
}

interface MeasuredChartProps {
  className?: string
  minHeight?: number
  children: (size: ChartSize) => ReactNode
}

export function MeasuredChart({ className = '', minHeight = 220, children }: MeasuredChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<ChartSize | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateSize = () => {
      const nextWidth = Math.floor(element.clientWidth)
      const nextHeight = Math.floor(element.clientHeight)

      if (nextWidth > 0 && nextHeight > 0) {
        setSize({ width: nextWidth, height: nextHeight })
      }
    }

    updateSize()

    const frame = globalThis.requestAnimationFrame(updateSize)
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)

    return () => {
      globalThis.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div ref={containerRef} className={className} style={{ minHeight }}>
      {size ? children(size) : null}
    </div>
  )
}