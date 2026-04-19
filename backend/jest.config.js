module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/swagger.js',
  ],
  verbose: true,
  transformIgnorePatterns: [
    'node_modules/(?!(p-limit|yocto-queue|p-retry|retry)/)'
  ],
};
