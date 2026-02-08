# FAF CLI: B+ → A+ Implementation Plan

**For:** OpenAI Codex / AI Agent Execution
**Repository:** /Users/paulcowen/ClaudeProjects/faf-cli
**Branch:** Create `feat/a-plus-quality` from current HEAD
**Runtime:** Bun (NOT npm/yarn/pnpm)
**Build:** `bun run build` (runs `tsc`)
**Test:** `bun run test` (runs Jest via `jest --config jest.config.js`)

---

## Pre-Work

Before starting any task:
1. `cd /Users/paulcowen/ClaudeProjects/faf-cli`
2. `git checkout -b feat/a-plus-quality`
3. `bun run build` — confirm clean build
4. `bun run test` — note which tests currently pass

---

## Task 1: Import TYPE_DEFINITIONS from Compiler (CRITICAL)

**Files:** `src/generators/faf-generator-championship.ts`, `src/compiler/faf-compiler.ts`

**Problem:** The generator maintains its own `TYPE_APPLICABLE_CATEGORIES` (lines ~65-127) that diverges from the compiler's `TYPE_DEFINITIONS`. The generator uses `universal_core` and `universal_infra` as distinct categories; the compiler uses a single `universal` category. Many project types in the compiler are missing from the generator.

**Steps:**

1. Read `src/compiler/faf-compiler.ts` and find `TYPE_DEFINITIONS` and the `getSlotsForType` function (or equivalent that maps project types to slot categories).

2. In `src/compiler/faf-compiler.ts`, export `TYPE_DEFINITIONS` if not already exported:
   ```typescript
   export const TYPE_DEFINITIONS = { ... };
   ```

3. In `src/generators/faf-generator-championship.ts`:
   - Import `TYPE_DEFINITIONS` from the compiler
   - Delete the entire `TYPE_APPLICABLE_CATEGORIES` object (lines ~65-127)
   - Rewrite `getApplicableSlots()` to use the compiler's type definitions
   - The compiler uses category names like `'project'`, `'frontend'`, `'backend'`, `'universal'`, `'human'`. The generator splits `universal` into `universal_core` and `universal_infra`. Either:
     - (a) Map the compiler's `'universal'` to both `universal_core` and `universal_infra` in the generator, OR
     - (b) Collapse the generator's split back to a single `'universal'` category
   - Option (a) is preferred to preserve the finer-grained scoring we built
   - Add a mapping function:
     ```typescript
     function compilerCategoryToGeneratorCategories(compilerCat: string): string[] {
       if (compilerCat === 'universal') return ['universal_core', 'universal_infra'];
       return [compilerCat];
     }
     ```

4. Update `SLOT_CATEGORY_MAP` if needed to align with the compiler's slot names.

5. Verify: `bun run build` must succeed. Run `bun run test`.

6. Manual verification: The function `inferProjectType()` + `getApplicableSlots()` should now cover ALL types that exist in the compiler's `TYPE_DEFINITIONS`, not just the ~20 that were manually listed.

---

## Task 2: Replace Custom YAML Serializer with `yaml` Package (CRITICAL)

**Files:** `src/utils/yaml-generator.ts`

**Problem:** The custom `objectToYaml` function (lines ~175-211) produces invalid YAML for edge cases: unquoted booleans (`Yes` → `true`), numeric strings, null strings, nested quotes in arrays.

**Steps:**

1. Check that the `yaml` package is available: `ls node_modules/yaml/` or check `package.json` dependencies.

2. If not installed: `bun add yaml`

3. In `src/utils/yaml-generator.ts`:
   - Add `import YAML from 'yaml';` at the top
   - Replace the `objectToYaml` function body with:
     ```typescript
     export function objectToYaml(obj: Record<string, any>, indent: number = 0): string {
       return YAML.stringify(obj, { indent: 2, lineWidth: 0 });
     }
     ```
   - If the existing callers pass an `indent` parameter, adjust the wrapper to handle indentation offset
   - The `yaml` library handles all edge cases (boolean quoting, special characters, multiline strings, null values)

4. Fix `escapeForYaml` (line ~48): Change `if (!value)` to `if (value === undefined || value === null)` so empty strings are preserved instead of becoming `null`.

5. Verify: `bun run build` && `bun run test`. Then run `faf init` against a test project and diff the output YAML to confirm it's still valid and equivalent.

---

## Task 3: Add HTTP Timeout to AI Calls (CRITICAL)

**File:** `src/engines/ai-readme-analyzer.ts`

**Problem:** `fetch()` calls to OpenRouter have no timeout. If the API hangs, the CLI hangs for up to 14 minutes.

**Steps:**

