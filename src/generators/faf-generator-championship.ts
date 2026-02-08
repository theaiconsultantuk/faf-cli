/**
 * 🏎️ Championship .faf Generator
 * Uses FAB-FORMATS Power Unit for 86%+ context extraction
 */

import { promises as fs } from "fs";
import path from "path";
import {
  findPackageJson,
  findPyprojectToml,
  findRequirementsTxt,
  findTsConfig,
  analyzeTsConfig,
  TypeScriptContext,
} from "../utils/file-utils";
import { generateFafContent } from "../utils/yaml-generator";
import { FabFormatsProcessor, FabFormatsAnalysis } from "../engines/fab-formats-processor";
import { relentlessExtractor } from "../engines/relentless-context-extractor";
import { detectClaudeCode, type ClaudeCodeResult } from "../framework-detector";
import { FrameworkDetector, type DetectionResult } from "../framework-detector";
import { LocalProjectScanner, type LocalScanResult } from "../engines/local-project-scanner";
import { analyzeReadmeWithAI, type AIReadmeResult } from "../engines/ai-readme-analyzer";

// ============================================================================
// TYPE-AWARE SCORING - Maps slots to categories, uses TYPE_DEFINITIONS
// ============================================================================

/**
 * Maps each generator slot to a category matching the compiler's TYPE_DEFINITIONS.
 * Categories: project, frontend, backend, universal, human
 */
const SLOT_CATEGORY_MAP: Record<string, string> = {
  // project (always applicable)
  'project_name': 'project',
  'project_goal': 'project',
  'main_language': 'project',
  // frontend
  'framework': 'frontend',
  // backend
  'backend': 'backend',
  'server': 'backend',
  'api_type': 'backend',
  'database': 'backend',
  // universal (build/deploy infrastructure)
  'hosting': 'universal',
  'cicd': 'universal',
  'build_tool': 'universal',
  'package_manager': 'universal',
  'test_framework': 'universal',
  'linter': 'universal',
  // human (always applicable)
  'who': 'human',
  'what': 'human',
  'why': 'human',
  'where': 'human',
  'when': 'human',
  'how': 'human',
};

/**
 * Maps project types to their applicable slot categories.
 * Mirrors the compiler's TYPE_DEFINITIONS for consistency.
 */
const TYPE_APPLICABLE_CATEGORIES: Record<string, string[]> = {
  // CLI/Tool Types (project + universal + human)
  'cli': ['project', 'universal', 'human'],
  'cli-tool': ['project', 'universal', 'human'],
  'cli-ts': ['project', 'universal', 'human'],
  'cli-js': ['project', 'universal', 'human'],
  // Library/Package Types (project + universal + human)
  'library': ['project', 'universal', 'human'],
  'npm-package': ['project', 'universal', 'human'],
  'pip-package': ['project', 'universal', 'human'],
  'crate': ['project', 'universal', 'human'],
  'typescript': ['project', 'universal', 'human'],
  // AI/ML Types (project + backend + human)
  'data-science': ['project', 'backend', 'human'],
  'ml-model': ['project', 'backend', 'human'],
  'mcp-server': ['project', 'backend', 'human'],
  // Backend/API Types (project + backend + universal + human)
  'backend-api': ['project', 'backend', 'universal', 'human'],
  'node-api': ['project', 'backend', 'universal', 'human'],
  'node-api-ts': ['project', 'backend', 'universal', 'human'],
  'python-api': ['project', 'backend', 'universal', 'human'],
  'python-app': ['project', 'backend', 'human'],
  'python-generic': ['project', 'backend', 'human'],
  'go-api': ['project', 'backend', 'universal', 'human'],
  'rust-api': ['project', 'backend', 'universal', 'human'],
  // Frontend Types (project + frontend + universal + human)
  'frontend': ['project', 'frontend', 'universal', 'human'],
  'react': ['project', 'frontend', 'universal', 'human'],
  'react-ts': ['project', 'frontend', 'universal', 'human'],
  'vue': ['project', 'frontend', 'universal', 'human'],
  'vue-ts': ['project', 'frontend', 'universal', 'human'],
  'svelte': ['project', 'frontend', 'universal', 'human'],
  'svelte-ts': ['project', 'frontend', 'universal', 'human'],
  'angular': ['project', 'frontend', 'universal', 'human'],
  'static-html': ['project', 'frontend', 'human'],
  // Fullstack Types (all categories)
  'fullstack': ['project', 'frontend', 'backend', 'universal', 'human'],
  'fullstack-ts': ['project', 'frontend', 'backend', 'universal', 'human'],
  'nextjs': ['project', 'frontend', 'backend', 'universal', 'human'],
  'django': ['project', 'frontend', 'backend', 'universal', 'human'],
  'rails': ['project', 'frontend', 'backend', 'universal', 'human'],
  // Mobile Types (project + frontend + human)
  'mobile': ['project', 'frontend', 'human'],
  'react-native': ['project', 'frontend', 'human'],
  'flutter': ['project', 'frontend', 'human'],
  'ios': ['project', 'frontend', 'human'],
  'android': ['project', 'frontend', 'human'],
  // Desktop Types (project + frontend + human)
  'desktop': ['project', 'frontend', 'human'],
  'electron': ['project', 'frontend', 'human'],
  'tauri': ['project', 'frontend', 'human'],
  // DevOps/Infra Types (project + human)
  'terraform': ['project', 'human'],
  'kubernetes': ['project', 'human'],
  'docker': ['project', 'human'],
  'infrastructure': ['project', 'human'],
  // Documentation Types (project + human)
  'documentation': ['project', 'human'],
  'cookbook': ['project', 'human'],
};

