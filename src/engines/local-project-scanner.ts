/**
 * 🔍 Local Project Scanner
 *
 * Brings faf-git-level intelligence to local project scanning.
 * Scans file extensions for language percentages, parses README
 * structure, cross-references README against code, and calculates
 * quality scores - all without GitHub API.
 *
 * Created by Paul Cowen's fork to close the gap between
 * faf init (33%) and faf git (90%).
 */

import { promises as fs } from "fs";
import path from "path";

// ============================================================================
// LANGUAGE DETECTION - File extension to language mapping
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // C/C++ family
  '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++',
  '.hpp': 'C++', '.hh': 'C++', '.hxx': 'C++', '.c++': 'C++',
  '.m': 'Objective-C', '.mm': 'Objective-C++',

  // Web languages
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
  '.svelte': 'Svelte', '.vue': 'Vue',

  // Systems languages
  '.rs': 'Rust', '.go': 'Go', '.zig': 'Zig',
  '.swift': 'Swift', '.kt': 'Kotlin', '.kts': 'Kotlin',

  // JVM
  '.java': 'Java', '.scala': 'Scala', '.clj': 'Clojure',
  '.groovy': 'Groovy', '.gradle': 'Groovy',

  // Scripting
  '.py': 'Python', '.pyw': 'Python', '.pyi': 'Python',
  '.rb': 'Ruby', '.erb': 'Ruby',
  '.php': 'PHP',
  '.pl': 'Perl', '.pm': 'Perl',
  '.lua': 'Lua',
  '.r': 'R', '.R': 'R',
  '.jl': 'Julia',

  // Shell
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.fish': 'Shell', '.ps1': 'PowerShell', '.bat': 'Batchfile',
  '.cmd': 'Batchfile',

  // Data/Config
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML', '.xml': 'XML', '.ini': 'INI',

  // GPU/Shader
  '.cu': 'Cuda', '.cuh': 'Cuda',
  '.metal': 'Metal',
  '.glsl': 'GLSL', '.vert': 'GLSL', '.frag': 'GLSL',
  '.wgsl': 'WGSL', '.hlsl': 'HLSL',

  // Build/Config
  '.cmake': 'CMake',

  // .NET
  '.cs': 'C#', '.fs': 'F#', '.vb': 'Visual Basic',

  // Functional
  '.ex': 'Elixir', '.exs': 'Elixir',
  '.erl': 'Erlang', '.hrl': 'Erlang',
  '.hs': 'Haskell', '.lhs': 'Haskell',
  '.ml': 'OCaml', '.mli': 'OCaml',

  // Mobile
  '.dart': 'Dart',

  // Misc
  '.sol': 'Solidity', '.v': 'V', '.nim': 'Nim',
  '.d': 'D', '.cr': 'Crystal',

  // Markup/Doc
  '.md': 'Markdown', '.rst': 'reStructuredText',
  '.tex': 'TeX', '.latex': 'TeX',

  // Docker
  // (Dockerfile has no extension - handled separately)
};

// Special filenames that indicate a language
const FILENAME_TO_LANGUAGE: Record<string, string> = {
  'Dockerfile': 'Dockerfile',
  'Makefile': 'Makefile',
  'CMakeLists.txt': 'CMake',
  'Rakefile': 'Ruby',
  'Gemfile': 'Ruby',
  'Vagrantfile': 'Ruby',
  'Justfile': 'Just',
  'Taskfile.yml': 'YAML',
};

// Directories to always skip during scanning
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
  'venv', '.venv', 'env', '.env', 'vendor', 'target', '.cargo',
  'coverage', '.idea', '.vscode', 'tmp', 'temp', 'logs',
  '.cache', '.parcel-cache', '.turbo', '.output',
  'bower_components', 'jspm_packages',
  'zig-cache', 'zig-out',
]);

// Files to skip (binary, generated, etc.)
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flac', '.ogg',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj', '.a',
  '.lock', '.lockb',
  '.map', '.min.js', '.min.css',
  '.pyc', '.pyo', '.class',
  '.db', '.sqlite', '.sqlite3',
]);

