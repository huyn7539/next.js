import { nextTestSetup } from 'e2e-utils'
import { RequireStatic } from 'next/dist/build/segment-config/app/app-segment-config'

const NOT_IMPLEMENTED_VALUES: RequireStatic[] = ['navigation']

describe('require-static-config-validation', () => {
  const { next, isNextStart, skipped } = nextTestSetup({
    files: __dirname,
    skipStart: true,
    skipDeployment: true, // Build-time validation
  })

  if (skipped) return

  // TODO: validate in dev
  if (!isNextStart) {
    it.skip('skipped in dev')
    return
  }

  beforeAll(async () => {
    if (isNextStart) {
      const args = ['--experimental-build-mode', 'compile']
      await next.build({ args })
    }
  })

  const prerenderPattern = async (pattern: string) => {
    const args = [
      '--experimental-build-mode',
      'generate',
      '--debug-build-paths',
      pattern,
    ]
    const result = await next.build({ args })
    if (
      result.cliOutput.includes(`Pattern "${pattern}" did not match any files`)
    ) {
      throw new Error(`Pattern "${pattern}" did not match any files`)
    }
    return result
  }

  describe('nesting unstable_requireStatic', () => {
    const ALWAYS_ALLOWED_NESTINGS = [
      [undefined, true],
      ['auto', true],
    ] as const

    const ANYTHING_CAN_BE_NESTED = new Map<RequireStatic | undefined, boolean>([
      // Everything can be nested under undefined.
      [undefined, true],
      ['auto', true],
      ['shell', true],
      ['prefetch', true],
      ['navigation', true],
      [false, true],
    ])

    const isNestingValid = new Map<
      RequireStatic,
      Map<RequireStatic | undefined, boolean>
    >([
      [undefined, ANYTHING_CAN_BE_NESTED],
      ['auto', ANYTHING_CAN_BE_NESTED],
      [
        'shell',
        new Map<RequireStatic | undefined, boolean>([
          ...ALWAYS_ALLOWED_NESTINGS,
          // Only `"shell"`, `"prefetch"`, or `"navigation"`.
          ['shell', true],
          ['prefetch', true],
          ['navigation', true],
          [false, false],
        ]),
      ],
      [
        'prefetch',
        new Map<RequireStatic | undefined, boolean>([
          // Only `"prefetch"` or `"navigation"`.
          ...ALWAYS_ALLOWED_NESTINGS,
          ['shell', false],
          ['prefetch', true],
          ['navigation', true],
          [false, false],
        ]),
      ],
      [
        'navigation',
        new Map<RequireStatic | undefined, boolean>([
          ...ALWAYS_ALLOWED_NESTINGS,
          // Only `"navigation"`.
          ['shell', false],
          ['prefetch', false],
          ['navigation', true],
          [false, false],
        ]),
      ],
      [
        false,
        new Map<RequireStatic | undefined, boolean>([
          ...ALWAYS_ALLOWED_NESTINGS,
          // Only `false` can be nested under `false`.
          ['shell', false],
          ['prefetch', false],
          ['navigation', false],
          [false, true],
        ]),
      ],
    ])

    const nestingCases: {
      parent: RequireStatic | undefined
      child: RequireStatic | undefined
      isValid: boolean
    }[] = []
    for (const [parent, options] of isNestingValid) {
      for (const [child, isValid] of options) {
        nestingCases.push({ parent, child, isValid })
      }
    }
    describe.each(
      [...isNestingValid].map(([parent, options]) => ({ parent, options }))
    )('parent: $parent', ({ parent, options }) => {
      it.each([...options].map(([child, isValid]) => ({ child, isValid })))(
        'child: $child is accepted: $isValid',
        async ({ child, isValid }) => {
          const result = await prerenderPattern(
            `app/nested/parent-${parent}/child-${child}/page.tsx`
          )
          if (isValid) {
            // Valid nestings for options that aren't implemented yet still error.
            if (
              NOT_IMPLEMENTED_VALUES.includes(parent) ||
              NOT_IMPLEMENTED_VALUES.includes(child)
            ) {
              expect(result.exitCode).toBe(1)
              expect(result.cliOutput).toMatch(
                /Error: `export const unstable_requireStatic = .+?` is not implemented yet./
              )
            } else {
              // Valid nestings should pass.
              expect(result.exitCode).toBe(0)
            }
          } else {
            // Invalid nestings should error.
            expect(result.exitCode).toBe(1)
            expect(result.cliOutput).toContain(
              // `false` has a dedicated error message.
              parent === false || child === false
                ? `Error: A child segment cannot override a parent segment with an incompatible \`unstable_requireStatic\`.`
                : `Error: A child segment cannot override a parent segment with a less-constrained \`unstable_requireStatic\`.`
            )
          }
        }
      )
    })
  })

  describe('unstable_requireStatic in sibling slots', () => {
    it.each<{
      left: RequireStatic | undefined
      right: RequireStatic | undefined
      isValid: boolean
    }>([
      // Compatible
      { left: undefined, right: 'prefetch', isValid: true },
      { left: 'auto', right: 'prefetch', isValid: true },
      { left: 'prefetch', right: 'prefetch', isValid: true },
      { left: false, right: false, isValid: true },
      // Incompatible
      { left: 'prefetch', right: 'shell', isValid: false },
      { left: 'shell', right: 'prefetch', isValid: false },
      { left: 'prefetch', right: false, isValid: false },
    ])(
      'left: $left, right: $right is accepted: $isValid',
      async ({ left, right, isValid }) => {
        const result = await prerenderPattern(
          `app/sibling-slots/left-${left}-right-${right}/*/page.tsx`
        )
        if (isValid) {
          // Valid combinations of options that aren't implemented yet still error.
          if (
            NOT_IMPLEMENTED_VALUES.includes(left) ||
            NOT_IMPLEMENTED_VALUES.includes(right)
          ) {
            expect(result.exitCode).toBe(1)
            expect(result.cliOutput).toMatch(
              /Error: `export const unstable_requireStatic = .+?` is not implemented yet./
            )
          } else {
            // Valid combinations should pass.
            expect(result.exitCode).toBe(0)
          }
        } else {
          // Invalid combinations should error.
          expect(result.exitCode).toBe(1)
          expect(result.cliOutput).toContain(
            `Parallel slots cannot have incompatible \`unstable_requireStatic\`.`
          )
        }
      }
    )
  })
})