/**
 * Maps AI-suggested project types to FAF TYPE_DEFINITION keys
 */
const AI_TYPE_TO_FAF_TYPE: Record<string, string> = {
  'cli': 'cli',
  'library': 'library',
  'web-app': 'frontend',
  'api': 'backend-api',
  'mobile-app': 'mobile',
  'desktop-app': 'desktop',
  'framework': 'library',
  'tool': 'cli',
  'plugin': 'library',
  'data-science': 'data-science',
  'devops': 'infrastructure',
};

/**
 * Infer the correct project type using scanner, AI, and framework detector.
 * Overrides the broken detectProjectType() which misclassifies C++ projects as python-generic.
 */
function inferProjectType(
  scanResult: LocalScanResult,
  aiProjectType: string | undefined,
  frameworkResult: DetectionResult | null,
  originalType: string | undefined
): string {
  // Priority 1: AI-suggested type (most semantically accurate)
  if (aiProjectType) {
    const mapped = AI_TYPE_TO_FAF_TYPE[aiProjectType];
    if (mapped && TYPE_APPLICABLE_CATEGORIES[mapped]) return mapped;
    // Try direct match
    if (TYPE_APPLICABLE_CATEGORIES[aiProjectType]) return aiProjectType;
  }

  // Priority 2: Framework detector result
  if (frameworkResult?.framework) {
    const fw = frameworkResult.framework.toLowerCase().replace(/\s+/g, '-');
    if (TYPE_APPLICABLE_CATEGORIES[fw]) return fw;
  }

  // Priority 3: Language-based inference (fixes python-generic for C++ projects)
  const lang = scanResult.primaryLanguage;
  if (['C', 'C++', 'Rust', 'Go', 'Zig'].includes(lang)) {
    // Systems languages without web framework → library
    return 'library';
  }

  // Priority 4: Original type (if valid and not a misclassification)
  if (originalType && TYPE_APPLICABLE_CATEGORIES[originalType]) {
    return originalType;
  }

  // Default: fullstack (all slots applicable - no N/A benefit)
  return 'fullstack';
}

/**
 * Get applicable slots for a project type.
 * Returns the list of slot names that should be scored.
 */
function getApplicableSlots(projectType: string): string[] {
  const categories = TYPE_APPLICABLE_CATEGORIES[projectType]
    || ['project', 'frontend', 'backend', 'universal', 'human']; // Default: all

  const allSlots = Object.keys(SLOT_CATEGORY_MAP);
  return allSlots.filter(slot => categories.includes(SLOT_CATEGORY_MAP[slot]));
}

export interface GenerateOptions {
  projectType?: string;
  outputPath: string;
  projectRoot: string;
  // Quick mode fields (optional)
  projectName?: string;
  projectGoal?: string;
  mainLanguage?: string;
  framework?: string;
  hosting?: string;
  [key: string]: any;  // Allow additional fields
}

