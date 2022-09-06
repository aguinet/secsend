module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    "no-constant-condition": ["error", { "checkLoops": false }]
  },
  "overrides": [
    {
      "files": ["**/*.tsx", "**/*.ts"],
      "extends": "plugin:@typescript-eslint/recommended",
      "rules": {
        "semi": [2, "always"],
        "@typescript-eslint/ban-ts-ignore": 0,
        "@typescript-eslint/ban-types": 1,
        "@typescript-eslint/ban-ts-comment": 0,
        "@typescript-eslint/no-var-requires": 0,
        "@typescript-eslint/prefer-interface": 0,
        "@typescript-eslint/explicit-function-return-type": 0,
        "@typescript-eslint/explicit-module-boundary-types": 0,
        "@typescript-eslint/no-empty-function": 0,
        "@typescript-eslint/no-explicit-any": 0,
        "@typescript-eslint/indent": [
          2,
          2,
          {
            "SwitchCase": 0
          }
        ],
      }
    }
  ]
};
