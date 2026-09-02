import { nextTestSetup, isNextDev, isNextStart } from 'e2e-utils'
// TODO(deploy-test-completion): This asserts local build/runtime output that
// deploy tests do not expose.
// @force-gate !deploy
// @force-gate !start || !turbopackDev
// @force-gate !dev || !turbopackBuild
describe('Catches Missing getStaticProps', () => {
  const errorRegex = /getStaticPaths was added without a getStaticProps in/

  const { next, isNextDeploy } = nextTestSetup({
    files: __dirname,
    skipStart: isNextStart,
  })

  if (isNextDeploy) {
    it('is excluded from deploy testing by @force-gate', () => {})
  }

  if (isNextDev) {
    it('should catch it in development mode', async () => {
      const html = await next.render('/hello')
      expect(html).toMatch(errorRegex)
    })
  }

  if (isNextStart) {
    it('should catch it in server build mode', async () => {
      const { cliOutput } = await next.build()
      expect(cliOutput).toMatch(errorRegex)
    })
  }
})