export async function generateFafFromProject(
  options: GenerateOptions,
): Promise<string> {
  const { projectType, projectRoot } = options;

  // Validate projectRoot
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error(`Invalid projectRoot: ${projectRoot}. Expected a valid directory path.`);
  }

  // 🔍 LOCAL PROJECT SCANNER - The Pauly Engine
  // Runs comprehensive local analysis equivalent to faf git's GitHub API calls
  const scanner = new LocalProjectScanner(projectRoot);
  const scanResult: LocalScanResult = await scanner.scan();

  // 🏎️ FRAMEWORK DETECTOR - 6-tier detection (was NOT used by init before!)
  let frameworkResult: DetectionResult | null = null;
  try {
    const detector = new FrameworkDetector(projectRoot);
    frameworkResult = await detector.detect();
  } catch {
    // Continue without framework detection
  }

  // Read README.md if available (HUMAN CONTEXT SOURCE)
  // Now uses the scanner's structured README parsing instead of broken regex
  const readmeData: any = {};
  if (scanResult.readme.exists) {
    readmeData.projectName = scanResult.readme.name;
    readmeData.description = scanResult.readme.description;
    readmeData.targetUser = scanResult.readme.who;
  }

  // Read package.json if available (JavaScript projects)
  const packageJsonPath = await findPackageJson(projectRoot);
  let packageData: any = {};

  if (packageJsonPath) {
    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      packageData = JSON.parse(content);
    } catch {
      // Continue without package.json data
    }
  }

  // Read pyproject.toml if available (Python projects)
  const pyprojectPath = await findPyprojectToml(projectRoot);
  const pyprojectData: any = {};

  if (pyprojectPath) {
    try {
      const content = await fs.readFile(pyprojectPath, "utf-8");
      // Basic parsing for Python projects
      if (content.includes('[tool.poetry]')) {
        pyprojectData.packageManager = 'Poetry';
      }
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      if (nameMatch) {
        pyprojectData.name = nameMatch[1];
      }
      const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
      if (descMatch) {
        pyprojectData.description = descMatch[1];
      }
    } catch {
      // Continue without pyproject.toml data
    }
  }

  // Read requirements.txt if available (Python projects)
  const requirementsPath = await findRequirementsTxt(projectRoot);
  const requirementsData: any = {};

  if (requirementsPath) {
    try {
      const content = await fs.readFile(requirementsPath, "utf-8");
      const lines = content.split('\n').filter(line => line && !line.startsWith('#'));
      requirementsData.dependencies = lines;
    } catch {
      // Continue without requirements.txt data
    }
  }

  // 🏎️ CHAMPIONSHIP ENGINE - FAB-FORMATS Power Unit with 150+ handlers!
  const fabProcessor = new FabFormatsProcessor();
  let fabAnalysis: FabFormatsAnalysis;
  try {
    fabAnalysis = await fabProcessor.processFiles(projectRoot);
  } catch {
    // Fallback to empty analysis if discovery fails
    fabAnalysis = {
      results: [],
      totalBonus: 0,
      context: {},
      qualityMetrics: {
        highestGrade: 'MINIMAL',
        averageScore: 0,
        filesCovered: 0,
        intelligenceDepth: 0
      }
    };
  }

  // 🏎️ AERO PACKAGE - RelentlessContextExtractor for human context!
  let humanContext;
  try {
    humanContext = await relentlessExtractor.extractFromProject(projectRoot);
  } catch {
    // Fallback to empty context
    humanContext = null;
  }

  // TypeScript configuration analysis
  const tsConfigPath = await findTsConfig(projectRoot);
  let tsContext: TypeScriptContext | null = null;
  if (tsConfigPath) {
    const result = await analyzeTsConfig(tsConfigPath);
    if (result) {
      tsContext = result;
    }
  }

  // 🏎️ Claude Code Detection - Detect .claude/agents, .claude/commands, CLAUDE.md
  let claudeCodeResult: ClaudeCodeResult | null = null;
  try {
    claudeCodeResult = await detectClaudeCode(projectRoot);
  } catch {
    // Continue without Claude Code detection
  }

  // 🦊 Bun Detection - Check for bun.lockb
  let isBunProject = false;
  try {
    await fs.access(path.join(projectRoot, 'bun.lockb'));
    isBunProject = true;
  } catch {
    // Not a Bun project
  }

  // START ENHANCED SCORING - Championship grade with FAB-FORMATS!
  // HONEST SCORING: 0% is a valid score - no base points for merely existing!
  let enhancedScore = 0;

  // Map all discovered slots (21-slot system)
  const contextSlotsFilled: Record<string, any> = {};

  // IF: Quick mode data takes priority (user explicitly provided it)
  if (options.projectGoal) {
    contextSlotsFilled['project_goal'] = options.projectGoal;
  }
  if (options.projectName) {
    contextSlotsFilled['project_name'] = options.projectName;
  }
  if (options.mainLanguage) {
    contextSlotsFilled['main_language'] = options.mainLanguage;
  }
  if (options.framework && options.framework !== 'none') {
    contextSlotsFilled['framework'] = options.framework;
  }
  if (options.hosting && options.hosting !== 'cloud') {
    contextSlotsFilled['hosting'] = options.hosting;
  }

  // 🔍 LOCAL SCANNER RESULTS - Fill slots from filesystem analysis
  // Primary language from actual file scanning (like GitHub API)
  if (scanResult.primaryLanguage && scanResult.primaryLanguage !== 'Unknown') {
    contextSlotsFilled['main_language'] = scanResult.primaryLanguage;
  }

  // Framework detection results (6-tier detector, was NOT used before!)
  if (frameworkResult && frameworkResult.framework !== 'Unknown') {
    if (!contextSlotsFilled['framework']) {
      contextSlotsFilled['framework'] = frameworkResult.framework;
    }
    if (frameworkResult.language && !contextSlotsFilled['main_language']) {
      contextSlotsFilled['main_language'] = frameworkResult.language;
    }
    if (frameworkResult.ecosystem) {
      contextSlotsFilled['package_manager'] = frameworkResult.ecosystem;
    }
  }

  // 🧠 AI-ASSISTED README ANALYSIS (if API key available)
  // Uses Haiku (Anthropic) or free models (OpenRouter) for semantic extraction
  let aiResult: AIReadmeResult | null = null;
  if (scanResult.readme.exists) {
    try {
      const readmePath = path.join(projectRoot, 'README.md');
      const readmeContent = await fs.readFile(readmePath, 'utf-8');
      const projectName = scanResult.readme.name || path.basename(projectRoot);
      aiResult = await analyzeReadmeWithAI(
        readmeContent,
        scanResult.languageStrings,
        projectName
      );
    } catch {
      // AI analysis failed - continue with local parsing
    }
  }

  // Fill slots: AI results take priority over local regex for human context
  if (aiResult) {
    // AI-extracted human context (much more accurate than regex)
    if (aiResult.description && !contextSlotsFilled['project_goal']) {
      contextSlotsFilled['project_goal'] = aiResult.description;
    }
    if (aiResult.who && !contextSlotsFilled['who']) {
      contextSlotsFilled['who'] = aiResult.who;
    }
    if (aiResult.what && !contextSlotsFilled['what']) {
      contextSlotsFilled['what'] = aiResult.what;
    }
    if (aiResult.why && !contextSlotsFilled['why']) {
      contextSlotsFilled['why'] = aiResult.why;
    }
    if (aiResult.where && !contextSlotsFilled['where']) {
      contextSlotsFilled['where'] = aiResult.where;
    }
    if (aiResult.when && !contextSlotsFilled['when']) {
      contextSlotsFilled['when'] = aiResult.when;
    }
    if (aiResult.how && !contextSlotsFilled['how']) {
      contextSlotsFilled['how'] = aiResult.how;
    }
    // AI-suggested project type (if detected)
    if (aiResult.projectType) {
      contextSlotsFilled['_ai_project_type'] = aiResult.projectType;
    }
  }

  // Local README-derived context (fallback if AI didn't fill)
  if (scanResult.readme.exists) {
    if (scanResult.readme.name && !contextSlotsFilled['project_name']) {
      contextSlotsFilled['project_name'] = scanResult.readme.name;
    }
    if (scanResult.readme.description && !contextSlotsFilled['project_goal']) {
      contextSlotsFilled['project_goal'] = scanResult.readme.description;
    }
    if (scanResult.readme.who && !contextSlotsFilled['who']) {
      contextSlotsFilled['who'] = scanResult.readme.who;
    }
    if (scanResult.readme.what && !contextSlotsFilled['what']) {
      contextSlotsFilled['what'] = scanResult.readme.what;
    }
    if (scanResult.readme.why && !contextSlotsFilled['why']) {
      contextSlotsFilled['why'] = scanResult.readme.why;
    }
    if (scanResult.readme.where && !contextSlotsFilled['where']) {
      contextSlotsFilled['where'] = scanResult.readme.where;
    }
    if (scanResult.readme.when && !contextSlotsFilled['when']) {
      contextSlotsFilled['when'] = scanResult.readme.when;
    }
    if (scanResult.readme.how && !contextSlotsFilled['how']) {
      contextSlotsFilled['how'] = scanResult.readme.how;
    }
  }

  // License detection
  if (scanResult.hasLicense && scanResult.licenseName) {
    contextSlotsFilled['license'] = scanResult.licenseName;
  }

  // CI/CD detection
  if (scanResult.hasCiCd && scanResult.cicdPlatform) {
    contextSlotsFilled['cicd'] = scanResult.cicdPlatform;
  }

  // Test detection
  if (scanResult.hasTests) {
    contextSlotsFilled['test_framework'] = 'Detected (tests/ directory)';
  }

  // Docker detection
  if (scanResult.hasDocker) {
    contextSlotsFilled['hosting'] = contextSlotsFilled['hosting'] || 'Docker';
  }

  // Build tool detection from top-level files
  if (!contextSlotsFilled['build_tool']) {
    const topFiles = scanResult.topLevelStructure.map(f => f.path);
    if (topFiles.includes('CMakeLists.txt')) {
      contextSlotsFilled['build_tool'] = 'CMake';
    } else if (topFiles.includes('Makefile')) {
      contextSlotsFilled['build_tool'] = 'Make';
    } else if (topFiles.includes('meson.build')) {
      contextSlotsFilled['build_tool'] = 'Meson';
    } else if (topFiles.includes('build.gradle') || topFiles.includes('build.gradle.kts')) {
      contextSlotsFilled['build_tool'] = 'Gradle';
    } else if (topFiles.includes('pom.xml')) {
      contextSlotsFilled['build_tool'] = 'Maven';
    } else if (topFiles.includes('build.zig')) {
      contextSlotsFilled['build_tool'] = 'Zig Build';
    }
  }

  // Framework detector can provide additional context
  if (frameworkResult && !contextSlotsFilled['framework']) {
    contextSlotsFilled['framework'] = frameworkResult.framework;
  }

  // Apply championship context extraction
  if (fabAnalysis.context) {
    const ctx = fabAnalysis.context;

    // Technical slots (15) - only fill if not already set by quick mode
    if (ctx.projectName && !contextSlotsFilled['project_name']) {contextSlotsFilled['project_name'] = ctx.projectName;}
    if (ctx.projectGoal && !contextSlotsFilled['project_goal']) {contextSlotsFilled['project_goal'] = ctx.projectGoal;}
    if (ctx.mainLanguage) {contextSlotsFilled['main_language'] = ctx.mainLanguage;}
    if (ctx.framework) {contextSlotsFilled['framework'] = ctx.framework;}
    if (ctx.backend) {contextSlotsFilled['backend'] = ctx.backend;}
    if (ctx.server) {contextSlotsFilled['server'] = ctx.server;}
    if (ctx.apiType) {contextSlotsFilled['api_type'] = ctx.apiType;}
    if (ctx.database) {contextSlotsFilled['database'] = ctx.database;}
    if (ctx.hosting) {contextSlotsFilled['hosting'] = ctx.hosting;}
    if (ctx.cicd) {contextSlotsFilled['cicd'] = ctx.cicd;}
    if (ctx.buildTool) {contextSlotsFilled['build_tool'] = ctx.buildTool;}
    if (ctx.packageManager) {contextSlotsFilled['package_manager'] = ctx.packageManager;}
    if (ctx.testFramework) {contextSlotsFilled['test_framework'] = ctx.testFramework;}
    if (ctx.linter) {contextSlotsFilled['linter'] = ctx.linter;}

    // Human context slots (6 W's) - only fill if NOT already set by AI
    if (ctx.targetUser && !contextSlotsFilled['who']) {contextSlotsFilled['who'] = ctx.targetUser;}
    if (ctx.coreProblem && !contextSlotsFilled['what']) {contextSlotsFilled['what'] = ctx.coreProblem;}
    if (ctx.missionPurpose && !contextSlotsFilled['why']) {contextSlotsFilled['why'] = ctx.missionPurpose;}
    if (ctx.deploymentMarket && !contextSlotsFilled['where']) {contextSlotsFilled['where'] = ctx.deploymentMarket;}
    if (ctx.timeline && !contextSlotsFilled['when']) {contextSlotsFilled['when'] = ctx.timeline;}
    if (ctx.approach && !contextSlotsFilled['how']) {contextSlotsFilled['how'] = ctx.approach;}
  }

  // Apply RELENTLESS human context extraction (only if slot not already filled)
  // AI-extracted context takes priority over regex-based extraction
  if (humanContext) {
    if (!contextSlotsFilled['who'] && humanContext.who.value) {
      contextSlotsFilled['who'] = humanContext.who.value;
    }
    if (!contextSlotsFilled['what'] && humanContext.what.value) {
      contextSlotsFilled['what'] = humanContext.what.value;
    }
    if (!contextSlotsFilled['why'] && humanContext.why.value) {
      contextSlotsFilled['why'] = humanContext.why.value;
    }
    if (!contextSlotsFilled['where'] && humanContext.where.value) {
      contextSlotsFilled['where'] = humanContext.where.value;
    }
    if (!contextSlotsFilled['when'] && humanContext.when.value) {
      contextSlotsFilled['when'] = humanContext.when.value;
    }
    if (!contextSlotsFilled['how'] && humanContext.how.value) {
      contextSlotsFilled['how'] = humanContext.how.value;
    }
  }

  // CLI-specific detection and smart slot reuse
  const deps = {
    ...packageData.dependencies,
    ...packageData.devDependencies
  };

  // 🦀 RUST CLI DETECTION: Check Cargo.toml for [bin] section
  let isRustCLI = false;
  const cargoTomlData: any = {};
  const cargoTomlPath = path.join(projectRoot, 'Cargo.toml');
  try {
    const cargoContent = await fs.readFile(cargoTomlPath, 'utf-8');
    // Detect CLI: [bin] section or clap/structopt dependencies
    isRustCLI = cargoContent.includes('[bin]') ||
                cargoContent.includes('clap') ||
                cargoContent.includes('structopt') ||
                cargoContent.includes('argh');
    // Extract name from Cargo.toml
    const nameMatch = cargoContent.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch) {cargoTomlData.name = nameMatch[1];}
    const descMatch = cargoContent.match(/^description\s*=\s*"([^"]+)"/m);
    if (descMatch) {cargoTomlData.description = descMatch[1];}
  } catch {
    // No Cargo.toml or can't read it
  }

  // Node.js CLI detection
  const isNodeCLI = packageData.bin ||
                packageData.name?.includes('cli') ||
                packageData.keywords?.includes('cli') ||
                packageData.keywords?.includes('command-line') ||
                deps?.commander ||
                deps?.yargs ||
                deps?.oclif ||
                deps?.inquirer;

  // 🦀 RUST CLI: Smart slot assignment
  if (isRustCLI) {
    contextSlotsFilled['framework'] = 'CLI';
    contextSlotsFilled['api_type'] = 'CLI';
    contextSlotsFilled['hosting'] = 'crates.io / Binary distribution';
    contextSlotsFilled['backend'] = 'Rust';
    contextSlotsFilled['main_language'] = 'Rust';
    contextSlotsFilled['build_tool'] = 'Cargo';
    contextSlotsFilled['package_manager'] = 'Cargo';
    contextSlotsFilled['runtime'] = 'Native binary';
    // Set N/A for non-applicable slots (reduces slot count for CLI)
    contextSlotsFilled['css_framework'] = 'N/A (CLI)';
    contextSlotsFilled['ui_library'] = 'N/A (CLI)';
    contextSlotsFilled['database'] = 'N/A (CLI)';
    contextSlotsFilled['frontend'] = 'N/A (CLI)';
    // Cargo.toml overrides
    if (cargoTomlData.name && !contextSlotsFilled['project_name']) {
      contextSlotsFilled['project_name'] = cargoTomlData.name;
    }
    if (cargoTomlData.description && !contextSlotsFilled['project_goal']) {
      contextSlotsFilled['project_goal'] = cargoTomlData.description;
    }
  }

  if (isNodeCLI) {
    // Smart slot reuse for CLI projects
    contextSlotsFilled['framework'] = 'CLI';  // frontend = CLI
    contextSlotsFilled['api_type'] = 'CLI';
    contextSlotsFilled['hosting'] = 'npm registry';
    contextSlotsFilled['backend'] = 'Node.js';

    // Detect terminal UI framework
    if (deps?.chalk) {contextSlotsFilled['css_framework'] = 'chalk (terminal colors)';}
    else if (deps?.colors) {contextSlotsFilled['css_framework'] = 'colors';}
    else if (deps?.ora) {contextSlotsFilled['css_framework'] = 'ora';}

    // Detect interactive framework
    if (deps?.inquirer) {contextSlotsFilled['ui_library'] = 'inquirer (interactive prompts)';}
    else if (deps?.prompts) {contextSlotsFilled['ui_library'] = 'prompts';}
    else if (deps?.enquirer) {contextSlotsFilled['ui_library'] = 'enquirer';}

    // Detect CLI framework
    if (deps?.commander) {contextSlotsFilled['cli_framework'] = 'commander';}
    else if (deps?.yargs) {contextSlotsFilled['cli_framework'] = 'yargs';}
    else if (deps?.oclif) {contextSlotsFilled['cli_framework'] = 'oclif';}

    // Detect runtime (Bun takes priority if bun.lockb exists)
    if (isBunProject) {
      contextSlotsFilled['runtime'] = 'Bun';
      contextSlotsFilled['package_manager'] = 'Bun';
    } else if (packageData.engines?.node) {
      contextSlotsFilled['runtime'] = `Node.js ${packageData.engines.node}`;
    } else {
      contextSlotsFilled['runtime'] = 'Node.js v16+';
    }

    // Detect build system
    if (deps?.typescript || deps?.['@types/node']) {
      contextSlotsFilled['build_tool'] = 'TypeScript (tsc)';
    }

    // Detect testing
    if (deps?.jest) {contextSlotsFilled['test_framework'] = 'Jest';}
    else if (deps?.mocha) {contextSlotsFilled['test_framework'] = 'Mocha';}
    else if (deps?.vitest) {contextSlotsFilled['test_framework'] = 'Vitest';}

    // Detect CI/CD - check for .github/workflows directory
    try {
      const githubWorkflowsPath = path.join(projectRoot, '.github', 'workflows');
      const githubWorkflowsExists = await fs.access(githubWorkflowsPath).then(() => true).catch(() => false);
      if (githubWorkflowsExists) {
        contextSlotsFilled['cicd'] = 'GitHub Actions';
      }
    } catch {
      // Continue without CI/CD detection
    }
  }

  // 🦊 Bun Detection - applies to ALL JavaScript/Node.js projects
  if (isBunProject) {
    contextSlotsFilled['runtime'] = 'Bun';
    contextSlotsFilled['package_manager'] = 'Bun';
  }

  // Override with package.json if more specific
  if (packageData.name && !contextSlotsFilled['project_name']) {
    contextSlotsFilled['project_name'] = packageData.name;
  }
  if (packageData.description && !contextSlotsFilled['project_goal']) {
    contextSlotsFilled['project_goal'] = packageData.description;
  }

  // Override with pyproject.toml for Python projects
  if (pyprojectData.name && !contextSlotsFilled['project_name']) {
    contextSlotsFilled['project_name'] = pyprojectData.name;
  }
  if (pyprojectData.description && !contextSlotsFilled['project_goal']) {
    contextSlotsFilled['project_goal'] = pyprojectData.description;
  }

  // Apply README data (human context priority)
  if (readmeData.projectName && !contextSlotsFilled['project_name']) {
    contextSlotsFilled['project_name'] = readmeData.projectName;
  }
  if (readmeData.description && !contextSlotsFilled['project_goal']) {
    contextSlotsFilled['project_goal'] = readmeData.description;
  }
  if (readmeData.targetUser && !contextSlotsFilled['who']) {
    contextSlotsFilled['who'] = readmeData.targetUser;
  }

  // ============================================================================
  // TYPE-AWARE SCORING - Only score applicable slots (N/A = subtract from total)
  // ============================================================================

  // Infer the correct project type from scanner + AI + framework detector
  const inferredType = inferProjectType(
    scanResult,
    contextSlotsFilled['_ai_project_type'],
    frameworkResult,
    projectType
  );

  // Get applicable slots for this project type
  const applicableSlots = getApplicableSlots(inferredType);

  const technicalSlots = [
    'project_name', 'project_goal', 'main_language', 'framework',
    'backend', 'server', 'api_type', 'database', 'hosting',
    'cicd', 'build_tool', 'package_manager', 'test_framework', 'linter'
  ];
  const humanSlots = ['who', 'what', 'why', 'where', 'when', 'how'];

  let technicalFilled = 0;
  let humanFilled = 0;
  let applicableTechCount = 0;
  let applicableHumanCount = 0;

  // First pass: count applicable slots
  technicalSlots.forEach(slot => {
    if (applicableSlots.includes(slot)) {
      applicableTechCount++;
    }
  });
  humanSlots.forEach(slot => {
    if (applicableSlots.includes(slot)) {
      applicableHumanCount++;
    }
  });

  // Scale slot points so max from applicable slots ≈ 86 (same as 21-slot max: 14*4 + 6*5)
  const maxSlotPoints = 86;
  const applicableMaxRaw = applicableTechCount * 4 + applicableHumanCount * 5;
  const slotScale = applicableMaxRaw > 0 ? maxSlotPoints / applicableMaxRaw : 1;

  // Second pass: score filled slots with scaled points
  technicalSlots.forEach(slot => {
    if (applicableSlots.includes(slot) && contextSlotsFilled[slot]) {
      technicalFilled++;
      enhancedScore += 4 * slotScale;
    }
  });

  humanSlots.forEach(slot => {
    if (applicableSlots.includes(slot) && contextSlotsFilled[slot]) {
      humanFilled++;
      enhancedScore += 5 * slotScale;
    }
  });

  const totalApplicable = applicableTechCount + applicableHumanCount;
  const totalFilled = technicalFilled + humanFilled;
  const naSlotCount = 20 - totalApplicable; // How many slots were N/A

  // Quality bonuses from FAB-FORMATS
  if (fabAnalysis.qualityMetrics) {
    const grade = fabAnalysis.qualityMetrics.highestGrade;
    if (grade === 'EXCEPTIONAL') {
      enhancedScore += 20;
    } else if (grade === 'PROFESSIONAL') {
      enhancedScore += 15;
    } else if (grade === 'GOOD') {
      enhancedScore += 10;
    } else if (grade === 'BASIC') {
      enhancedScore += 5;
    }
  }

  // Intelligence depth bonus
  if (fabAnalysis.qualityMetrics.intelligenceDepth > 80) {
    enhancedScore += 15;
  } else if (fabAnalysis.qualityMetrics.intelligenceDepth > 60) {
    enhancedScore += 10;
  } else if (fabAnalysis.qualityMetrics.intelligenceDepth > 40) {
    enhancedScore += 5;
  }

  // TypeScript bonus
  if (tsContext) {
    enhancedScore += 5;
    if ((tsContext as any).strictMode) {
      enhancedScore += 5;
    }
  }

  // Cap at 99% (100% requires human verification)
  const fafScore = Math.min(Math.round(enhancedScore), 99);

  // Build confidence level
  let _confidence = 'LOW';
  if (fafScore >= 85) {_confidence = 'HIGH';}
  else if (fafScore >= 70) {_confidence = 'GOOD';}
  else if (fafScore >= 50) {_confidence = 'MODERATE';}

  // Build quality indicators
  const qualityIndicators = [];
  if (fabAnalysis.qualityMetrics.highestGrade === 'EXCEPTIONAL') {
    qualityIndicators.push('Exceptional project structure');
  }
  if (fabAnalysis.qualityMetrics.filesCovered > 10) {
    qualityIndicators.push('Comprehensive file coverage');
  }
  if (technicalFilled >= 10) {
    qualityIndicators.push('Rich technical context');
  }
  if (humanFilled >= 3) {
    qualityIndicators.push('Strong human context');
  }
  if ((tsContext as any)?.strictMode) {
    qualityIndicators.push('TypeScript strict mode');
  }

  // Extract the stack for display
  // HONEST SCORING: No fake defaults - 0% is a valid score!
  const _stack = {
    frontend: contextSlotsFilled['framework'] || (packageData.dependencies?.react ? 'React' : undefined),
    backend: contextSlotsFilled['backend'],
    database: contextSlotsFilled['database'],
    build: contextSlotsFilled['build_tool'],
    package_manager: contextSlotsFilled['package_manager'] || undefined,
    hosting: contextSlotsFilled['hosting'],
  };

  // Build the data structure for generateFafContent
  // HONEST SCORING: No fake defaults - 0% is a valid score!
  const fafData = {
    projectName: contextSlotsFilled['project_name'] || path.basename(projectRoot),
    projectGoal: contextSlotsFilled['project_goal'] || undefined,
    mainLanguage: contextSlotsFilled['main_language'] || undefined,
    framework: contextSlotsFilled['framework'] || undefined,
    cssFramework: contextSlotsFilled['css_framework'] || undefined,
    uiLibrary: contextSlotsFilled['ui_library'] || undefined,
    stateManagement: undefined,
    backend: contextSlotsFilled['backend'] || undefined,
    apiType: contextSlotsFilled['api_type'] || undefined,
    server: contextSlotsFilled['runtime'] || contextSlotsFilled['server'] || undefined,
    database: contextSlotsFilled['database'] || undefined,
    connection: undefined,
    hosting: contextSlotsFilled['hosting'] || undefined,
    buildTool: contextSlotsFilled['build_tool'] || undefined,
    packageManager: contextSlotsFilled['package_manager'] || undefined,
    cicd: contextSlotsFilled['cicd'] || undefined,
    fafScore,
    slotBasedPercentage: totalApplicable > 0
      ? Math.round((totalFilled / totalApplicable) * 100)
      : 0,
    projectType: inferredType,  // Use inferred type (fixes python-generic misclassification)
    totalSlots: totalApplicable,
    naSlots: naSlotCount,
    // Human Context (Project Details)
    targetUser: contextSlotsFilled['who'],
    coreProblem: contextSlotsFilled['what'],
    missionPurpose: contextSlotsFilled['why'],
    deploymentMarket: contextSlotsFilled['where'],
    timeline: contextSlotsFilled['when'],
    approach: contextSlotsFilled['how'],
    // Quality indicators
    qualityIndicators,
    fabFormatsIntelligence: {
      filesAnalyzed: fabAnalysis.results.length,
      totalIntelligence: fabAnalysis.totalBonus,
      highestGrade: fabAnalysis.qualityMetrics.highestGrade,
      depth: fabAnalysis.qualityMetrics.intelligenceDepth
    },
    // Claude Code detection results
    claudeCode: claudeCodeResult,
    // 🔍 Local Scanner Results (Pauly Engine)
    localScan: {
      languages: scanResult.languageStrings,
      primaryLanguage: scanResult.primaryLanguage,
      structure: scanResult.topLevelStructure,
      totalFiles: scanResult.totalFiles,
      hasLicense: scanResult.hasLicense,
      licenseName: scanResult.licenseName,
      hasTests: scanResult.hasTests,
      hasCiCd: scanResult.hasCiCd,
      cicdPlatform: scanResult.cicdPlatform,
      hasDocker: scanResult.hasDocker,
      qualityScore: scanResult.qualityScore,
      qualityTier: scanResult.qualityTier,
      qualityFactors: scanResult.qualityFactors,
    }
  };

  // Generate YAML content
  const content = generateFafContent(fafData);

  return content;
}

/**
 * Extract context from README.md
 */
function extractReadmeContext(content: string): any {
  const context: any = {};

  // Extract project name from title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    context.projectName = titleMatch[1].trim();
  }

  // Extract description from first paragraph or description section
  const descMatch = content.match(/^#+\s+(?:description|about|overview|introduction)\s*\n+(.+?)(?:\n#|\n\n#|$)/ims);
  if (descMatch) {
    context.description = descMatch[1].trim().substring(0, 200);
  } else {
    // Try to get first paragraph after title
    const firstParaMatch = content.match(/^#\s+.+\n+(.+?)(?:\n#|\n\n#|$)/ms);
    if (firstParaMatch) {
      context.description = firstParaMatch[1].trim().substring(0, 200);
    }
  }

  // Look for target users
  if (content.match(/##\s+(?:for\s+)?(?:developers|engineers|teams)/i)) {
    context.targetUser = 'Developers';
  } else if (content.match(/##\s+(?:for\s+)?(?:users|customers|clients)/i)) {
    context.targetUser = 'End users';
  }

  return context;
}