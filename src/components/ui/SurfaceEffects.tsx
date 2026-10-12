// SPDX-License-Identifier: MPL-2.0
import { createContext, useContext } from 'react'
import type { HTMLAttributes } from 'react'
import { useFocusInput } from './focus'

type Depth = 'light' | 'heavy'
const SurfaceDepth = createContext<Depth>('light')

export function useSurfaceDepth() {
  return useContext(SurfaceDepth)
}

/** Keeps the same shared components and carries elevation into their portals. */
export function SurfaceEffects({
  depth = 'light',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { depth?: Depth }) {
  useFocusInput()
  return (
    <SurfaceDepth.Provider value={depth}>
      <div {...props} data-ui-depth={depth}>
        {children}
      </div>
    </SurfaceDepth.Provider>
  )
}
