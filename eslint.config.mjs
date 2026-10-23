import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/coverage/',
      'apps/api/src/generated/',
      '**/node_modules/',
      '.venv/',
      '.superpowers/',
      'docs/',
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
);
