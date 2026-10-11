import { useEffect, type FormEvent } from 'react'
import { KeyRoundIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Box, BoxBody, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { CodeBlock } from '@newt/ui/components/code-block'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@newt/ui/components/tabs'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { SettingsAssistantsService } from './settings-assistants.service'

/** With its own SettingsAssistantsService: whoever renders it needs nothing else. */
export function SettingsAssistants() {
  return (
    <Provide services={[SettingsAssistantsService]}>
      <SettingsAssistantsWrapped />
    </Provide>
  )
}

function SettingsAssistantsWrapped() {
  const service = useService(SettingsAssistantsService)
  const tokens = useValue(service.tokens.items)
  const loaded = useValue(service.tokens.loaded)
  const hasMore = useValue(service.tokens.hasMore)
  const loadingMore = useValue(service.tokens.loadingMore)

  useEffect(() => {
    void service.load()
  }, [service])

  return (
    <Stack gap={8}>
      <section>
        <Subhead
          title="AI assistants"
          description="Connect Claude, Codex, Gemini or any assistant that speaks MCP: it reads the definition and writes proposals for you, signed as yours. It never approves, accepts nor merges."
          actions={<Button size="sm" onClick={() => service.start()}>New token</Button>}
        />
        <Box label="Access tokens">
          <BoxHeader>Access tokens</BoxHeader>
          {loaded && tokens.length === 0 && <BoxEmpty icon={KeyRoundIcon} title="No tokens yet" description="Make one for each assistant you connect, and revoke it when you stop using it." />}
          {tokens.map(token => (
            <BoxRow
              key={token.id}
              leading={<Icon icon={KeyRoundIcon} tone="muted" />}
              trailing={<Button variant="ghost" size="sm" onClick={() => void service.revoke(token)}>Revoke</Button>}
            >
              <Text size="sm" weight="semibold">{token.name}</Text>
              <BoxRowMeta>
                <span>{'made '}<RelativeTime date={token.createdAt} /></span>
                <span>{token.lastUsedAt ? <>{'last used '}<RelativeTime date={token.lastUsedAt} /></> : 'never used'}</span>
              </BoxRowMeta>
            </BoxRow>
          ))}
          {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.tokens.loadMore()}>Load more</Button></BoxFooter>}
        </Box>
      </section>
      <section>
        <Subhead title="How to connect" description="Make a token, then add newt to your assistant. Assistants on the web (ChatGPT, Claude.ai) will come when newt runs on a server." />
        <Box label="How to connect">
          <BoxBody>
            <ConnectionSteps url={service.url} secret="<your token>" />
          </BoxBody>
        </Box>
      </section>
      <SettingsAssistantsCreate />
    </Stack>
  )
}

/** The dialog to make a token, and then to copy its secret, once. */
function SettingsAssistantsCreate() {
  const service = useService(SettingsAssistantsService)
  const creating = useValue(service.creating)
  const created = useValue(service.created)
  const submitting = useValue(service.form.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.create()
  }

  return (
    <Dialog
      open={creating}
      onOpenChange={next => !next && service.close()}
      title={created ? `${created.name} is ready` : 'New token'}
      description={created ? undefined : 'One for each assistant: you can revoke it alone.'}
      size="lg"
    >
      {created
        ? (
            <Stack gap={4}>
              <Alert tone="warn" title="Copy it now">It will not be shown again. Anyone who has it acts as you in newt.</Alert>
              <CodeBlock label="Token">{created.secret}</CodeBlock>
              <ConnectionSteps url={service.url} secret={created.secret} />
              <Inline justify="end"><Button onClick={() => service.close()}>Done</Button></Inline>
            </Stack>
          )
        : (
            <form onSubmit={onSubmit} noValidate>
              <Stack gap={4}>
                <FormField form={service.form} name="name" label="What it is for" description="Claude Code on my laptop, for instance." />
                <Inline justify="end"><Button type="submit" loading={submitting}>Make token</Button></Inline>
              </Stack>
            </form>
          )}
    </Dialog>
  )
}

/** How to add newt to the most common assistants. */
function ConnectionSteps({ url, secret }: { url: string, secret: string }) {
  return (
    <Tabs defaultValue="claude" variant="underline">
      <TabsList label="Assistant">
        <TabsTrigger value="claude">Claude Code</TabsTrigger>
        <TabsTrigger value="codex">Codex</TabsTrigger>
        <TabsTrigger value="other">Others</TabsTrigger>
      </TabsList>
      <TabsContent value="claude">
        <Stack gap={2}>
          <Text size="sm" tone="muted">Run it in a terminal:</Text>
          <CodeBlock label="Claude Code command">{`claude mcp add --transport http --scope user newt ${url} --header "Authorization: Bearer ${secret}"`}</CodeBlock>
        </Stack>
      </TabsContent>
      <TabsContent value="codex">
        <Stack gap={2}>
          <Text size="sm" tone="muted">Add it to ~/.codex/config.toml, and keep the token in NEWT_TOKEN:</Text>
          <CodeBlock label="Codex configuration">{`[mcp_servers.newt]\nurl = "${url}"\nbearer_token_env_var = "NEWT_TOKEN"`}</CodeBlock>
          <CodeBlock label="Token variable">{`export NEWT_TOKEN="${secret}"`}</CodeBlock>
        </Stack>
      </TabsContent>
      <TabsContent value="other">
        <Stack gap={2}>
          <Text size="sm" tone="muted">Cursor, VS Code, Gemini CLI and most others take an MCP server over HTTP like this (Gemini CLI calls the url httpUrl):</Text>
          <CodeBlock label="MCP configuration">{JSON.stringify({ mcpServers: { newt: { url, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2)}</CodeBlock>
        </Stack>
      </TabsContent>
    </Tabs>
  )
}
