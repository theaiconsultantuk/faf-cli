/**
 * AI-Optimized YAML Generator v2.5.0
 * Generates .faf files with instant AI onboarding structure
 */

// Helper function to restore markdown formatting from escaped YAML
export function unescapeFromYaml(value: string): string {
  if (!value) {return value;}

  // Remove surrounding quotes if present
  let unquoted = value;
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    unquoted = value.slice(1, -1);
  }

  // Unescape special characters
  unquoted = unquoted.replace(/\\"/g, '"');

  // Could optionally restore markdown if we detect patterns
  // But for now, just return the clean unescaped value
  return unquoted;
}

// Helper function to generate stack string
function generateStackString(data: any): string {
  const parts = [];
  if (data.framework && data.framework !== 'None') {parts.push(data.framework);}
  if (data.mainLanguage && data.mainLanguage !== 'Unknown') {parts.push(data.mainLanguage);}
  if (data.buildTool && data.buildTool !== 'None') {parts.push(data.buildTool);}
  if (data.hosting && data.hosting !== 'None') {parts.push(data.hosting);}
  if (data.backend && data.backend !== 'None') {parts.push(data.backend);}
  return parts.join('/') || 'Not specified';
}

// Helper function to determine confidence level
function getConfidenceLevel(percentage: number): string {
  if (percentage >= 90) {return 'VERY_HIGH';}
  if (percentage >= 80) {return 'HIGH';}
  if (percentage >= 70) {return 'GOOD';}
  if (percentage >= 60) {return 'MODERATE';}
  return 'LOW';
}

// Helper function to safely escape YAML values
// HONEST SCORING: Returns null for empty values - 0% is a valid score!
export function escapeForYaml(value: string | undefined): string | null {
  if (!value) {return null;}

  // Clean up markdown-style lists and formatting
  const cleaned = value
    .replace(/^[\s]*[-*]\s*/gm, '') // Remove list markers
    .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.+?)\*/g, '$1')     // Remove italic
    .replace(/\n+/g, ' ')            // Replace newlines with spaces
    .trim();

  // If it looks like JSON or already quoted, return as-is to avoid double-escaping
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    return cleaned;
  }

  // If it contains special characters or starts with special chars, quote it
  if (cleaned.includes(':') || cleaned.includes('-') || cleaned.includes('[') ||
      cleaned.includes('#') || cleaned.includes('|') || cleaned.includes('>') ||
      cleaned.match(/^[\d\-[\]{}]/)) {
    // Single-escape quotes only
    return `"${cleaned.replace(/"/g, '\\"')}"`;
  }

  return cleaned;
}

// Helper function to detect key files
function detectKeyFiles(data: any): string[] {
  const files = [];
  // Based on framework
  if (data.framework?.toLowerCase().includes('svelte')) {
    files.push('+page.svelte', '+layout.svelte', 'app.html');
  } else if (data.framework?.toLowerCase().includes('react')) {
    files.push('App.tsx', 'index.tsx');
  } else if (data.framework?.toLowerCase().includes('vue')) {
    files.push('App.vue', 'main.ts');
  } else if (data.mainLanguage?.toLowerCase().includes('python')) {
    files.push('main.py', 'requirements.txt');
  } else if (data.mainLanguage?.toLowerCase().includes('rust')) {
    // 🦀 RUST PROJECTS: Cargo.toml and src/main.rs or src/lib.rs
    files.push('Cargo.toml', 'src/main.rs');
    if (data.projectType === 'cli' || data.framework?.toLowerCase().includes('cli')) {
      files.push('src/commands/', 'README.md');
    }
  } else if (data.mainLanguage?.toLowerCase().includes('go')) {
    // 🐹 GO PROJECTS: go.mod and main.go
    files.push('go.mod', 'main.go', 'cmd/');
  } else if (data.mainLanguage?.toLowerCase().includes('zig')) {
    // ⚡ ZIG PROJECTS: build.zig and src/main.zig
    files.push('build.zig', 'src/main.zig');
  }

  // Only add JS/TS config files for actual JavaScript/TypeScript projects
  const isJsTs = data.mainLanguage?.toLowerCase().includes('javascript') ||
                 data.mainLanguage?.toLowerCase().includes('typescript');
  if (isJsTs) {
    files.push('package.json', 'tsconfig.json');
  }

  // C/C++ projects
  if (data.mainLanguage?.toLowerCase() === 'c' || data.mainLanguage?.toLowerCase() === 'c++') {
    files.push('CMakeLists.txt', 'Makefile');
  }

  // Always add README.md if not already there
  if (!files.includes('README.md')) {
    files.push('README.md');
  }

  return files.slice(0, 5); // Max 5 files
}