// Languages to exclude from percentage reporting (config/data only)
const EXCLUDE_FROM_PERCENTAGES = new Set([
  'JSON', 'YAML', 'TOML', 'XML', 'INI', 'Markdown',
  'reStructuredText', 'TeX',
]);

// ============================================================================
// INTERFACES
// ============================================================================

export interface LanguageBreakdown {
  language: string;
  bytes: number;
  percentage: number;
  fileCount: number;
}

export interface ReadmeContext {
  exists: boolean;
  name?: string;
  description?: string;
  sections: Record<string, string>;  // section heading -> content
  who?: string;
  what?: string;
  why?: string;
  where?: string;
  when?: string;
  how?: string;
  badges?: string[];
  license?: string;
}

export interface LocalScanResult {
  languages: LanguageBreakdown[];
  languageStrings: string[];  // Format: "C++ (52.0%)" like GitHub API
  primaryLanguage: string;
  readme: ReadmeContext;
  hasLicense: boolean;
  licenseName?: string;
  hasTests: boolean;
  hasCiCd: boolean;
  cicdPlatform?: string;
  hasDocker: boolean;
  totalFiles: number;
  totalBytes: number;
  topLevelStructure: { path: string; type: 'file' | 'dir'; size: number }[];
  qualityScore: number;
  qualityTier: string;
  qualityFactors: Record<string, boolean>;
}

// ============================================================================
// MAIN SCANNER CLASS
// ============================================================================

export class LocalProjectScanner {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Full scan - produces equivalent data to faf git's GitHub API calls
   */
  async scan(): Promise<LocalScanResult> {
    // Run independent scans in parallel
    const [
      languageResult,
      readmeResult,
      licenseResult,
      structureResult,
      cicdResult,
    ] = await Promise.all([
      this.scanLanguages(),
      this.parseReadme(),
      this.detectLicense(),
      this.scanTopLevelStructure(),
      this.detectCiCd(),
    ]);

    const hasTests = await this.detectTests();
    const hasDocker = await this.detectDocker();

    // Calculate quality score
    const qualityFactors = {
      has_description: !!readmeResult.description,
      has_readme: readmeResult.exists,
      has_license: licenseResult.hasLicense,
      has_tests: hasTests,
      has_cicd: cicdResult.hasCiCd,
      has_docker: hasDocker,
      has_multiple_languages: languageResult.languages.length >= 2,
      has_structured_readme: Object.keys(readmeResult.sections).length >= 3,
    };

    const qualityScore = this.calculateQualityScore(qualityFactors, languageResult, readmeResult);
    const qualityTier = this.getScoreTier(qualityScore);

    return {
      languages: languageResult.languages,
      languageStrings: languageResult.languageStrings,
      primaryLanguage: languageResult.primaryLanguage,
      readme: readmeResult,
      hasLicense: licenseResult.hasLicense,
      licenseName: licenseResult.licenseName,
      hasTests,
      hasCiCd: cicdResult.hasCiCd,
      cicdPlatform: cicdResult.platform,
      hasDocker,
      totalFiles: languageResult.totalFiles,
      totalBytes: languageResult.totalBytes,
      topLevelStructure: structureResult,
      qualityScore,
      qualityTier,
      qualityFactors,
    };
  }

  // ============================================================================
  // LANGUAGE SCANNING
  // ============================================================================

