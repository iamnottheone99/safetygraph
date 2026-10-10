# Contributing to SafetyGraph

Thank you for contributing to SafetyGraph! This guide outlines the branching strategy, development lifecycle, and quality standards for this repository.

---

## 🌿 Branching Strategy: GitHub Flow

SafetyGraph follows **GitHub Flow**. All new work—whether features, bug fixes, or chores—must be developed on short-lived feature branches and merged into `main` via a Pull Request.

### Branch Naming Conventions

All branch names should be lowercase and hyphen-separated, prefixed by the category:

| Prefix | Description | Example |
| :--- | :--- | :--- |
| `feat/` | New capabilities or user-facing features | `feat/qdrant-vector-store` |
| `fix/` | Bug fixes and patches | `fix/neo4j-socket-hang` |
| `refactor/` | Code refactoring without changing functionality | `refactor/system-one-pipeline` |
| `chore/` | Tooling, dependencies, CI/CD, or maintenance | `chore/repo-health-remediation` |
| `docs/` | Documentation additions or updates | `docs/architecture-diagram-guide` |
| `test/` | Adding or refactoring test suites | `test/circuit-breaker-load-test` |

---

## 🛠️ Development Lifecycle

### 1. Synchronize `main`
Always branch off the latest `main`:
```bash
git checkout main
git pull origin main
```

### 2. Create a Feature Branch
```bash
git checkout -b feat/your-feature-name
```

### 3. Implement & Verify Locally
Ensure your code complies with formatting, linting, build, and test requirements:
```bash
# Type check and compile
npm run build

# Check code formatting & linting
npm run lint

# Automatically format code if needed
npm run format

# Run test suite with coverage
npm run test:coverage
```

### 4. Commit using Conventional Commits
Use standard prefixes for commit messages:
```bash
git commit -m "feat: add support for Qdrant vector backend"
git commit -m "fix: handle offline Neo4j fallback without latency"
git commit -m "chore: upgrade dependencies and update lockfile"
```

### 5. Push and Open a Pull Request
Push your branch to GitHub:
```bash
git push -u origin feat/your-feature-name
```
Open a Pull Request against `main`. All CI checks (Build, ESLint, Test Matrix on Node 18, 20, 22) must pass before merging.

### 6. Merge Strategy
Merge using **Squash and Merge** to maintain a clean, linear git history on `main`. Once merged, delete the feature branch.
