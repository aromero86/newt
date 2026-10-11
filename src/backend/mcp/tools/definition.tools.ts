import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DimensionDTO } from '../../modules/dimension/dimension.schema'
import type { RuleDTO } from '../../modules/rule/rule.schema'
import { answer, pageArgs, pageRequest, paged, type McpContext } from '../mcp-context'

const IN_FORCE = 'in force: merged changes only; see list_planned_changes for what accepted proposals will change'
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
const workspaceId = z.string().describe('The workspace id, from list_workspaces')

/** Reading the definition: workspaces, dimensions, areas, features, rules and what is planned. */
export function registerDefinitionTools(server: McpServer, { modules, links }: McpContext) {
  /** A rule as the assistant reads it: its scope with names, and its link. */
  const ruleOf = (id: string, dimensions: DimensionDTO[], rule: RuleDTO) => ({
    key: rule.key,
    id: rule.id,
    feature: { id: rule.featureId, name: rule.featureName },
    retired: rule.retiredAt !== null,
    version: rule.current.version,
    kind: rule.current.kind,
    statement: rule.current.statement,
    why: rule.current.why,
    appliesIn: rule.current.scope.length === 0 ? 'everywhere' : rule.current.scope.map(({ dimensionId, valueIds }) => {
      const dimension = dimensions.find(each => each.id === dimensionId)
      return { dimension: dimension?.name ?? dimensionId, dimensionId, values: valueIds.map(valueId => ({ id: valueId, name: dimension?.values.find(value => value.id === valueId)?.name ?? valueId })) }
    }),
    criteria: rule.current.criteria,
    url: links.rule(id, rule.key),
  })

  server.registerTool('list_workspaces', {
    title: 'List workspaces',
    description: 'The workspaces the person is a member of: one per product, each with the language its content is written in.',
    inputSchema: { ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer(paged(await modules.workspace.mine(pageRequest(args)), workspace => ({
    id: workspace.id, name: workspace.name, description: workspace.description, language: workspace.language, archived: workspace.archivedAt !== null, role: workspace.myRole, url: links.workspace(workspace.id),
  }))))

  server.registerTool('list_dimensions', {
    title: 'List dimensions',
    description: 'The dimensions of a workspace and their values: where its rules can apply (platform, market…). Every one, in order: never paged.',
    inputSchema: { workspaceId },
    annotations: READ_ONLY,
  }, async args => answer({
    definition: IN_FORCE,
    dimensions: (await modules.dimension.list(args.workspaceId)).map(dimension => ({
      id: dimension.id, name: dimension.name, values: dimension.values.map(value => ({ id: value.id, name: value.name, retired: value.retiredAt !== null })),
    })),
  }))

  server.registerTool('list_areas', {
    title: 'List areas',
    description: 'The areas a workspace groups its features in, in their order.',
    inputSchema: { workspaceId, retired: z.boolean().optional().describe('The retired ones instead of the active ones'), ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer({
    definition: IN_FORCE,
    ...paged(await modules.featureArea.list(args.workspaceId, args.retired ?? false, pageRequest(args)), area => ({
      id: area.id, name: area.name, description: area.description, url: links.area(args.workspaceId, area.id),
    })),
  }))

  server.registerTool('list_features', {
    title: 'List features',
    description: 'The features of an area, in their order.',
    inputSchema: { workspaceId, areaId: z.string(), retired: z.boolean().optional().describe('The retired ones instead of the active ones'), ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer({
    definition: IN_FORCE,
    ...paged(await modules.feature.list(args.workspaceId, args.areaId, args.retired ?? false, pageRequest(args)), feature => ({
      id: feature.id, name: feature.name, description: feature.description, url: links.feature(args.workspaceId, feature.id),
    })),
  }))

  server.registerTool('list_rules', {
    title: 'List rules',
    description: 'The rules in force of a workspace, or of one feature, in the order of their keys; only those that apply in the given dimension values, if any.',
    inputSchema: {
      workspaceId,
      featureId: z.string().optional(),
      appliesIn: z.array(z.object({ dimensionId: z.string(), valueId: z.string() })).optional().describe('At most one value per dimension: the rules that apply in all of them'),
      retired: z.boolean().optional().describe('The retired ones instead of the ones in force'),
      ...pageArgs,
    },
    annotations: READ_ONLY,
  }, async args => {
    const dimensions = await modules.dimension.list(args.workspaceId)
    const rules = await modules.rule.list(args.workspaceId, { featureId: args.featureId, retired: args.retired ?? false, appliesIn: args.appliesIn ?? [] }, pageRequest(args))
    return answer({ definition: IN_FORCE, ...paged(rules, rule => ruleOf(args.workspaceId, dimensions, rule)) })
  })

  server.registerTool('get_rule', {
    title: 'Get a rule',
    description: 'One rule by its key (R-7), with its history: its versions, newest first, and the merged proposals that made it what it is.',
    inputSchema: { workspaceId, key: z.string().describe('R-7') },
    annotations: READ_ONLY,
  }, async args => {
    const rule = await modules.rule.get(args.workspaceId, args.key)
    const dimensions = await modules.dimension.list(args.workspaceId)
    const versions = await modules.rule.versions(args.workspaceId, args.key, { size: 20 })
    const history = await modules.baseline.history(args.workspaceId, rule.id, { size: 20 })
    return answer({
      definition: IN_FORCE,
      rule: ruleOf(args.workspaceId, dimensions, rule),
      versions: versions.items.map(({ id: _, ...version }) => version),
      proposals: history.items.map(({ proposal }) => ({ key: proposal.key, title: proposal.title, url: links.proposal(args.workspaceId, proposal.key) })),
    })
  })

  server.registerTool('list_planned_changes', {
    title: 'List planned changes',
    description: 'What proposals accepted and not merged yet will change: the planned definition is the one in force plus these. Only those on the given artifacts, if any.',
    inputSchema: { workspaceId, targetIds: z.array(z.string()).optional().describe('Ids of areas, features, rules or dimensions'), ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer({
    definition: 'planned: accepted, not merged yet; not in force',
    ...paged(await modules.baseline.planned(args.workspaceId, args.targetIds?.length ? args.targetIds : undefined, pageRequest(args)), ({ proposal, delta }) => ({
      proposal: { key: proposal.key, title: proposal.title, url: links.proposal(args.workspaceId, proposal.key) },
      kind: delta.kind, operation: delta.operation, target: delta.targetLabel, targetId: delta.targetId, before: delta.before, after: delta.after,
    }), ({ delta }) => delta.id),
  }))
}
