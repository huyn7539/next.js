import { nextTestSetup } from 'e2e-utils'
import fs from 'fs-extra'
import path from 'path'
import { retry, waitForNoRedbox } from 'next-test-utils'
;(process.env.IS_TURBOPACK_TEST ? describe : describe.skip)(
  'turbopack additional roots',
  () => {
    const { next, isNextDev } = nextTestSetup({
      files: __dirname,
      skipStart: true,
    })

    let externalRoot: string
    let linkedPackage: string
    let siblingPackage: string
    let linkedModule: string

    beforeAll(async () => {
      externalRoot = `${next.testDir}-additional-root`
      linkedPackage = path.join(externalRoot, 'packages', 'linked')
      siblingPackage = path.join(externalRoot, 'node_modules', 'sibling')
      linkedModule = path.join(linkedPackage, 'index.js')

      await fs.outputJson(path.join(linkedPackage, 'package.json'), {
        name: 'linked',
        version: '1.0.0',
        main: 'index.js',
      })
      await fs.outputFile(
        linkedModule,
        `const sibling = require('sibling')
const { formatUrl } = require('next/dist/shared/lib/router/utils/format-url')
module.exports = { value: \`linked-\${sibling.value}-\${formatUrl({ pathname: '/next-plugin' })}\` }
`
      )
      await fs.outputJson(path.join(siblingPackage, 'package.json'), {
        name: 'sibling',
        version: '1.0.0',
        main: 'index.js',
      })
      await fs.outputFile(
        path.join(siblingPackage, 'index.js'),
        `module.exports = { value: 'initial' }
`
      )

      await fs.ensureDir(path.join(next.testDir, 'node_modules'))
      await fs.symlink(
        linkedPackage,
        path.join(next.testDir, 'node_modules', 'linked'),
        'junction'
      )

      const relativeExternalRoot = path.relative(next.testDir, externalRoot)
      await fs.writeFile(
        path.join(next.testDir, 'next.config.js'),
        `module.exports = {
  turbopack: {
    additionalRoots: {
      linkedPackages: { path: ${JSON.stringify(relativeExternalRoot)} },
      missingOptional: { path: './missing-optional-root', ignoreIfMissing: true },
    },
  },
}
`
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
    ;(isNextDev ? it : it.skip)(
      'tracks updates in an additional root',
      async () => {
        const browser = await next.browser('/')

        await fs.writeFile(
          linkedModule,
          `const sibling = require('sibling')
const { formatUrl } = require('next/dist/shared/lib/router/utils/format-url')
module.exports = { value: \`updated-\${sibling.value}-\${formatUrl({ pathname: '/next-plugin' })}\` }
`
        )

        await retry(async () => {
          await waitForNoRedbox(browser)
          expect(await browser.elementByCss('#value').text()).toBe(
            'updated-initial-/next-plugin'
          )
        })
      }
    )
  }
)
