/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                module: 'commonjs',
                target: 'ES2020',
                esModuleInterop: true,
                strict: false,
                skipLibCheck: true
            }
        }]
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts'
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 60000,
    maxWorkers: 1
};
