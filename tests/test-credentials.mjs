export const TEST_PASSWORD = process.env.OAOAO_TEST_PASSWORD

if (!TEST_PASSWORD) {
  throw new Error('Set OAOAO_TEST_PASSWORD for the isolated local test administrator before running authenticated tests.')
}