// Generate project tags
function generateProjectTags(projectData: any) {
  const autoTags = new Set<string>();
  
  // From project name
  if (projectData.projectName) {
    const cleanName = projectData.projectName.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30);
    if (cleanName) {autoTags.add(cleanName);}
  }
  
  // From tech stack
  if (projectData.framework) {autoTags.add(projectData.framework.toLowerCase().replace(/\s+/g, '-'));}
  if (projectData.mainLanguage) {autoTags.add(projectData.mainLanguage.toLowerCase().replace(/\s+/g, '-'));}
  if (projectData.buildTool) {autoTags.add(projectData.buildTool.toLowerCase().replace(/\s+/g, '-'));}
  if (projectData.hosting) {autoTags.add(projectData.hosting.toLowerCase().replace(/\s+/g, '-'));}
  if (projectData.backend) {autoTags.add(projectData.backend.toLowerCase().replace(/\s+/g, '-'));}
  
  // Remove empty tags
  autoTags.delete('');
  autoTags.delete('-');
  
  const year = new Date().getFullYear().toString();
  const smartTags: string[] = [
    '.faf',      // ALWAYS - Ecosystem builder!
    'ai-ready',  // ALWAYS - We're AI-optimized
    year,        // Current year for freshness
  ];
  
  // Smart category detection
  if (projectData.projectGoal?.toLowerCase().includes('api') || projectData.framework?.toLowerCase().includes('express')) {
    smartTags.push('backend-api');
  } else if (projectData.framework?.toLowerCase().match(/react|vue|svelte|angular/)) {
    smartTags.push('web-app');
  } else if (projectData.projectGoal?.toLowerCase().includes('library')) {
    smartTags.push('dev-tools');
  } else {
    smartTags.push('software');
  }
  
  // License/sharing detection (simplified for now)
  smartTags.push('open-source'); // Default to open-source for community
  
  return {
    auto_generated: Array.from(autoTags).slice(0, 21),
    smart_defaults: smartTags,
    user_defined: []
  };
}

/**
 * Convert JavaScript object to YAML format
 */
function objectToYaml(obj: Record<string, any>, indent = 0): string {
  let yaml = '';
  const spacing = '  '.repeat(indent);
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {continue;}
    
    if (typeof value === 'object' && !Array.isArray(value)) {
      yaml += `${spacing}${key}:\n`;
      yaml += objectToYaml(value, indent + 1);
    } else if (Array.isArray(value)) {
      yaml += `${spacing}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          // Handle objects in arrays (e.g. structure files)
          const entries = Object.entries(item);
          if (entries.length > 0) {
            yaml += `${spacing}  - {${entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`).join(', ')}}\n`;
          }
        } else {
          // Also escape array items if they're strings
          const escapedItem = typeof item === 'string' ? escapeForYaml(item) : item;
          yaml += `${spacing}  - ${escapedItem}\n`;
        }
      }
    } else {
      // ALWAYS use escapeForYaml for strings to remove markdown and special chars
      let escapedValue = value;
      if (typeof value === 'string') {
        escapedValue = escapeForYaml(value);
      }
      yaml += `${spacing}${key}: ${escapedValue}\n`;
    }
  }
  
  return yaml;
}