1. Find all `fetch()` calls in the file (should be in `callOpenRouter` method, lines ~129-142).

2. Add AbortController with 10-second timeout:
   ```typescript
   const controller = new AbortController();
   const timeoutId = setTimeout(() => controller.abort(), 10000);
   try {
     const response = await fetch(url, {
       ...existingOptions,
       signal: controller.signal,
     });
     clearTimeout(timeoutId);
     // ... rest of handler
   } catch (error) {
     clearTimeout(timeoutId);
     if (error instanceof Error && error.name === 'AbortError') {
       // timeout — try next model
       continue;
     }
     throw error;
   }
   ```

3. Also add a total operation timeout of 30 seconds around the entire model fallback loop.

4. Apply the same pattern to the `callAnthropic` method if it uses fetch.

5. Verify: `bun run build`.

---

## Task 4: Add Symlink Protection + File Count Limits (CRITICAL)

**File:** `src/engines/local-project-scanner.ts`

**Problem:** `walkDirectory` (lines ~314-342) has no symlink check, no depth limit, and no file count limit. Symlink cycles cause infinite recursion. Massive repos cause OOM.

**Steps:**

1. Add constants at the top of the file:
   ```typescript
   const MAX_FILES = 50000;
   const MAX_DEPTH = 20;
   ```

2. In the `walkDirectory` method, add parameters:
   ```typescript
   private async walkDirectory(
     dir: string,
     languageBytes: Map<string, number>,
     depth: number = 0,
     fileCount: { count: number } = { count: 0 }
   ): Promise<void> {
   ```

3. At the start of the method, add guards:
   ```typescript
   if (depth > MAX_DEPTH) return;
   if (fileCount.count >= MAX_FILES) return;
   ```

4. Before `entry.isDirectory()` check, add symlink check:
   ```typescript
   if (entry.isSymbolicLink()) continue;
   ```

5. Increment file count when processing a file:
   ```typescript
   fileCount.count++;
   ```

6. Pass `depth + 1` and `fileCount` to recursive calls.

7. Verify: `bun run build` && `bun run test`.

---

## Task 5: Rebalance Scoring System (CRITICAL)

**File:** `src/generators/faf-generator-championship.ts`

**Problem:** Bonuses (FAB-FORMATS +20, intelligence +15, TypeScript +10 = 45 max) can overpower slot-based scoring (86 max). A project with 50% slot fill but good bonuses scores the same as 100% fill.

**Steps:**

1. Find the bonus section (lines ~816-848).

2. Restructure so slot-based score = 80% weight, bonuses = 20% max:
   ```typescript
   // Slot-based score (0-80 points)
   const slotScore = (totalFilled / totalApplicable) * 80;

   // Bonus score (0-20 points max)
   let bonusScore = 0;
   // FAB-FORMATS: max +8
   // Intelligence depth: max +7
   // TypeScript: max +5
   bonusScore = Math.min(bonusScore, 20);

   const enhancedScore = Math.min(Math.round(slotScore + bonusScore), 99);
   ```

3. Adjust the individual bonus values proportionally:
   - FAB-FORMATS grade: S→+8, A→+6, B→+4, C→+2, D→+1
   - Intelligence depth: has AI analysis→+4, has README→+2, has scanner data→+1
   - TypeScript bonus: +3 for tsconfig, +2 for strict mode

