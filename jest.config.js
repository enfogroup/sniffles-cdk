module.exports = {
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  collectCoverageFrom: [
    'lib/**/*.ts'
  ],
  verbose: true,
  reporters: ['default']
}
process.env.ENFO_ENV_VARS_DISABLE_REQUIRED = 'true'
