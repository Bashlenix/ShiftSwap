import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/', '**/coverage/', '**/node_modules/', '.venv/', '.superpowers/', 'docs/'],
  },
  ...tseslint.configs.recommended,
  prettier,
);
