import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.wrangler', 'public/sw.js', 'scripts/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      // Simulation must be deterministic: no unseeded randomness, wall-clock or
      // platform-dependent maths. See CLAUDE.md "Seeded randomness".
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG (src/sim/prng.ts).' },
        { object: 'Math', property: 'sin', message: 'Use dsin from src/sim/dmath.ts.' },
        { object: 'Math', property: 'cos', message: 'Use dcos from src/sim/dmath.ts.' },
        { object: 'Math', property: 'atan2', message: 'Use datan2 from src/sim/dmath.ts.' },
        { object: 'Math', property: 'pow', message: 'Platform-dependent; use multiplication.' },
        { object: 'Math', property: 'exp', message: 'Platform-dependent in the sim.' },
        { object: 'Math', property: 'log', message: 'Platform-dependent in the sim.' },
        { object: 'Date', property: 'now', message: 'Sim time comes from the tick counter.' },
        { object: 'performance', property: 'now', message: 'Sim time comes from the tick counter.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
