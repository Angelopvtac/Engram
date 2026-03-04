# Contributing to Engram

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/<your-username>/engram.git
   cd engram
   npm install
   ```
3. Create a feature branch: `git checkout -b feature/my-feature`

## Development

```bash
npm run dev          # Watch mode (recompile on change)
npm run lint         # Type-check without emitting
npm test             # Run all tests
npm run test:watch   # Watch mode tests
npm run build        # Compile to dist/
```

## Code Style

- TypeScript strict mode -- all code must pass `tsc --noEmit` with zero errors
- ESM modules (`import`/`export`, no `require`)
- Follow existing patterns in the codebase

## Testing

- All new features need tests
- Tests live in `test/` and use Vitest
- Run `npm test` before submitting a PR
- Test naming: `test/<module>.test.ts`

## Pull Requests

- Reference any related issues
- Include tests for new functionality
- Keep PRs focused on a single concern
- Ensure CI passes (type-check + test + build on Node 20/22)

## Commit Messages

Use conventional commits:
- `feat: add new feature`
- `fix: resolve bug in X`
- `docs: update README`
- `test: add tests for Y`
- `refactor: improve Z`