4. Verify: `bun run build`. Test against whisper.cpp, MiroBoardDuplicator, PDFtoMarkdown directories if available. Scores should still be reasonable (don't need exact same numbers, but they should reflect actual context quality).

---

## Task 6: Validate Generated YAML Against Schema (HIGH)

**Files:** `src/utils/yaml-generator.ts`, `src/schema/faf-schema.ts`

**Problem:** Generated YAML is never parsed back or validated against the existing FafSchema.

**Steps:**

1. Read `src/schema/faf-schema.ts` to understand the schema validator API.

2. At the end of `generateFafContent()` in `yaml-generator.ts`, add validation:
   ```typescript
   import YAML from 'yaml';
   import { validateSchema } from '../schema/faf-schema';

   // After generating yamlContent string:
   try {
     const parsed = YAML.parse(yamlContent);
     const validation = validateSchema(parsed);
     if (!validation.valid) {
       console.warn('Generated YAML has schema issues:', validation.errors);
     }
   } catch (parseError) {
     console.error('Generated YAML is not valid YAML:', parseError);
   }
   ```

3. This is a warning, not a blocker — don't throw errors, just log warnings so users can report issues.

4. Verify: `bun run build` && `bun run test`.

---

## Task 7: Add Tests for New Code (HIGH)

**Files:** Create `tests/local-project-scanner.test.ts`, `tests/ai-readme-analyzer.test.ts`, `tests/type-inference.test.ts`

**Steps:**

### 7a. Scanner tests (`tests/local-project-scanner.test.ts`)

```typescript
import { LocalProjectScanner } from '../src/engines/local-project-scanner';

describe('LocalProjectScanner', () => {
  describe('walkDirectory', () => {
    it('should skip symlinks', async () => { /* ... */ });
    it('should respect MAX_FILES limit', async () => { /* ... */ });
    it('should respect MAX_DEPTH limit', async () => { /* ... */ });
    it('should skip directories in SKIP_DIRS', async () => { /* ... */ });
  });

  describe('language detection', () => {
    it('should detect .ts files as TypeScript', async () => { /* ... */ });
    it('should skip .min.js files', async () => { /* ... */ });
    it('should attribute .h to C++ when .cpp files exist', async () => { /* ... */ });
  });

  describe('scanTopLevelStructure', () => {
    it('should skip __pycache__ directories', async () => { /* ... */ });
    it('should skip .bak files', async () => { /* ... */ });
    it('should skip files over 1MB', async () => { /* ... */ });
  });
});
```

Use `test-fixtures/` directory for test projects if it exists, or create minimal fixtures.

### 7b. Type inference tests (`tests/type-inference.test.ts`)

Test `inferProjectType()` and `getApplicableSlots()`:
```typescript
describe('inferProjectType', () => {
  it('should detect C++ library from scan data', () => { /* ... */ });
  it('should detect Python tool with no setup files', () => { /* ... */ });
  it('should fall back to original type when nothing else matches', () => { /* ... */ });
});

describe('getApplicableSlots', () => {
  it('should return all categories for full-stack type', () => { /* ... */ });
  it('should exclude frontend/backend for tool type', () => { /* ... */ });
  it('should default to all categories for unknown type', () => { /* ... */ });
});
```

### 7c. AI analyzer tests (`tests/ai-readme-analyzer.test.ts`)

Test `parseAIResponse()` (the JSON extraction logic):
```typescript
describe('parseAIResponse', () => {
  it('should parse clean JSON', () => { /* ... */ });
  it('should extract JSON from markdown code block', () => { /* ... */ });
  it('should handle malformed AI responses gracefully', () => { /* ... */ });
  it('should return null for empty responses', () => { /* ... */ });
});
```

Note: Don't test actual API calls (those need mocking or are integration tests). Focus on the parsing/extraction logic.

Verify: `bun run test` — all new tests should pass.

---

## Task 8: Fix .min.js Detection (HIGH)

**File:** `src/engines/local-project-scanner.ts`

**Problem:** `path.extname('foo.min.js')` returns `.js`, not `.min.js`. Entries `.min.js` and `.min.css` in SKIP_EXTENSIONS never match.

**Steps:**

1. In the `walkDirectory` method, before the extension lookup, add:
   ```typescript
   const basename = path.basename(filePath);
   if (basename.includes('.min.')) continue;
   ```

2. Optionally remove `.min.js` and `.min.css` from SKIP_EXTENSIONS to avoid confusion.

3. Verify: `bun run build` && `bun run test`.

---

## Task 9: Fix .h File Attribution (HIGH)

**File:** `src/engines/local-project-scanner.ts`

**Problem:** `.h` files are unconditionally attributed to C, even in C++ projects.

**Steps:**

1. In the language detection, after the full walk is complete, check if `.cpp`, `.cc`, `.cxx` files were found.

2. If C++ files exist and C is detected (from `.h` files), move C's byte count to C++:
   ```typescript
   // After walkDirectory completes:
   if (languageBytes.has('C++') && languageBytes.has('C')) {
     const cBytes = languageBytes.get('C') || 0;
     const cppBytes = languageBytes.get('C++') || 0;
     languageBytes.set('C++', cppBytes + cBytes);
     languageBytes.delete('C');
   }
   ```

3. Verify: `bun run build` && `bun run test`.

---

## Task 10: Clean Up Dead Code and Type Safety (MEDIUM)

**File:** `src/generators/faf-generator-championship.ts`

**Steps:**

1. Delete the `extractReadmeContext` function (lines ~955-984) — it's never called.

2. Delete unused variables `_confidence` and `_stack` and their computation blocks.

3. Define a `ContextSlots` type:
   ```typescript
   type SlotKey = 'project_name' | 'project_goal' | 'main_language' | 'framework' |
     'backend' | 'server' | 'api_type' | 'database' | 'package_manager' |
     'test_framework' | 'hosting' | 'cicd' | 'build_tool' | 'linter' |
     'who' | 'what' | 'why' | 'where' | 'when' | 'how';

   type ContextSlots = Partial<Record<SlotKey, string>>;
   ```

4. Change `contextSlotsFilled: Record<string, any>` to `contextSlotsFilled: ContextSlots`.

5. Fix other prominent `any` types where the actual type is obvious.

6. Verify: `bun run build` — TypeScript will catch any typos in slot names now.

---

## Task 11: Miscellaneous Fixes (MEDIUM)

### 11a. Use system/user message separation for AI analysis

**File:** `src/engines/ai-readme-analyzer.ts`

Change the prompt structure so extraction instructions go in `system` role and README content goes in `user` role (prevents prompt injection from malicious READMEs).

### 11b. Fix unconditional `open-source` tag

**File:** `src/utils/yaml-generator.ts`

Change line ~163 to only add `'open-source'` if a recognized open-source license is detected:
```typescript
if (projectData.license && !['proprietary', 'unlicensed'].includes(projectData.license.toLowerCase())) {
  smartTags.push('open-source');
}
```

### 11c. Deduplicate SKIP_DIRS

**File:** `src/engines/local-project-scanner.ts`

Extract shared base set between `SKIP_DIRS` and `SKIP_STRUCTURE_DIRS`:
```typescript
const BASE_SKIP_DIRS = new Set([...]);
const SKIP_DIRS = new Set([...BASE_SKIP_DIRS, /* walk-specific */]);
const SKIP_STRUCTURE_DIRS = new Set([...BASE_SKIP_DIRS, /* structure-specific */]);
```

### 11d. Fix hardcoded README.md path

**File:** `src/generators/faf-generator-championship.ts`

Change line ~418 from:
```typescript
const readmePath = path.join(projectRoot, 'README.md');
```
To use the scanner's detected readme path:
```typescript
const readmePath = scanResult?.readmePath || path.join(projectRoot, 'README.md');
```
(May need to add `readmePath` to the scanner's return type.)

Verify: `bun run build` && `bun run test`.

---

## Task 12: Update CHANGELOG (FINAL)

**File:** `CHANGELOG.md`

Add entry at the top (after the header):

```markdown
## [4.3.0] - 2026-02-XX — Quality & Correctness

### Fixed
- Import TYPE_DEFINITIONS from compiler instead of maintaining parallel copy
- Replace custom YAML serializer with `yaml` package for correct output
- Add 10-second HTTP timeout to all AI API calls
- Add symlink protection and 50k file limit to directory walker
- Rebalance scoring: slots=80% weight, bonuses=20% max
- Fix .min.js/.min.css detection (path.extname returns .js not .min.js)
- Fix .h file attribution to C++ when .cpp files exist in project
- Fix hardcoded README.md path to use scanner's detected readme
- Fix unconditional `open-source` tag for proprietary projects
- Separate system/user roles in AI prompt to prevent injection

### Added
- YAML schema validation on generated output (warns on issues)
- Tests for local-project-scanner, type-inference, ai-readme-analyzer
- ContextSlots type for type-safe slot access
- Symlink and depth guards in walkDirectory

### Removed
- Dead `extractReadmeContext` function
- Unused `_confidence` and `_stack` computations
- Duplicate SKIP_DIRS definitions (consolidated to shared base)
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `bun run build` — clean, no TypeScript errors
- [ ] `bun run test` — all tests pass (existing + new)
- [ ] Run `node dist/cli.js init` against a test project — produces valid YAML
- [ ] Parse the output YAML with `yaml` package — no parse errors
- [ ] Scores are reasonable (slot fill % dominates, bonuses don't overpower)
- [ ] No `any` types in new code (existing `any` types reduced where obvious)
- [ ] `git diff --stat` — review all changes before committing

---

## Commit Strategy

One commit per logical group:
1. `fix: import TYPE_DEFINITIONS from compiler, eliminate divergence`
2. `fix: replace custom YAML serializer with yaml package`
3. `fix: add HTTP timeout, symlink protection, file count limits`
4. `fix: rebalance scoring system (slots=80%, bonuses=20%)`
5. `feat: add YAML schema validation on generated output`
6. `test: add tests for scanner, type-inference, AI analyzer`
7. `refactor: type safety, dead code removal, deduplication`
8. `docs: update CHANGELOG for v4.3.0`

Or one combined commit if preferred:
```
feat: quality & correctness improvements for v4.3.0

- Import TYPE_DEFINITIONS from compiler (fixes scoring divergence)
- Replace custom YAML serializer with yaml package
- Add HTTP timeout, symlink protection, file count limits
- Rebalance scoring (slots=80%, bonuses=20%)
- Add YAML schema validation, tests, type safety
- Remove dead code, deduplicate skip lists
```
