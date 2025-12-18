/**
 * Strategy Loader
 *
 * Parses markdown strategy definition files and builds StrategyDefinition objects.
 */

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { StrategyDefinition, StrategyParameter, RiskManagementRules } from '../bots/types';

const STRATEGIES_DIR = path.join(process.cwd(), 'src', 'strategies');

/**
 * Parse a markdown strategy file into a StrategyDefinition
 */
export function parseStrategyFile(filePath: string): StrategyDefinition | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);

    const slug = path.basename(filePath, '.md');

    // Extract sections from markdown
    const description = extractSection(body, 'Description') || '';
    const algorithm = extractSection(body, 'Algorithm') || '';
    const parameters = parseParametersTable(body);
    const riskManagement = parseRiskManagement(body);

    return {
      slug,
      name: frontmatter.name || slug,
      version: frontmatter.version || '1.0.0',
      description: description.trim(),
      algorithm: algorithm.trim(),
      parameters,
      riskManagement,
      author: frontmatter.author,
    };
  } catch (error) {
    console.error(`[StrategyLoader] Failed to parse ${filePath}:`, error);
    return null;
  }
}

/**
 * Extract content between a ## heading and the next ## heading
 */
function extractSection(content: string, sectionName: string): string | null {
  const regex = new RegExp(
    `## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
    'i'
  );
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Parse the Parameters table from markdown
 */
function parseParametersTable(content: string): StrategyParameter[] {
  const parametersSection = extractSection(content, 'Parameters');
  if (!parametersSection) return [];

  const parameters: StrategyParameter[] = [];

  // Match table rows (skip header and separator)
  const lines = parametersSection.split('\n').filter(line => line.trim().startsWith('|'));

  // Skip header row and separator row
  const dataRows = lines.slice(2);

  for (const row of dataRows) {
    const cells = row.split('|').map(cell => cell.trim()).filter(Boolean);

    if (cells.length >= 5) {
      const [name, type, defaultVal, minOrDesc, maxOrEmpty, description] = cells;

      // Determine if min/max are present or if it's description
      let min: number | undefined;
      let max: number | undefined;
      let desc = description || minOrDesc;

      if (minOrDesc && !isNaN(parseFloat(minOrDesc))) {
        min = parseFloat(minOrDesc);
      }
      if (maxOrEmpty && !isNaN(parseFloat(maxOrEmpty))) {
        max = parseFloat(maxOrEmpty);
      }

      // Handle the last column as description if we have 6 columns
      if (cells.length >= 6) {
        desc = cells[5];
      }

      parameters.push({
        name,
        type: type as 'number' | 'string' | 'boolean',
        description: desc || '',
        default: parseDefaultValue(defaultVal, type),
        min,
        max,
        required: true,
      });
    }
  }

  return parameters;
}

/**
 * Parse default value based on type
 */
function parseDefaultValue(value: string, type: string): string | number | boolean {
  if (type === 'number') {
    return parseFloat(value) || 0;
  }
  if (type === 'boolean') {
    return value.toLowerCase() === 'true';
  }
  return value;
}

/**
 * Parse Risk Management section
 */
function parseRiskManagement(content: string): RiskManagementRules {
  const section = extractSection(content, 'Risk Management');
  const defaults: RiskManagementRules = {
    maxPositionSize: '100',
    maxDrawdown: '10%',
  };

  if (!section) return defaults;

  // Parse bullet points like "- **maxPositionSize**: 10"
  const rules: Record<string, string> = {};
  const bulletRegex = /[-*]\s+\*\*(\w+)\*\*:\s*(.+)/g;
  let match;

  while ((match = bulletRegex.exec(section)) !== null) {
    const [, key, value] = match;
    rules[key] = value.trim();
  }

  return {
    maxPositionSize: rules.maxPositionSize || defaults.maxPositionSize,
    maxDrawdown: rules.maxDrawdown || defaults.maxDrawdown,
    stopLoss: rules.stopLoss,
    takeProfit: rules.takeProfit,
    maxDailyLoss: rules.maxDailyLoss,
    maxOpenOrders: rules.maxOpenOrders ? parseInt(rules.maxOpenOrders) : undefined,
  };
}

/**
 * Load all strategies from the strategies directory
 */
export function loadAllStrategies(): StrategyDefinition[] {
  const strategies: StrategyDefinition[] = [];

  if (!fs.existsSync(STRATEGIES_DIR)) {
    console.warn(`[StrategyLoader] Strategies directory not found: ${STRATEGIES_DIR}`);
    return strategies;
  }

  const files = fs.readdirSync(STRATEGIES_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(STRATEGIES_DIR, file);
    const strategy = parseStrategyFile(filePath);

    if (strategy) {
      strategies.push(strategy);
    }
  }

  console.log(`[StrategyLoader] Loaded ${strategies.length} strategies`);
  return strategies;
}

/**
 * Load a single strategy by slug
 */
export function loadStrategy(slug: string): StrategyDefinition | null {
  const filePath = path.join(STRATEGIES_DIR, `${slug}.md`);

  if (!fs.existsSync(filePath)) {
    console.warn(`[StrategyLoader] Strategy not found: ${slug}`);
    return null;
  }

  return parseStrategyFile(filePath);
}

/**
 * Get list of available strategy slugs
 */
export function getAvailableStrategySlugs(): string[] {
  if (!fs.existsSync(STRATEGIES_DIR)) {
    return [];
  }

  return fs
    .readdirSync(STRATEGIES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'));
}
