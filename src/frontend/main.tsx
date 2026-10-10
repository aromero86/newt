import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@newt/ui/styles/theme.css'
import { Button } from '@newt/ui/components/button'
import { Container } from '@newt/ui/components/container'
import { Heading } from '@newt/ui/components/heading'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'

function App() {
  const [count, setCount] = useState(0)
  return (
    <Container>
      <Stack gap={4}>
        <Heading level={1}>Hello world</Heading>
        <Inline gap={3}>
          <Button onClick={() => setCount(count + 1)}>Click me</Button>
          <Text tone="muted">Clicked {count} times</Text>
        </Inline>
      </Stack>
    </Container>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
