# Agent Guidelines

## Version Management

When creating a new version of the app, always update the version number using:

```bash
./scripts/bump-version.sh <new-version>
```

This updates both `package.json` and `src/version.ts` to keep them in sync.
The version is displayed in the settings panel header (upper right).

A Git pre-commit hook verifies that the two version files stay in sync and
will reject commits if they diverge.
