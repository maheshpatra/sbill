/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@billflow/gst$': '<rootDir>/../packages/gst/src/index.ts',
    '^@billflow/upi$': '<rootDir>/../packages/upi/src/index.ts',
    '^@billflow/host-resolution$': '<rootDir>/../packages/host-resolution/src/index.ts',
    '^@billflow/types$': '<rootDir>/../packages/types/src/index.ts',
  },
};
