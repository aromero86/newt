import { useState } from 'react'
import { EarIcon, WorkflowIcon } from 'lucide-react'
import { Box, BoxBody, BoxHeader } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Graph } from 'newt-react-ui/graph'
import { Icon } from 'newt-react-ui/icon'
import { Text } from 'newt-react-ui/text'
import type { StructureGraph } from '../app-structure'

type AppGraphProps = {
  title: string
  /** The graph, with the reactions to events (dashed) or without them. */
  graph: (withReactions: boolean) => StructureGraph
  /** Whether it offers to show the reactions: the contexts' graph has none of its own. */
  reactions?: boolean
}

/** One piece of an application's structure as a graph, in a box: what uses what. */
export function AppGraph({ title, graph, reactions = false }: AppGraphProps) {
  const [withReactions, setWithReactions] = useState(false)
  const { nodes, edges } = graph(withReactions)
  // Nothing to draw: not even an empty box.
  if (edges.length === 0 && !reactions) return null

  return (
    <Box label={title}>
      <BoxHeader
        actions={reactions
          ? (
              <Button size="sm" variant={withReactions ? 'secondary' : 'ghost'} onClick={() => setWithReactions(!withReactions)}>
                <Icon icon={EarIcon} size="sm" />{withReactions ? 'Hide reactions' : 'Show reactions'}
              </Button>
            )
          : undefined}
      >
        <Icon icon={WorkflowIcon} tone="muted" /> {title}
      </BoxHeader>
      <BoxBody>
        {edges.length === 0
          ? <Text size="sm" tone="muted">{withReactions ? 'Nothing, not even through its events.' : 'Nothing. Show the reactions to see what its events link it to.'}</Text>
          : <Graph label={title} nodes={nodes} edges={edges} />}
      </BoxBody>
    </Box>
  )
}