  private async scanLanguages(): Promise<{
    languages: LanguageBreakdown[];
    languageStrings: string[];
    primaryLanguage: string;
    totalFiles: number;
    totalBytes: number;
  }> {
    const languageBytes: Record<string, { bytes: number; files: number }> = {};
    let totalFiles = 0;
    let totalBytes = 0;

    await this.walkDirectory(this.projectRoot, (filePath, stats) => {
      const ext = path.extname(filePath).toLowerCase();
      const basename = path.basename(filePath);

      // Skip binary/generated files
      if (SKIP_EXTENSIONS.has(ext)) return;

      // Determine language from extension or filename
      let language = EXTENSION_TO_LANGUAGE[ext] || FILENAME_TO_LANGUAGE[basename];
      if (!language) return;

      const size = stats.size;
      totalFiles++;
      totalBytes += size;

      if (!languageBytes[language]) {
        languageBytes[language] = { bytes: 0, files: 0 };
      }
      languageBytes[language].bytes += size;
      languageBytes[language].files++;
    });

    // Calculate percentages (excluding config-only languages from display)
    const codeTotalBytes = Object.entries(languageBytes)
      .filter(([lang]) => !EXCLUDE_FROM_PERCENTAGES.has(lang))
      .reduce((sum, [, data]) => sum + data.bytes, 0);

    const languages: LanguageBreakdown[] = Object.entries(languageBytes)
      .filter(([lang]) => !EXCLUDE_FROM_PERCENTAGES.has(lang))
      .map(([language, data]) => ({
        language,
        bytes: data.bytes,
        percentage: codeTotalBytes > 0 ? (data.bytes / codeTotalBytes) * 100 : 0,
        fileCount: data.files,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    // Format like GitHub API: "C++ (52.0%)"
    const languageStrings = languages.map(
      l => `${l.language} (${l.percentage.toFixed(1)}%)`
    );

    const primaryLanguage = languages.length > 0 ? languages[0].language : 'Unknown';

    return { languages, languageStrings, primaryLanguage, totalFiles, totalBytes };
  }

  /**
   * Walk directory recursively, calling callback for each file
   */
  private async walkDirectory(
    dirPath: string,
    callback: (filePath: string, stats: { size: number }) => void
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // Permission denied or other error
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await this.walkDirectory(fullPath, callback);
      } else if (entry.isFile()) {
        try {
          const stats = await fs.stat(fullPath);
          callback(fullPath, { size: stats.size });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  // ============================================================================
  // README PARSING - Structured markdown analysis
  // ============================================================================

  async parseReadme(): Promise<ReadmeContext> {
    const readmePath = await this.findReadme();
    if (!readmePath) {
      return { exists: false, sections: {} };
    }

    let content: string;
    try {
      content = await fs.readFile(readmePath, 'utf-8');
    } catch {
      return { exists: false, sections: {} };
    }

    const result: ReadmeContext = {
      exists: true,
      sections: {},
    };

    // Parse H1 as project name
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      // Clean badges and links from the name
      result.name = h1Match[1]
        .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // Remove badge links
        .replace(/!\[.*?\]\(.*?\)/g, '')              // Remove inline images
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // Convert links to text
        .replace(/<[^>]+>/g, '')                       // Remove HTML tags
        .trim();
    }

    // Parse description from content after H1
    // Skip badge lines, image lines, and empty lines to find actual description
    const h1End = content.match(/^#\s+.+$/m);
    if (h1End) {
      const afterH1 = content.substring(h1End.index! + h1End[0].length);
      const lines = afterH1.split('\n');
      let descLines: string[] = [];
      let foundDesc = false;

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines
        if (!trimmed) {
          if (foundDesc) break; // End of description paragraph
          continue;
        }
        // Skip image lines: ![...](...)
        if (trimmed.match(/^!\[.*?\]\(.*?\)$/)) continue;
        // Skip badge lines: [![...](...)](...)
        if (trimmed.match(/^\[!\[.*?\]\(.*?\)\]\(.*?\)$/)) continue;
        // Skip lines that are just links (version/roadmap lines etc.)
        if (trimmed.match(/^(?:Stable|Latest|Version):/i)) continue;
        // Skip heading lines
        if (trimmed.startsWith('#')) break;

        // This is actual content
        foundDesc = true;
        descLines.push(trimmed);
      }

      if (descLines.length > 0) {
        let desc = descLines.join(' ');
        // Clean markdown formatting
        desc = desc
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Links to text
          .replace(/\*\*(.+?)\*\*/g, '$1')            // Bold
          .replace(/\*(.+?)\*/g, '$1')                 // Italic
          .replace(/`(.+?)`/g, '$1')                   // Inline code
          .replace(/!\[.*?\]\(.*?\)/g, '')              // Images
          .replace(/<[^>]+>/g, '')                       // HTML
          .trim();
        // Take first 500 chars (generous but bounded)
        result.description = desc.substring(0, 500);
      }
    }

    // Parse all ## sections
    const sectionRegex = /^##\s+(.+)$/gm;
    let match;
    const sectionPositions: { heading: string; start: number }[] = [];

    while ((match = sectionRegex.exec(content)) !== null) {
      sectionPositions.push({
        heading: match[1].trim(),
        start: match.index + match[0].length,
      });
    }

    // Extract section content
    for (let i = 0; i < sectionPositions.length; i++) {
      const section = sectionPositions[i];
      const nextStart = i + 1 < sectionPositions.length
        ? sectionPositions[i + 1].start - sectionPositions[i + 1].heading.length - 3
        : content.length;

      const sectionContent = content
        .substring(section.start, nextStart)
        .trim()
        .substring(0, 1000); // Cap per section

      const normalizedHeading = section.heading.toLowerCase();
      result.sections[normalizedHeading] = sectionContent;
    }

    // Extract the 6 W's from sections
    result.who = this.extractWho(result.sections, content);
    result.what = this.extractWhat(result.sections, result.description);
    result.why = this.extractWhy(result.sections, content);
    result.where = this.extractWhere(result.sections, content);
    result.when = this.extractWhen(result.sections, content);
    result.how = this.extractHow(result.sections, content);

    // Detect badges
    const badgeMatches = content.match(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g);
    if (badgeMatches) {
      result.badges = badgeMatches.map(b => {
        const altMatch = b.match(/!\[(.+?)\]/);
        return altMatch ? altMatch[1] : 'badge';
      });
    }

    // Detect license mention
    const licenseSection = Object.keys(result.sections).find(
      k => k.includes('license') || k.includes('licence')
    );
    if (licenseSection) {
      result.license = result.sections[licenseSection].substring(0, 100);
    }

    return result;
  }

  private async findReadme(): Promise<string | null> {
    const candidates = ['README.md', 'readme.md', 'Readme.md', 'README.rst', 'README.txt', 'README'];
    for (const name of candidates) {
      const fullPath = path.join(this.projectRoot, name);
      try {
        await fs.access(fullPath);
        return fullPath;
      } catch {
        continue;
      }
    }
    return null;
  }

  // 6 W's extraction helpers
  private extractWho(sections: Record<string, string>, fullContent: string): string | undefined {
    // Check common section names
    for (const key of Object.keys(sections)) {
      if (key.match(/^(target|audience|for|users?|who|contributors?)/i)) {
        return this.cleanSectionContent(sections[key]);
      }
    }
    // Check for "for developers/users" patterns in content
    const forMatch = fullContent.match(/(?:built|designed|made|created)\s+(?:for|by)\s+([^.!\n]+)/i);
    if (forMatch) return forMatch[1].trim();
    return undefined;
  }

  private extractWhat(sections: Record<string, string>, description?: string): string | undefined {
    // Check sections first for explicit "what" content
    for (const key of Object.keys(sections)) {
      if (key.match(/^(what|about|overview|description|introduction|summary)/i)) {
        return this.cleanSectionContent(sections[key]);
      }
    }
    // Fall back to the description
    if (description) return description;
    return undefined;
  }

  private extractWhy(sections: Record<string, string>, fullContent: string): string | undefined {
    for (const key of Object.keys(sections)) {
      if (key.match(/^(why|motivation|purpose|problem|background|rationale)/i)) {
        return this.cleanSectionContent(sections[key]);
      }
    }
    return undefined;
  }

  private extractWhere(sections: Record<string, string>, fullContent: string): string | undefined {
    for (const key of Object.keys(sections)) {
      if (key.match(/^(deploy|hosting|where|platform|installation|getting.?started)/i)) {
        return this.cleanSectionContent(sections[key]);
      }
    }
    return undefined;
  }

  private extractWhen(sections: Record<string, string>, fullContent: string): string | undefined {
    for (const key of Object.keys(sections)) {
      if (key.match(/^(roadmap|timeline|when|changelog|release|version)/i)) {
        return this.cleanSectionContent(sections[key]);
      }
    }
    return undefined;
  }

  private extractHow(sections: Record<string, string>, fullContent: string): string | undefined {
    for (const key of Object.keys(sections)) {
      if (key.match(/^(how|usage|quick.?start|getting.?started|installation|setup)/i)) {
        return this.cleanSectionContent(sections[key]);
      }
    }
    return undefined;
  }

  private cleanSectionContent(content: string): string {
    return content
      .replace(/```[\s\S]*?```/g, '')   // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Links to text
      .replace(/\*\*(.+?)\*\*/g, '$1')   // Bold
      .replace(/\*(.+?)\*/g, '$1')        // Italic
      .replace(/`(.+?)`/g, '$1')          // Inline code
      .replace(/!\[.*?\]\(.*?\)/g, '')     // Images
      .replace(/<[^>]+>/g, '')              // HTML
      .trim()
      .substring(0, 300);
  }

  // ============================================================================
  // LICENSE DETECTION
  // ============================================================================

  private async detectLicense(): Promise<{ hasLicense: boolean; licenseName?: string }> {
    const licenseFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING'];
    for (const name of licenseFiles) {
      const fullPath = path.join(this.projectRoot, name);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const licenseName = this.identifyLicense(content);
        return { hasLicense: true, licenseName };
      } catch {
        continue;
      }
    }
    return { hasLicense: false };
  }

  private identifyLicense(content: string): string {
    const upper = content.toUpperCase();
    if (upper.includes('MIT LICENSE') || upper.includes('PERMISSION IS HEREBY GRANTED')) return 'MIT';
    if (upper.includes('APACHE LICENSE') && upper.includes('VERSION 2.0')) return 'Apache-2.0';
    if (upper.includes('GNU GENERAL PUBLIC LICENSE') && upper.includes('VERSION 3')) return 'GPL-3.0';
    if (upper.includes('GNU GENERAL PUBLIC LICENSE') && upper.includes('VERSION 2')) return 'GPL-2.0';
    if (upper.includes('GNU LESSER GENERAL PUBLIC')) return 'LGPL';
    if (upper.includes('BSD 2-CLAUSE') || upper.includes('SIMPLIFIED BSD')) return 'BSD-2-Clause';
    if (upper.includes('BSD 3-CLAUSE') || upper.includes('NEW BSD')) return 'BSD-3-Clause';
    if (upper.includes('ISC LICENSE')) return 'ISC';
    if (upper.includes('MOZILLA PUBLIC LICENSE')) return 'MPL-2.0';
    if (upper.includes('UNLICENSE') || upper.includes('PUBLIC DOMAIN')) return 'Unlicense';
    if (upper.includes('CREATIVE COMMONS')) return 'CC';
    return 'Custom';
  }

  // ============================================================================
  // TEST DETECTION
  // ============================================================================

  private async detectTests(): Promise<boolean> {
    const testDirs = ['test', 'tests', '__tests__', 'spec', 'specs', 'test_', 'testing'];
    for (const dir of testDirs) {
      try {
        const fullPath = path.join(this.projectRoot, dir);
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) return true;
      } catch {
        continue;
      }
    }
    // Check for test config files
    const testConfigs = [
      'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
      'pytest.ini', 'setup.cfg', 'tox.ini',
      'cypress.config.js', 'playwright.config.ts',
      '.rspec',
    ];
    for (const config of testConfigs) {
      try {
        await fs.access(path.join(this.projectRoot, config));
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  // ============================================================================
  // CI/CD DETECTION
  // ============================================================================

  private async detectCiCd(): Promise<{ hasCiCd: boolean; platform?: string }> {
    const ciChecks: [string, string][] = [
      ['.github/workflows', 'GitHub Actions'],
      ['.gitlab-ci.yml', 'GitLab CI'],
      ['Jenkinsfile', 'Jenkins'],
      ['.circleci/config.yml', 'CircleCI'],
      ['.travis.yml', 'Travis CI'],
      ['azure-pipelines.yml', 'Azure Pipelines'],
      ['bitbucket-pipelines.yml', 'Bitbucket Pipelines'],
      ['.drone.yml', 'Drone CI'],
    ];

    for (const [filePath, platform] of ciChecks) {
      try {
        await fs.access(path.join(this.projectRoot, filePath));
        return { hasCiCd: true, platform };
      } catch {
        continue;
      }
    }
    return { hasCiCd: false };
  }

  // ============================================================================
  // DOCKER DETECTION
  // ============================================================================

  private async detectDocker(): Promise<boolean> {
    const dockerFiles = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'];
    for (const file of dockerFiles) {
      try {
        await fs.access(path.join(this.projectRoot, file));
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  // ============================================================================
  // TOP-LEVEL STRUCTURE
  // ============================================================================

  private async scanTopLevelStructure(): Promise<{ path: string; type: 'file' | 'dir'; size: number }[]> {
    try {
      const entries = await fs.readdir(this.projectRoot, { withFileTypes: true });
      const results: { path: string; type: 'file' | 'dir'; size: number }[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.devops') {
          continue; // Skip hidden files except .github and .devops
        }
        try {
          const fullPath = path.join(this.projectRoot, entry.name);
          const stats = await fs.stat(fullPath);
          results.push({
            path: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
            size: entry.isDirectory() ? 0 : stats.size,
          });
        } catch {
          continue;
        }
      }

      return results.sort((a, b) => a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // QUALITY SCORING - Mirrors faf git's calculateRepoQualityScore
  // ============================================================================

  private calculateQualityScore(
    factors: Record<string, boolean>,
    langResult: { languages: LanguageBreakdown[]; totalFiles: number },
    readmeResult: ReadmeContext
  ): number {
    let score = 0;

    // Has README (15 points - local projects don't have stars, so README is more important)
    if (factors.has_readme) score += 15;

    // Has description in README (15 points)
    if (factors.has_description) score += 15;

    // Has structured README with 3+ sections (10 points)
    if (factors.has_structured_readme) score += 10;

    // Has license (10 points)
    if (factors.has_license) score += 10;

    // Has tests (10 points)
    if (factors.has_tests) score += 10;

    // Has CI/CD (10 points)
    if (factors.has_cicd) score += 10;

    // Has Docker (5 points)
    if (factors.has_docker) score += 5;

    // Language diversity (10 points)
    if (langResult.languages.length >= 3) score += 10;
    else if (langResult.languages.length >= 2) score += 5;

    // File count - indicates real project (10 points)
    if (langResult.totalFiles >= 50) score += 10;
    else if (langResult.totalFiles >= 20) score += 7;
    else if (langResult.totalFiles >= 5) score += 3;

    // Human context from README (5 points - bonus for well-documented projects)
    const wCount = [readmeResult.who, readmeResult.what, readmeResult.why,
                    readmeResult.where, readmeResult.when, readmeResult.how]
      .filter(Boolean).length;
    if (wCount >= 3) score += 5;

    return Math.min(100, score);
  }

  private getScoreTier(score: number): string {
    if (score >= 100) return '🏆 Trophy';
    if (score >= 99) return '🥇 Gold';
    if (score >= 95) return '🥈 Silver';
    if (score >= 85) return '🥉 Bronze';
    if (score >= 70) return '🟢 Green';
    if (score >= 55) return '🟡 Yellow';
    if (score > 0) return '🔴 Red';
    return '🤍 White';
  }
}
