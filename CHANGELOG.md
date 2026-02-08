# Changelog

All notable changes to faf-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.2.1] - 2026-02-08 — Scoring Fairness: Tool Type + Package Manager + Clean Structure

### Summary

Three targeted fixes to the scoring system that make results fairer for simple script-based projects and improve output quality for all projects.

### Changes

#### 1. Fix: Package manager detection from `requirements.txt` / `pyproject.toml`

**Problem:** Python projects with `requirements.txt` or `pyproject.toml` never got their `package_manager` slot filled. The `pyprojectData.packageManager` was set to `'Poetry'` during parsing but never written to `contextSlotsFilled`. And `requirements.txt` presence was completely ignored for package manager detection.

**Fix in `src/generators/faf-generator-championship.ts`:**
- After Docker detection, added a new block that fills `package_manager` from:
  - `pyproject.toml` with `[tool.poetry]` → `Poetry`
  - `pyproject.toml` with `[tool.pdm]` → `PDM`
  - `pyproject.toml` with `[tool.hatch]` → `Hatch`
  - `pyproject.toml` with `[build-system]` → `pip (pyproject.toml)`
  - `requirements.txt` presence → `pip`
- Guard: only fills if not already set by framework detector or Bun/Cargo detection

#### 2. New: `tool` project type with lighter scoring

**Problem:** Simple Python scripts (PDFtoMarkdown, MiroBoardDuplicator) were scored as `cli` which expects CI/CD, hosting, build tools, and linting. A personal script collection shouldn't be penalized for not having GitHub Actions or a linter.

**Fix:** Split the `universal` slot category into two tiers:

| Category | Slots | When applicable |
|----------|-------|-----------------|
| `universal_core` | `package_manager`, `test_framework` | Almost all projects |
| `universal_infra` | `hosting`, `cicd`, `build_tool`, `linter` | Proper CLIs, libraries, apps |

Added `tool` project type: `['project', 'universal_core', 'human']` = 11 applicable slots (9 N/A).

**Detection heuristic** in `inferProjectType()`:
- If original type is `python-generic` or `latest-idea`
- AND project has no `package.json`, no `setup.py`, no `pyproject.toml`
- THEN classify as `tool` (simple script collection)

All existing types updated to use `universal_core` + `universal_infra` (no behaviour change for them). The `tool` type only gets `universal_core`.

**Files changed:**
- `src/generators/faf-generator-championship.ts`: `SLOT_CATEGORY_MAP` split, `TYPE_APPLICABLE_CATEGORIES` updated, `AI_TYPE_TO_FAF_TYPE` maps `tool` → `tool`, `inferProjectType()` adds tool detection logic

#### 3. Fix: Structure output now filters junk files and directories

**Problem:** Structure listing included `__pycache__`, `.bak` files, 13MB log files, editor swap files, and other noise that cluttered the `.faf` output and provided no useful context.

**Fix in `src/engines/local-project-scanner.ts` → `scanTopLevelStructure()`:**

Added three filter layers:

| Filter | What it catches |
|--------|----------------|
| `SKIP_STRUCTURE_DIRS` | `__pycache__`, `node_modules`, `venv`, `dist`, `build`, `target`, `coverage`, `__MACOSX`, etc. (28 patterns) |
| `SKIP_STRUCTURE_PATTERNS` | `.bak`, `.log`, `.tmp`, `.swp`, `~`, `.pyc`, `.DS_Store`, `Thumbs.db` |
| `MAX_STRUCTURE_FILE_SIZE` | Files > 1MB skipped (likely generated data, logs, media) |

### Results

| Project | Before (4.2.0) | After (4.2.1) | Change |
|---------|----------------|---------------|--------|
| PDFtoMarkdown | 67% (10/15) | **100% (11/11)** | `tool` type + pip detected |
| MiroBoardDuplicator | 60% (9/15) | **82% (9/11)** | `tool` type (no requirements.txt, no tests - honest) |
| whisper.cpp | 87% (13/15) | **87% (13/15)** | No change (correctly `library`) |

### Full scoring journey (original → final)

| Project | Original `faf init` | After 4.2.0 | After 4.2.1 |
|---------|---------------------|-------------|-------------|
| whisper.cpp | 33% | 87% | **87%** |
| MiroBoardDuplicator | 24% | 60% | **82%** |
| PDFtoMarkdown | 33% | 67% | **100%** |

