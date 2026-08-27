import { nextTestSetup } from 'e2e-utils'
import fs from 'fs-extra'
import path from 'path'
import { retry } from 'next-test-utils'
;(process.env.IS_TURBOPACK_TEST ? describe : describe.skip)(
  'turbopack additional roots',
  () => {
    const { next, isNextDev } = nextTestSetup({
      files: __dirname,
      subDir: 'project',
      nextConfig: {
        turbopack: {
          additionalRoots: {
            linkedPackages: { path: '../additional-root' },
            missingOptional: {
              path: './missing-optional-root',
              ignoreIfMissing: true,
            },
          },
        },
      },
      skipStart: true,
    })

    let externalRoot: string
    let linkedPackage: string

    beforeAll(async () => {
      externalRoot = path.resolve(next.testDir, '../additional-root')
      linkedPackage = path.join(externalRoot, 'packages', 'linked')

      await fs.copy(
        path.join(__dirname, 'fixtures', 'additional-root'),
        externalRoot
      )

      await fs.symlink(
        linkedPackage,
        path.join(next.testDir, 'linked'),
        'junction' // use a junction point on windows (this argument is ignored everywhere else)
      )

      await next.start()
    })

    afterAll(async () => {
      await next.stop()
      await fs.remove(externalRoot)
    })

    it('resolves a linked package, sibling dependency, and next/dist', async () => {
      const browser = await next.browser('/')

      expect(await browser.elementByCss('#value').text()).toBe(
        'linked-initial-/next-plugin'
      )
    })

    if (isNextDev) {
      it('tracks updates in an additional root', async () => {
        const browser = await next.browser('/')

        await next.patchFile(
          '../additional-root/packages/linked/index.js',
          (content) => content.replace('linked-', 'updated-'),
          async () => {
            await retry(async () => {
              expect(await browser.elementByCss('#value').text()).toBe(
                'updated-initial-/next-plugin'
              )
            })
          }
        )
      })
    }
  }
)
