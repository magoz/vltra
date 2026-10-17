'use client'

import type { ComponentProps } from 'react'
import { ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

/** Responsive shadcn-style chart frame ; chart colors come from theme variables. */
export const ChartContainer = ({
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  readonly children: ComponentProps<typeof ResponsiveContainer>['children']
}) => (
  <div data-slot="chart" className={cn('relative min-w-0 text-xs', className)} {...props}>
    <ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
      {children}
    </ResponsiveContainer>
  </div>
)
