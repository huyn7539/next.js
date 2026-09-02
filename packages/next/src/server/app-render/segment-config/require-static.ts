import type {
  AppSegmentConfig,
  RequireStatic,
} from '../../../build/segment-config/app/app-segment-config'
import { parseLoaderTree } from '../../../shared/lib/router/utils/parse-loader-tree'
import {
  getLayoutOrPageModule,
  type LoaderTree,
} from '../../lib/app-dir-module'

type SupportedRequireStatic = Exclude<RequireStatic, 'navigation'>

export async function resolveRequireStaticConfig(
  tree: LoaderTree
): Promise<SupportedRequireStatic> {
  const { config, filePath } = await resolveRequireStaticConfigImpl(tree)
  switch (config) {
    case 'auto':
    case 'shell':
    case 'prefetch': {
      break
    }
    case 'navigation': {
      throw new Error(
        `\`${formatRequireStaticExport(config)}\` is not implemented yet.` +
          `\n  (from: ${filePath})` +
          ``
      )
    }
  }
  return config
}

type RequireStaticWithSource = {
  config: RequireStatic
  filePath: string | null
}

async function resolveRequireStaticConfigImpl(
  tree: LoaderTree
): Promise<RequireStaticWithSource> {
  const { mod: layoutOrPageMod, filePath } = await getLayoutOrPageModule(tree)

  const config = getRequireStaticConfigForModule(layoutOrPageMod)

  const parentResult: RequireStaticWithSource = {
    config,
    filePath: filePath ?? null,
  }

  // Walk the slots if any and validate that they don't have incompatible configs
  // with each other. If compatible, pick the most constrained value from the slots.
  let slotsResult: RequireStaticWithSource | null = null
  let slotResultKey: string | null = null
  const { parallelRoutes } = parseLoaderTree(tree)
  for (const parallelRouteKey in parallelRoutes) {
    const parallelRoute = parallelRoutes[parallelRouteKey]
    const childResult = await resolveRequireStaticConfigImpl(parallelRoute)
    if (!slotsResult) {
      slotsResult = childResult
      slotResultKey = parallelRouteKey
    } else {
      // Check if the child is compatible with the current result for the slots.
      switch (compareRequireStatic(childResult.config, slotsResult.config)) {
        case Comparison.Compatible: {
          // 'auto' is compatible with anything, but if the current result is 'auto' and the new one isn't,
          // we want to use the more specific result.
          if (slotsResult.config === 'auto' && childResult.config !== 'auto') {
            slotsResult = childResult
            slotResultKey = parallelRouteKey
          }
          break
        }
        case Comparison.Incompatible:
        case Comparison.LessConstrained:
        case Comparison.MoreConstrained: {
          throw new Error(
            `Parallel slots cannot have incompatible \`unstable_requireStatic\`.` +
              `\n  ${formatParallelSlot(slotResultKey!)}: ` +
              `\n    ${formatRequireStaticExport(slotsResult.config)}` +
              `\n    (from: ${slotsResult.filePath})` +
              `\n` +
              `\n  ${formatParallelSlot(parallelRouteKey)}: ` +
              `\n    ${formatRequireStaticExport(childResult.config)}` +
              `\n    (from: ${childResult.filePath})` +
              `\n` +
              `\n Possible fixes:` +
              `\n - Remove one of the \`unstable_requireStatic\` exports` +
              `\n - Change one of the  \`unstable_requireStatic\` exports to match the other`
          )
        }
      }
    }
  }

  // Child segments can override the config from the parent with a more constrained value,
  // but they cannot have a less constrained value.
  if (!slotsResult) {
    return parentResult
  } else {
    const comparison = compareRequireStatic(
      slotsResult.config,
      parentResult.config
    )
    switch (comparison) {
      case Comparison.Compatible: {
        // 'auto' is compatible with anything, but if the parent result is 'auto' and the slots one isn't,
        // we want to use the more constrained result.
        if (parentResult.config === 'auto' && slotsResult.config !== 'auto') {
          return slotsResult
        } else {
          return parentResult
        }
      }
      case Comparison.MoreConstrained: {
        return slotsResult
      }
      case Comparison.LessConstrained:
      case Comparison.Incompatible: {
        throw new Error(
          (comparison === Comparison.LessConstrained
            ? `A child segment cannot override a parent segment with a less-constrained \`unstable_requireStatic\`.`
            : `A child segment cannot override a parent segment with an incompatible \`unstable_requireStatic\`.`) +
            `\n  Parent has: ` +
            `\n    ${formatRequireStaticExport(parentResult.config)}` +
            `\n    (from: ${parentResult.filePath})` +
            `\n  Child has: ` +
            `\n    ${formatRequireStaticExport(slotsResult.config)}` +
            `\n    (from: ${slotsResult.filePath})` +
            `\n` +
            `\n Possible fixes:` +
            `\n - Remove one of the \`unstable_requireStatic\` exports` +
            `\n - Change one of the  \`unstable_requireStatic\` exports to match the other`
        )
      }
    }
  }
}

function formatParallelSlot(slot: string) {
  return slot === 'children' ? slot : `@${slot}`
}

function formatRequireStaticExport(config: RequireStatic) {
  return `export const unstable_requireStatic = ${JSON.stringify(config)}`
}

enum Comparison {
  LessConstrained = 1,
  Compatible = 2,
  MoreConstrained = 3,
  Incompatible = 4,
}

const REQUIRE_STATIC_ORDER: Exclude<RequireStatic, 'auto' | false>[] = [
  'shell',
  'prefetch',
  'navigation',
]

function compareRequireStatic(
  left: RequireStatic,
  right: RequireStatic
): Comparison {
  // 'auto' is compatible with everything.
  if (left === 'auto' || right === 'auto') return Comparison.Compatible

  // `false` is compatible with false.
  if (left === false && right === false) return Comparison.Compatible
  // If only one of the values is `false` (we know it's not both), it's incompatible.
  if (left === false || right === false) return Comparison.Incompatible

  const leftSort = REQUIRE_STATIC_ORDER.indexOf(left)
  const rightSort = REQUIRE_STATIC_ORDER.indexOf(right)
  return leftSort < rightSort
    ? Comparison.LessConstrained
    : leftSort === rightSort
      ? Comparison.Compatible
      : Comparison.MoreConstrained
}

function getRequireStaticConfigForModule(
  mod: Record<string, any> | undefined
): RequireStatic {
  return (
    (mod ? (mod as AppSegmentConfig).unstable_requireStatic : undefined) ??
    'auto'
  )
}
