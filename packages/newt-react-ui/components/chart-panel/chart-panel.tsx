import { Children, useState, type ReactNode } from 'react'
import { Maximize2Icon } from 'lucide-react'
import { ChartFillContext } from '../../internal/chart'
import { Box, BoxBody, BoxHeader } from '../box'
import { Button } from '../button'
import { Dialog } from '../dialog'
import { Grid } from '../grid'
import { Icon } from '../icon'

/**
 * Several charts side by side: one under another on a phone, two from md up, and three
 * from lg up when there are three, or five or more. Each one a `ChartPanel`.
 */
export function ChartRow({ children }: { children: ReactNode }) {
  const count = Children.toArray(children).length
  const wide = count === 1 ? 1 : count === 2 || count === 4 ? 2 : 3
  return <Grid columns={{ base: 1, md: count === 1 ? 1 : 2, lg: wide }}>{children}</Grid>
}

/**
 * A chart in its box, under what it shows, with a button that zooms it: the same chart,
 * as big as the screen lets it be, in a dialog; all of the screen on a phone. Its legend
 * there is its own.
 */
export function ChartPanel({ title, children }: { title: ReactNode, children: ReactNode }) {
  const [zoomed, setZoomed] = useState(false)
  return (
    <Box>
      <BoxHeader actions={<Button size="icon-sm" variant="ghost" label="Zoom" onClick={() => setZoomed(true)}><Icon icon={Maximize2Icon} size="sm" /></Button>}>
        {title}
      </BoxHeader>
      <BoxBody>{children}</BoxBody>
      <Dialog open={zoomed} onOpenChange={setZoomed} title={title} size="full">
        <ChartFillContext.Provider value>
          <div className="h-full">{zoomed && children}</div>
        </ChartFillContext.Provider>
      </Dialog>
    </Box>
  )
}