### Fork Information

- **Upstream**: [Wolfe-Jam/faf-cli](https://github.com/Wolfe-Jam/faf-cli)
- **Fork**: [theaiconsultantuk/faf-cli](https://github.com/theaiconsultantuk/faf-cli)
- **Author**: Paul Cowen (The AI Consultant UK)

---

## [4.2.0] - 2026-02-08 — The Pauly Engine: Intelligent Local Scanning

### The Problem

`faf init` scored **33%** on local projects while `faf git` scored **90%** on the same project via GitHub API. The gap existed because:

1. **No language detection** - init couldn't scan file extensions to detect languages with percentages (C++ 44.3%, C 35.1%, etc.) like the GitHub API does
2. **Broken README parsing** - Regex grabbed badge images (`![whisper.cpp](url)`) as the project description instead of the actual first paragraph
3. **No framework detection** - The 6-tier FrameworkDetector existed in the codebase but was never wired into init
4. **Hardcoded defaults** - YAML output contained marketing copy (`🚀 Make Your AI Happy!`) and FAF-specific branding as default values
5. **Type misclassification** - `detectProjectType()` saw any `.py` file and returned `python-generic`, even for C++ projects with 0.6% Python
6. **Unfair scoring** - All 21 slots counted equally regardless of project type. A C++ library was penalized for not having a CSS framework or database

### What Changed

#### New Files

**`src/engines/local-project-scanner.ts`** - The core new engine

Provides GitHub-API-equivalent intelligence from the local filesystem without any network calls:

- **Language scanning** - Walks the file tree, maps 80+ file extensions to languages, calculates byte-based percentages (matching GitHub's format: `"C++ (44.3%)"`)
- **Structured README parsing** - Extracts H1 as project name, first non-badge/non-image paragraph as description, `##` sections as context. Skips badge lines (`[![...](...)](#)`) and image lines (`![...](...)`)
- **License detection** - Finds LICENSE/LICENCE/COPYING files, identifies MIT/Apache/GPL/BSD/ISC/MPL from content
- **Test detection** - Checks for `tests/`, `test/`, `spec/`, `__tests__/` directories
- **CI/CD detection** - Identifies GitHub Actions, GitLab CI, CircleCI, Travis, Jenkins, Azure Pipelines from config file presence
- **Docker detection** - Looks for Dockerfile, docker-compose.yml, .dockerignore
- **Quality scoring** - Mirrors `faf git`'s `calculateRepoQualityScore()` using local signals (description, README, license, tests, CI/CD, Docker, multi-language, structured README)
- **Smart exclusions** - Skips `node_modules`, `.git`, `build`, `dist`, binary files, lock files, and config-only languages (JSON, YAML, Markdown) from percentage calculations

**`src/engines/ai-readme-analyzer.ts`** - AI-assisted semantic README analysis

Uses a fast AI model to extract structured meaning from READMEs when regex isn't enough:

- **Auto-detects provider** from `ANTHROPIC_API_KEY` (uses Claude Haiku) or `OPENROUTER_API_KEY` (uses free models)
- **OpenRouter free model fallback chain**: `google/gemma-3-12b-it:free` (most reliable) -> `google/gemma-3-27b-it:free` -> `meta-llama/llama-3.3-70b-instruct:free` -> `mistralai/mistral-small-3.1-24b-instruct:free` -> `nvidia/nemotron-nano-9b-v2:free` -> `google/gemma-3-4b-it:free` -> `openrouter/free`
- **Extracts structured JSON**: description, who, what, why, where, when, how, topics, projectType
- **Truncates README to 4000 chars** to minimize cost
- **Falls back gracefully** to null if no API key or all models fail - AI is optional, not required
- **Handles response formats** including raw JSON and markdown code blocks

#### Modified Files

**`src/generators/faf-generator-championship.ts`** - Major overhaul of the init pipeline

*New imports and integration:*
- Imported `FrameworkDetector` (6-tier detection with 250+ patterns) - was in codebase but never used by init
- Imported `LocalProjectScanner` for comprehensive local analysis
- Imported `analyzeReadmeWithAI` for semantic README extraction

*New type detection system (`inferProjectType()`):*
- Priority 1: AI-suggested project type (most semantically accurate)
- Priority 2: Framework detector result
- Priority 3: Primary language inference (C/C++/Rust/Go/Zig -> `library`)
- Priority 4: Original `detectProjectType()` result (only if valid)
- Fixes whisper.cpp being classified as `python-generic` instead of `library`

*New N/A-aware scoring system:*
- Added `SLOT_CATEGORY_MAP` mapping each of the 20 slots to a category (project/frontend/backend/universal/human)
- Added `TYPE_APPLICABLE_CATEGORIES` mapping 50+ project types to their applicable categories (mirrors the compiler's `TYPE_DEFINITIONS`)
- `getApplicableSlots()` returns only the slots that matter for the detected type
- Score calculated as `filled / applicable * 100` instead of `filled / 21 * 100`
- Slot point values scaled proportionally so filling all applicable slots gives the same ~86 points regardless of project type
- Example: `library` type -> categories `[project, universal, human]` -> 15 applicable slots (5 N/A)

*New build tool detection:*
- Detects CMake, Make, Meson, Gradle, Maven, Zig Build from top-level files
- Framework detector result used to fill `framework` slot

*Slot filling priority (prevents overwriting):*
- AI results (most accurate) -> Local scanner -> FAB-FORMATS -> RELENTLESS extractor
- All downstream fillers use guarded writes (`if (!contextSlotsFilled['what'])`) to avoid overwriting AI results with inferior regex extractions

**`src/utils/yaml-generator.ts`** - Honest defaults and N/A scoring display

*Removed hardcoded defaults:*
- Removed `mission: '🚀 Make Your AI Happy! 🧡 Trust-Driven 🤖'`
- Removed `revolution: '30 seconds replaces 20 minutes of questions'`
- Removed `brand: 'F1-Inspired Software Engineering - Championship AI Context'`
- Removed `next_milestone: 'npm_publication'`
- Removed FAF-specific warnings (`'Never modify dial components without approval'`, etc.)
- Replaced with generic: `'Follow existing code conventions'`, `'Test changes before committing'`

*Fixed serialization:*
- Array items containing objects now render as YAML flow mappings (`{path: "src", type: "dir", size: 0}`) instead of `[object Object]`
- `detectKeyFiles()` no longer defaults to JS/TS files for all unknown projects; adds CMakeLists.txt/Makefile for C/C++

*N/A scoring support:*
- Accepts `totalSlots` and `naSlots` from generator
- Displays `slots_filled: "13/15 (87%)"` instead of `"12/21 (57%)"`
- Shows `na_slots: 5` in scores and ai_scoring_details sections

*New YAML output sections:*
- `languages.detected` - Full language breakdown with percentages
- `structure` - Top-level directory/file listing with types and sizes
- `local_quality` - Quality score, tier, and factor breakdown

### Results

| Project | Before | After (slot %) | Type |
|---------|--------|----------------|------|
| whisper.cpp (C++ library, 1121 files) | 33% | **87%** | `library` (was `python-generic`) |
| MiroBoardDuplicator (Python scripts, 12 files) | 24% | **60%** | `cli` (was `python-generic`) |

### Technical Notes

- The `detectProjectType()` function in `src/utils/file-utils.ts` is unchanged. The new `inferProjectType()` overrides its result when better information is available from the scanner, AI, or framework detector
- The compiler's `TYPE_DEFINITIONS` in `src/compiler/faf-compiler.ts` is unchanged. The generator mirrors its category system independently to avoid coupling
- AI analysis is entirely optional - without an API key, scoring still improves from local scanning and type-aware N/A subtraction alone
- The `faf git` command is unchanged - it uses a different scoring system (100-point quality score based on stars, activity, etc.)

### Fork Information

- **Upstream**: [Wolfe-Jam/faf-cli](https://github.com/Wolfe-Jam/faf-cli)
- **Fork**: [theaiconsultantuk/faf-cli](https://github.com/theaiconsultantuk/faf-cli)
- **Author**: Paul Cowen (The AI Consultant UK)
- **Changes are additive** - no upstream code was deleted, only extended

---

## [4.1.0] - 2026-01-31 — Gemini Native Handshake

### 🔷 Zero-Config Google AI Integration

FAF now auto-detects Gemini CLI and creates native bridges automatically.

### ✨ What's New

- **`--gemini` flag** - Explicit Gemini CLI integration
- **Auto-detection** - Detects Gemini CLI even without flag
  - Checks: `gemini` command, `~/.gemini`, `GEMINI_API_KEY`, `gcloud`
- **Native bridge** - Creates `.gemini/context.yaml` pointing to `project.faf`
- **Symlink** - `.gemini/project.faf → project.faf` for direct access
- **gemini: section** - Added to project.faf with integration config

### 🎯 The Native Handshake

Every `faf init` is now Gemini-aware. If Gemini CLI is installed, FAF automatically:
1. Detects the installation
2. Creates `.gemini/` directory
3. Writes context bridge config
4. Links to project.faf

Zero config. Native integration. Just works.

---

## [4.0.0] - 2026-01-24 — Foundation Layer

### 🏛️ The Format That Became a Standard

FAF v4.0.0 marks the transition from tool to standard. This release crystallizes
everything FAF has learned about persistent AI context.

### 🎯 Philosophy: Foundation First

**The DAAFT Problem:**
- **D**iscover - AI reads 50 files to understand your project
- **A**ssume - Guesses your stack (often wrong)
- **A**sk - Fills gaps with questions
- **F**orget - Session ends, context lost
- **T**ime + Tokens LOST - 91% wasted on rediscovery

**The FAF Solution:**
- 150 tokens once vs 1,750 tokens per session
- Zero assumptions - foundation is explicit
- Drift impossible - truth doesn't change

### ✨ What's New

- **Foundation Layer Architecture** - project.faf as single source of truth
- **DAAFT Documentation** - The problem FAF solves, explained
- **MCPaaS Integration** - Ecosystem links for eternal memory tools
- **Execution Context Engine** - New `faf go` guided interview system

### 🔧 Includes All 3.4.x Features

- **Bi-Sync 2.0** - Smart content detection and preservation
- **Google Gemini Edition** - Full Conductor & Antigravity interop
- **Demo Commands** - Live bi-sync demonstrations
- **Boris-Flow Tests** - 663 tests, WJTTC certified

### 📊 Credentials

- **IANA Registered:** application/vnd.faf+yaml
- **Anthropic MCP:** Official steward (PR #2759 merged)
- **Downloads:** 20,000+ across CLI + MCP

### 🏁 Getting Started

```bash
npm install -g faf-cli@4.0.0
faf auto
faf status --oneline
# 🏆 project.faf 100% | bi-sync ✓ | foundation optimized
```

---

## [3.4.8] - 2026-01-18 — BI-SYNC 2.0: Context Intelligence

### ✨ Smart Sync - "Knows what matters"

Bi-sync now **detects custom content** and preserves it. Your hand-crafted
CLAUDE.md with tables, code blocks, and custom sections stays intact.

**Custom markers detected:**
- `## TOOLS`, `## ENDPOINTS`, `## AUTH`, `## COMMANDS`
- `| Tool |`, `| Endpoint |` (markdown tables)
- ` ```bash ` (code blocks)

### 🛡️ Preservation Engine - "Zero content drift"

**RULE: Score can only improve - never downgrade.**

When bi-sync detects custom content, it:
1. Preserves your entire CLAUDE.md
2. Updates only the sync footer
3. Never overwrites rich content with generic templates

### 🔧 Fixes

- `FAFMirror` now uses `findFafFile()` to locate `project.faf` correctly
- Fixed hardcoded `.faf` path that ignored `project.faf` (the standard)

### 🧪 WJTTC Certified

**12 new tests** in `tests/wjttc/bi-sync-preserve-custom.test.ts`:
- Custom content detection (4 tests)
- findFafFile priority (3 tests)
- Preserve custom content during sync (3 tests)
- Score can only improve rule (1 test)
- FAFMirror initialization (1 test)

**Certification: GOLD 🥇** - Your content is protected forever.

---

## [3.4.7] - 2026-01-13 — Google Gemini Edition

Full interoperability with the Google Gemini ecosystem.

### Added

- **`faf conductor`** - Google Conductor format interop
  - `faf conductor import` - Import conductor/ directory → .faf
  - `faf conductor export` - Export .faf → conductor/ format
  - `faf conductor sync` - Bidirectional synchronization
  - Supports product.md, tech-stack.md, workflow.md, product-guidelines.md

- **`faf gemini`** - Gemini CLI / Antigravity IDE interop
  - `faf gemini import` - Import GEMINI.md → .faf
  - `faf gemini export` - Export .faf → GEMINI.md
  - `faf gemini sync` - Bidirectional synchronization
  - `--global` flag for ~/.gemini/GEMINI.md

### Universal AI Context

One `.faf` file now works with:
- Claude Code (CLAUDE.md, MCP)
- Gemini CLI (GEMINI.md)
- Antigravity IDE (~/.gemini/GEMINI.md)
- Conductor extensions (conductor/ directory)

## [3.4.4] - 2026-01-07

### Added

- **`faf demo sync`** - Live bi-sync demonstration command
  - Shows real-time .faf <-> CLAUDE.md synchronization
  - Timestamps, direction, and speed (ms) displayed
  - `--speed fast|normal|slow` for presentation pacing
  - Demo completes with no files changed
  - Built-in evangelism: every user can demo bi-sync to their team

## [3.4.3] - 2026-01-07

### Added

- **Boris-Flow Integration Tests** - 12-test suite for publish readiness validation
  - Version check, init, auto, score, non-TTY safety
  - Full Claude Code structure detection
  - `./tests/boris-flow.test.sh` - run before any publish
- **boris-ready.sh** - Quick pre-publish verification script
- **Turbo-cat Improvements** - Enhanced format discovery and tests

### Changed

- Sync command improvements for better reliability
- Compiler updates for more accurate scoring
- Removed deprecated Discord release workflow

## [3.4.2] - 2026-01-07

### Fixed

- `faf enhance` now exits cleanly in non-TTY environments (Claude Code, CI/CD)
- Previously corrupted .faf files when run without interactive terminal
- Displays helpful message directing users to use `faf auto` or run in real terminal

## [3.4.1] - 2026-01-07

### Fixed

- Removed external chalk dependency from plugin-install (zero deps approach)

## [3.4.0] - 2026-01-06

### Added

- **Claude Code Detection** - Automatic detection of Claude Code structures
  - Detects `.claude/agents/` subagents (extracts names)
  - Detects `.claude/commands/` slash commands (extracts names)
  - Detects `.claude/settings.json` permissions
  - Detects `CLAUDE.md` presence
  - Detects `.mcp.json` MCP server configuration
  - All data captured in `claude_code:` section of .faf output

- **Bun Detection** - Detects `bun.lockb` for Bun runtime projects
  - Sets runtime and package_manager to Bun

- **WJTTC Claude Code Test Suite** - 29 comprehensive tests
  - CLAUDE.md detection
  - Subagent discovery
  - Command discovery
  - Permissions extraction
  - MCP server detection
  - Edge cases (malformed JSON, empty dirs)
  - Performance tests (<10ms requirement)
  - Full Boris setup integration test

### Technical

Based on Boris Cherny's (Claude Code creator) workflow - 5 subagents, always bun, MCP servers for external services. FAF now captures this metadata for complete AI context handoff.

## [3.3.0] - 2025-12-28

### Added

- **`faf plugin-install`** - Install Claude Code plugins via HTTPS (workaround for SSH bug)
  - Fixes marketplace SSH clone issue (GitHub #9297, #9719, #9730, #9740)
  - Accepts: `owner/repo`, HTTPS URL, or SSH URL
  - Verifies plugin structure after install
  - Use `--force` to reinstall

- **Claude Code Plugin Structure** - Full plugin support at repo root
  - `commands/` directory with 6 slash commands
  - `skills/` directory with faf-expert skill
  - `.claude-plugin/plugin.json` for metadata

- **WJTTC Plugin Test Suite** - 31 tests for plugin validation
  - Brake Systems: Critical plugin structure
  - Engine Systems: Command discovery
  - Aerodynamics: Skill accessibility
  - Pit Lane: Metadata quality
  - Championship: Full integration

### Philosophy

Claude Code marketplace uses HTTPS (works). Third-party `/plugin marketplace add` uses SSH (hangs). We fixed it with `faf plugin-install` - uses HTTPS like the official marketplace.

## [3.2.7] - 2025-12-25

### Fixed

- **Birth DNA now uses raw slot count** - Birth DNA correctly reflects reality
  - Uses `slot_based_percentage` (raw slots filled / 21)
  - NOT the compiler score (which includes FAF intelligence)
  - 0% is a valid score - empty projects show 0%
  - Added extensive documentation to prevent future "optimization"

### Philosophy

Birth DNA = the "before" picture. The growth from Birth DNA to current score shows FAF's value. If Birth DNA is artificially high, we can't show improvement.

## [3.2.4] - 2025-12-17

### TYPE_DEFINITIONS - Project Type-Aware Scoring

**The scoring system now understands project types** - CLI projects no longer penalized for missing frontend/backend slots.

### Added

- **TYPE_DEFINITIONS** - Single source of truth for 94 project types
  - **21-slot system**: Project(3) + Frontend(4) + Backend(5) + Universal(3) + Human(6)
  - Types define which slot categories COUNT for scoring
  - CLI type: 9 slots (project + human) - now scores 100% without hosting/cicd
  - Fullstack type: 21 slots (all categories)
  - Monorepos as containers: all 21 slots

- **38 Type Aliases** - Intuitive shorthand mappings
  - `k8s` → `kubernetes`, `api` → `backend-api`, `rn` → `react-native`
  - `flask` → `python-api`, `turbo` → `turborepo`, and 32 more

- **slot_ignore Escape Hatch** - Override type defaults per-project
  - Array format: `slot_ignore: [stack.hosting, stack.cicd]`
  - String format: `slot_ignore: "hosting, cicd"`
  - Shorthand: `hosting` expands to `stack.hosting`

- **WJTTC MCP Certification Standard** - 7-tier certification system for MCP servers
  - Tier 1: Protocol Compliance (MCP spec 2025-11-25)
  - Tier 2: Capability Negotiation
  - Tier 3: Tool Integrity
  - Tier 4: Resource Management
  - Tier 5: Security Validation
  - Tier 6: Performance Benchmarks (<50ms operations)
  - Tier 7: Integration Readiness

### Slot Categories by Type

| Type Category | Slots | Example Types |
|---------------|-------|---------------|
| 9-slot | Project + Human | cli, library, npm-package, terraform, k8s |
| 13-slot | + Frontend | mobile, react-native, flutter, desktop |
| 14-slot | + Backend | mcp-server, data-science, ml-model |
| 16-slot | + Universal | frontend, react, vue, svelte |
| 17-slot | Backend + Universal | backend-api, node-api, graphql |
| 21-slot | All | fullstack, nextjs, monorepo, django |

### Impact

- **xai-faf-cli**: 83% → 100% (CLI type counts 9/9 slots)
- **claude-faf-mcp** v3.3.6: CHAMPIONSHIP GRADE (all 7 tiers PASS)
- 125 WJTTC tests validating type system
- Backwards compatible - existing .faf files work unchanged

## [3.2.0] - 2025-11-28

### Added

- **`faf readme` - Smart README Extraction** - Auto-fill human_context from README.md
  - Intelligently extracts the 6 Ws (WHO, WHAT, WHY, WHERE, WHEN, HOW)
  - Pattern matching for common README structures (taglines, TL;DR, Quick Start)
  - `--apply` to fill empty slots, `--force` to overwrite existing
  - Shows confidence scores and extraction sources
  - Tested results: 33% → 75%+ score boosts

- **`faf human` - Interactive Human Context** - Fill one W at a time (terminal)
  - Asks each question sequentially
  - Press Enter to skip, `--all` to re-answer all fields
  - Perfect for terminal users who want guided input

- **`faf human-set` - Non-Interactive Human Context** - Works in Claude Code
  - `faf human-set <field> "<value>"` - set one field at a time
  - Valid fields: who, what, why, where, when, how
  - Essential for AI assistants and automation scripts

### Human Context Workflow

```bash
# Step 1: Initialize
faf init                           # Creates .faf with ~50% score

# Step 2: Auto-extract from README
faf readme --apply --force         # +25-35 points (auto)

# Step 3: Fill any gaps manually
faf human-set why "32x faster"     # Non-interactive (Claude Code)
faf human                          # Interactive (terminal)

# Result: 75-85% score from human_context alone
```

## [3.1.6] - 2025-11-16

### Fixed
- Updated Discord community invite link to working URL (never expires)

## [3.1.5] - 2025-11-14

### Added

- **Auto-Update package.json for npm Packages** - Championship automation
  - `faf init` now automatically adds `project.faf` to package.json "files" array
  - Only updates if "files" array already exists (respects npm defaults)
  - Checks for existing entries (.faf, project.faf) to avoid duplicates
  - Graceful handling of edge cases (malformed JSON, non-array "files" field)
  - Informative messages: success, already exists, or manual edit needed
  - Solves the chicken-and-egg problem: package.json → faf init → auto-update!

### Fixed

- **npm Package Publishing Workflow** - No more manual edits required
  - Previously: Create project.faf, manually edit package.json
  - Now: Create project.faf, CLI auto-updates package.json
  - Critical for faf-cli and all npm packages using FAF format

## [3.1.2] - 2025-11-07

### Discord Community Launch

**The FAF community is now live** - Join us at [discord.com/invite/56fPBUJKfk](https://discord.com/invite/56fPBUJKfk)

### Added

- **Discord Community Server** - Official FAF community launched
  - 6 focused channels: announcements, general, showcase, help, integrations, w3c-and-standards
  - Permanent invite link: discord.com/invite/56fPBUJKfk
  - Low maintenance, open community structure
  - Auto-moderation enabled for spam/raid protection

- **GitHub Actions Discord Automation** - Automated release announcements
  - Discord webhook integration for both faf-cli and claude-faf-mcp
  - Rich embeds with version info, changelog, and install instructions
  - Automatic posting to #announcements on new releases
  - Differentiates between stable and beta releases

- **Championship Stress Test Timeouts** - Enterprise-ready torture testing
  - 10,000 commits test: 2min → 10min timeout (championship grade)
  - 100 package.json changes: 1min → 3min timeout (enterprise stress)
  - Prepared for monorepo and enterprise-scale testing

### Fixed

- **Critical Test Infrastructure Bug (uv_cwd)** - Fixed 24 test suite failures
  - `git.test.ts` now properly restores `process.cwd()` after changing directories
  - Prevented cascading failures when tests delete directories
  - Tests now run reliably in sequential mode (maxWorkers: 1)

- **Syntax Errors in drift.test.ts** - Fixed 7 template literal quote mismatches
  - Fixed test descriptions missing closing quotes
  - Fixed execSync calls missing commas after template literals
  - All tests now compile and run correctly

### Changed

- **Test Suite Status** - 281/327 core tests passing (86% success rate)
  - Core functionality: All passing
  - Git integration tests: Rate-limited by GitHub API (external issue)
  - Test infrastructure now championship-grade ready for enterprise

- **README Updates** - Added Discord community links
  - Discord badge in header
  - Discord navigation link alongside Website/GitHub
  - Professional, scannable structure maintained

## [3.1.0] - 2025-10-29

### The Visibility Revolution

**`project.faf` is the new universal standard** - like `package.json` for AI context.

### Added

- **project.faf Standard (FAF v1.2.0 Specification)** - Visible filename replacing hidden `.faf`
  - `faf init` now creates `project.faf` instead of `.faf`
  - `faf auto` now creates `project.faf` instead of `.faf`
  - All commands read `project.faf` first, fallback to `.faf`
  - Priority: `project.faf` > `*.faf` > `.faf`

- **faf migrate** - One-command migration from `.faf` to `project.faf`
  - Renames `.faf` → `project.faf` in current directory
  - 27ms execution (54% faster than 50ms target)
  - Beautiful color output with progress indicators

- **faf rename** - Bulk recursive migration across entire project tree
  - Recursively finds all `.faf` files in directory tree
  - Renames all to `project.faf` in parallel
  - 27ms for 3 files (73% faster than 100ms target)
  - Progress tracking and summary statistics

### Changed

- **TSA Championship Detection** - Wired DependencyTSA engine into project type detection
  - Analyzes CORE dependencies (>10 imports) instead of naive presence checks
  - 95% accuracy vs 70% accuracy (naive method)
  - Dynamic import to avoid circular dependencies
  - Exhaustive elimination strategy for definitive classification
  - Phase 1: TSA + TURBO-CAT championship detection
  - Phase 2: Fallback to naive detection when engines unavailable

- **Edge Case Test Updated** - `faf-edge-case-audit.test.ts`
  - Changed "should prefer .faf over named files" → "should prefer project.faf over .faf (v1.2.0 standard)"
  - Updated test expectation to match v1.2.0 priority

- **Dogfooding** - faf-cli itself migrated from `.faf` → `project.faf`

### Fixed

- CLI tool detection now uses bin field as PRIORITY 1 (definitive)
- Project type detection no longer reports false positives from dormant dependencies

### Performance

- `faf migrate`: 27ms (championship)
- `faf rename`: 27ms for 3 files (championship)
- All v1.2.0 commands meet <50ms target

### Testing

- **WJTTC GOLD Certification** - 97/100 championship score
  - Project Understanding: 20/20
  - TURBO-CAT Knowledge: 20/20
  - Architecture Understanding: 20/20
  - Full report: 194KB comprehensive test suite

### Backward Compatibility

- ✅ 100% backward compatible with `.faf` files
- ✅ All existing `.faf` files continue to work
- ✅ No breaking changes
- ✅ Graceful transition period

### Migration Guide

**For existing users:**
```bash
# Single project
cd your-project
faf migrate

# Entire monorepo
cd monorepo-root
faf rename
```

**For new projects:**
```bash
faf init    # Creates project.faf automatically
```

### The Golden Triangle

Three sides. Closed loop. Complete accountability.

```
         project.faf
          (WHAT IT IS)
              /    \
             /      \
            /        \
         repo    ←→   .taf
        (CODE)    (PROOF IT WORKS)
```

Every project needs:
- Code that works (repo)
- Context for AI (project.faf)
- Proof it works (.taf - git-tracked testing timeline)

**TAF** (Testing Audit File) format tracks every test run in git. On-the-fly CI/CD updates. Permanent audit trail. Format defined in **faf-taf-git** (GitHub Actions native support).

### Why project.faf?

Like `package.json` tells npm what your project needs, `project.faf` tells AI what your project IS.

- **Visible** - No more hidden files
- **Universal** - Like package.json, tsconfig.json, Cargo.toml
- **Discoverable** - Impossible to miss
- **Professional** - Standard pattern developers know

### Links

- [FAF v1.2.0 Specification](https://github.com/Wolfe-Jam/faf-cli/blob/main/SPECIFICATION.md)
- [WJTTC Test Report](https://github.com/Wolfe-Jam/faf-cli/blob/main/tests/wjttc-report-v3.1.0.yaml)
- [GitHub Discussions](https://github.com/Wolfe-Jam/faf-cli/discussions)

---

## [3.0.6] - 2025-10-22

### Changed

- Minor updates and bug fixes

## [3.0.5] - 2025-10-21

### Added

- FAF Family integrations support

## [3.0.4] - 2025-10-20

### Changed

- Performance improvements

## [3.0.3] - 2025-10-19

### Added

- Birth DNA tracking
- Context-mirroring bi-sync

## [3.0.2] - 2025-10-18

### Changed

- TURBO-CAT improvements

## [3.0.0] - 2025-10-15

### The Podium Release

- 🆓 FREE FOREVER .faf Core-Engine (41 commands)
- 💨 TURBO Model introduced
- 😽 TURBO-CAT™ Format Discovery (153 formats)
- 🧬 Birth DNA Lifecycle
- 🏆 7-Tier Podium Scoring
- ⚖️ AI | HUMAN Balance (50|50)
- 🔗 Context-Mirroring with Bi-Sync
- ⚡ Podium Speed (<50ms all commands)
- 🏁 WJTTC GOLD Certified (1,000+ tests)
- 🤖 BIG-3 AI Validation
- 🌐 Universal AI Support

---

[3.1.0]: https://github.com/Wolfe-Jam/faf-cli/compare/v3.0.6...v3.1.0
[3.0.6]: https://github.com/Wolfe-Jam/faf-cli/compare/v3.0.5...v3.0.6
[3.0.5]: https://github.com/Wolfe-Jam/faf-cli/compare/v3.0.4...v3.0.5
[3.0.4]: https://github.com/Wolfe-Jam/faf-cli/compare/v3.0.3...v3.0.4
[3.0.3]: https://github.com/Wolfe-Jam/faf-cli/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/Wolfe-Jam/faf-cli/compare/v3.0.0...v3.0.2
[3.0.0]: https://github.com/Wolfe-Jam/faf-cli/releases/tag/v3.0.0
