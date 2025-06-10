import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  stylistic: {
    braceStyle: '1tbs',
  },
  jsonc: false,
  yaml: false,

  rules: {
    'no-console': 'off',
    'unused-imports/no-unused-imports': 'off',
    'unused-imports/no-unused-vars': 'off',
    'node/prefer-global/process': 'off',
    'ts/ban-ts-comment': 'off',
    'style/brace-style': ['off', '1tbs', { allowSingleLine: false }],
    'node/prefer-global/buffer': 'off',
    'ts/consistent-type-imports': 'off',
  },
})