// HONEST SCORING: All fields optional - 0% is a valid score!
export function generateFafContent(projectData: {
  projectName: string;
  projectGoal?: string;
  mainLanguage?: string;
  framework?: string;
  cssFramework?: string;
  uiLibrary?: string;
  stateManagement?: string;
  backend?: string;
  apiType?: string;
  server?: string;
  database?: string;
  connection?: string;
  hosting?: string;
  buildTool?: string;
  packageManager?: string;
  cicd?: string;
  fafScore: number;
  slotBasedPercentage: number;
  projectType?: string;  // Project type for compiler slot-filling patterns
  totalSlots?: number;   // Applicable slots (after N/A subtraction)
  naSlots?: number;      // Number of N/A slots subtracted
  // Human Context (Project Details)
  targetUser?: string;
  coreProblem?: string;
  missionPurpose?: string;
  deploymentMarket?: string;
  timeline?: string;
  approach?: string;
  // Additional Context Arrays (magical + add Context)
  additionalWho?: string[];
  additionalWhat?: string[];
  additionalWhy?: string[];
  additionalWhere?: string[];
  additionalWhen?: string[];
  additionalHow?: string[];
  projectDetailsScore?: number;
  projectSuccessRate?: number;
  // Claude Code detection (2.1.0+)
  claudeCode?: {
    detected: boolean;
    subagents: string[];
    commands: string[];
    skills: string[];  // Claude Code 2.1.0+
    permissions: string[];
    hasClaudeMd: boolean;
    mcpServers: string[];
  } | null;
  // Local Scanner Results (Pauly Engine)
  localScan?: {
    languages: string[];
    primaryLanguage: string;
    structure: { path: string; type: 'file' | 'dir'; size: number }[];
    totalFiles: number;
    hasLicense: boolean;
    licenseName?: string;
    hasTests: boolean;
    hasCiCd: boolean;
    cicdPlatform?: string;
    hasDocker: boolean;
    qualityScore: number;
    qualityTier: string;
    qualityFactors: Record<string, boolean>;
  };
}): string {
  // Calculate filled vs total slots for missing context
  // N/A slots are subtracted from total (type-aware scoring)
  const totalSlotsCount = projectData.totalSlots || 21;
  const naCount = projectData.naSlots || 0;
  const filledSlotsCount = Math.round((projectData.slotBasedPercentage / 100) * totalSlotsCount);
  const missingSlots = [];
  if (!projectData.targetUser) {missingSlots.push('Target users');}
  if (!projectData.coreProblem) {missingSlots.push('Core problem');}
  if (!projectData.timeline) {missingSlots.push('Timeline');}
  if (!projectData.cicd || projectData.cicd === 'None') {missingSlots.push('CI/CD pipeline');}
  if (!projectData.database || projectData.database === 'None') {missingSlots.push('Database');}

  const fafData = {
    // FAF schema version (not CLI version)
    faf_version: '2.5.0',
    // Generated timestamp (required by schema)
    generated: new Date().toISOString(),
    // 🤖 AI-FIRST SCORING SYSTEM - Championship Engine with FAB-FORMATS
    ai_scoring_system: '2025-09-20',  // faf-engine-mk3 compiler live date
    ai_score: `${projectData.fafScore}%`,  // MY evaluation
    ai_confidence: getConfidenceLevel(projectData.fafScore),  // MY trust level
    ai_value: '30_seconds_replaces_20_minutes_of_questions',
    
    // 🧠 AI READ THIS FIRST - 5-LINE TL;DR
    // HONEST SCORING: No fake branding - show only detected values
    ai_tldr: {
      project: projectData.projectGoal
        ? `${projectData.projectName} - ${escapeForYaml(projectData.projectGoal)}`
        : projectData.projectName,
      stack: generateStackString(projectData),
      quality_bar: 'ZERO_ERRORS_F1_STANDARDS',
      current_focus: projectData.projectGoal ? 'Production deployment preparation' : 'Project initialization',
      your_role: 'Build features with perfect context'
    },

    // ⚡ INSTANT CONTEXT - Everything critical in one place
    // HONEST SCORING: null for undetected values - 0% is a valid score!
    instant_context: {
      what_building: projectData.projectGoal ? escapeForYaml(projectData.projectGoal) : null,
      tech_stack: generateStackString(projectData),
      main_language: projectData.mainLanguage || null,
      deployment: projectData.hosting || null,
      key_files: detectKeyFiles(projectData)
    },
    
    // 📊 CONTEXT QUALITY METRICS
    context_quality: {
      slots_filled: `${filledSlotsCount}/${totalSlotsCount} (${projectData.slotBasedPercentage}%)`,
      ai_confidence: getConfidenceLevel(projectData.slotBasedPercentage),
      handoff_ready: projectData.slotBasedPercentage > 70,
      missing_context: missingSlots.length > 0 ? missingSlots : ['None - fully specified!']
    },
    
    // 📄 Project Details (Progressive Disclosure)
    // HONEST SCORING: null for undetected values - 0% is a valid score!
    project: {
      name: projectData.projectName || 'Untitled Project',
      goal: projectData.projectGoal ? escapeForYaml(projectData.projectGoal) : null,
      main_language: projectData.mainLanguage || 'Unknown',
      type: projectData.projectType || null,  // Project type for compiler slot-filling patterns
    },
    
    // 🧠 AI OPERATING INSTRUCTIONS
    ai_instructions: {
      priority_order: [
        '1. Read THIS .faf file first',
        '2. Check CLAUDE.md for session context',
        '3. Review project dependencies and structure'
      ],
      working_style: {
        code_first: true,
        explanations: 'minimal',
        quality_bar: 'zero_errors',
        testing: 'required'
      },
      warnings: [
        'Follow existing code conventions',
        'Test changes before committing'
      ]
    },
    
    // 🏗️ Technical Stack (Full Details)
    // HONEST SCORING: null for undetected values - 0% is a valid score!
    stack: {
      frontend: projectData.framework || null,
      css_framework: projectData.cssFramework || null,
      ui_library: projectData.uiLibrary || null,
      state_management: projectData.stateManagement || null,
      backend: projectData.backend || null,
      runtime: projectData.server || null,
      database: projectData.database || null,
      build: projectData.buildTool || (projectData.projectType === 'static-html' || projectData.projectType === 'landing-page' ? 'Direct HTML (no build step)' : null),
      package_manager: projectData.packageManager || null,
      api_type: projectData.apiType || null,
      hosting: projectData.hosting || null,
      cicd: projectData.cicd || null
    },
    
    // ⚙️ Development Preferences
    preferences: {
      quality_bar: 'zero_errors',
      commit_style: 'conventional_emoji',
      response_style: 'concise_code_first',
      explanation_level: 'minimal',
      communication: 'direct',
      testing: 'required',
      documentation: 'as_needed'
    },
    
    // 🚀 Project State
    state: {
      phase: 'development',
      status: 'active',
      blockers: []
    },

    // 📊 Scores (required by schema)
    scores: {
      faf_score: projectData.fafScore || 0,
      slot_based_percentage: projectData.slotBasedPercentage || 0,
      total_slots: totalSlotsCount,
      na_slots: naCount > 0 ? naCount : undefined,
      scoring_philosophy: 'F1-Inspired Championship Scoring'
    },

    // 🏷️ Search & Discovery Tags
    tags: generateProjectTags(projectData),
    
    // 👥 Human Context (The 6 W's) - HONEST SCORING: null fields stay null!
    human_context: projectData.targetUser || projectData.coreProblem ? {
      who: escapeForYaml(projectData.targetUser) || null,
      what: escapeForYaml(projectData.coreProblem) || null,
      why: escapeForYaml(projectData.missionPurpose) || null,
      where: escapeForYaml(projectData.deploymentMarket) || null,
      when: escapeForYaml(projectData.timeline) || null,
      how: escapeForYaml(projectData.approach) || null,
      additional_context: {
        who: projectData.additionalWho && projectData.additionalWho.length > 0 ? projectData.additionalWho : undefined,
        what: projectData.additionalWhat && projectData.additionalWhat.length > 0 ? projectData.additionalWhat : undefined,
        why: projectData.additionalWhy && projectData.additionalWhy.length > 0 ? projectData.additionalWhy : undefined,
        where: projectData.additionalWhere && projectData.additionalWhere.length > 0 ? projectData.additionalWhere : undefined,
        when: projectData.additionalWhen && projectData.additionalWhen.length > 0 ? projectData.additionalWhen : undefined,
        how: projectData.additionalHow && projectData.additionalHow.length > 0 ? projectData.additionalHow : undefined
      },
      context_score: projectData.projectDetailsScore || 0,
      total_prd_score: (projectData.projectDetailsScore || 0) + (projectData.fafScore || 0),
      success_rate: `${projectData.projectSuccessRate || 50}%`
    } : undefined,
    
    // 📊 AI Scoring Details (For Transparency)
    ai_scoring_details: {
      system_date: '2025-09-20',  // faf-engine-mk3 Championship Engine
      slot_based_percentage: projectData.slotBasedPercentage,
      ai_score: projectData.fafScore,
      total_slots: totalSlotsCount,
      filled_slots: filledSlotsCount,
      na_slots: naCount > 0 ? naCount : undefined,
      scoring_method: 'Honest percentage - no fake minimums',
      trust_embedded: 'COUNT ONCE architecture - trust MY embedded scores'
    },

    // 🔍 Languages Detected (Local Scanner - matches GitHub API format)
    languages: projectData.localScan?.languages && projectData.localScan.languages.length > 0
      ? { detected: projectData.localScan.languages }
      : undefined,

    // 📁 Project Structure (Top-level)
    structure: projectData.localScan?.structure
      ? {
          total_files: projectData.localScan.totalFiles,
          files: projectData.localScan.structure.slice(0, 30),
        }
      : undefined,

    // 📋 Local Quality Assessment
    local_quality: projectData.localScan ? {
      score: projectData.localScan.qualityScore,
      tier: projectData.localScan.qualityTier,
      factors: projectData.localScan.qualityFactors,
      license: projectData.localScan.licenseName || (projectData.localScan.hasLicense ? 'Detected' : 'Not found'),
    } : undefined,

    // 🤖 Claude Code Integration (Boris-friendly detection, 2.1.0+)
    claude_code: projectData.claudeCode?.detected ? {
      detected: true,
      has_claude_md: projectData.claudeCode.hasClaudeMd,
      subagents: projectData.claudeCode.subagents.length > 0 ? projectData.claudeCode.subagents : undefined,
      commands: projectData.claudeCode.commands.length > 0 ? projectData.claudeCode.commands : undefined,
      skills: projectData.claudeCode.skills?.length > 0 ? projectData.claudeCode.skills : undefined,
      permissions: projectData.claudeCode.permissions.length > 0 ? projectData.claudeCode.permissions : undefined,
      mcp_servers: projectData.claudeCode.mcpServers.length > 0 ? projectData.claudeCode.mcpServers : undefined
    } : undefined
  };

  // Use native YAML library and fix any !CI placeholder issues
  const yamlContent = objectToYaml(fafData);
  
  // Fix any !CI placeholders (should not occur with proper data)
  const cleanedContent = yamlContent
    .replace(/what_building: !CI/g, 'what_building: null')
    .replace(/goal: !CI/g, 'goal: null');

  return cleanedContent;
}